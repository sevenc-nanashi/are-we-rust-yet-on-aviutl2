import * as v from "valibot";

const rustOverrides = [
  // デフォルトブランチにRustが含まれていないだけで、実際はRustが使われている
  "KuroNeko.CopyAlias",
  // インストールされるが、filesに中心ずらしのaux2が含まれていない
  "azurite.AdjustPivot_A",
];

export const CATALOG_URL =
  "https://raw.githubusercontent.com/Neosku/aviutl2-catalog-data/refs/heads/main/index.json";

export const CACHE_MAX_AGE_SECONDS = 5 * 60;

const CatalogFileSchema = v.looseObject({
  path: v.string(),
});

const CatalogVersionSchema = v.looseObject({
  version: v.string(),
  file: v.optional(v.array(CatalogFileSchema)),
});

const CatalogEntrySchema = v.looseObject({
  id: v.string(),
  name: v.string(),
  type: v.string(),
  summary: v.optional(v.string()),
  author: v.optional(v.string()),
  repoURL: v.optional(v.string()),
  "latest-version": v.optional(v.string()),
  version: v.optional(v.array(CatalogVersionSchema)),
});

const CatalogEntriesSchema = v.array(CatalogEntrySchema);

export type CatalogEntry = v.InferOutput<typeof CatalogEntrySchema>;

export type CatalogVersion = v.InferOutput<typeof CatalogVersionSchema>;

export type CatalogFile = v.InferOutput<typeof CatalogFileSchema>;

export type GitHubRepo = {
  owner: string;
  repo: string;
};

export type Languages = Record<string, number>;

export type StatsItem = {
  id: string;
  name: string;
  type: string;
  summary: string | null;
  author: string | null;
  repoUrl: string | null;
  latestVersion: string | null;
  isGithubSource: boolean;
  isRust: boolean;
  hasNativeBinary: boolean;
  languages: Languages;
};

export type StatsResponse = {
  generatedAt: string;
  cacheMaxAgeSeconds: number;
  sourceUrl: string;
  totals: {
    target: number;
    githubSource: number;
    rust: number;
    nonRustGithub: number;
    nonGithub: number;
    rustRatioOfTarget: number;
    rustRatioOfGithubSource: number;
  };
  items: StatsItem[];
};

export type GitHubLanguagesFetcher = (repo: GitHubRepo) => Promise<Languages>;

const NATIVE_BINARY_EXTENSIONS = new Set(["aui2", "auo2", "auf2", "aux2", "mod2"]);

export function parseCatalogEntries(value: unknown): CatalogEntry[] {
  const result = v.safeParse(CatalogEntriesSchema, value);
  if (!result.success) {
    throw new Error(`Catalog JSON is invalid: ${v.summarize(result.issues)}`);
  }

  return result.output;
}

export function isTargetType(type: string): boolean {
  return type === "スクリプト" || type.includes("プラグイン");
}

export function parseGitHubRepo(repoUrl: string | undefined): GitHubRepo | null {
  if (repoUrl === undefined) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com") {
    return null;
  }

  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined) {
    return null;
  }

  return { owner, repo: repo.replace(/\.git$/, "") };
}

export function hasNativeBinary(entry: CatalogEntry): boolean {
  const latestVersion = entry["latest-version"];
  if (latestVersion === undefined) {
    return false;
  }

  const versions = entry.version;
  if (versions === undefined) {
    return false;
  }

  const latest = versions.find((version) => version.version === latestVersion);
  if (latest === undefined || latest.file === undefined) {
    return false;
  }

  return latest.file.some((file) => hasNativeBinaryExtension(file.path));
}

export async function buildStats(
  catalog: CatalogEntry[],
  fetchLanguages: GitHubLanguagesFetcher,
  now: Date,
): Promise<StatsResponse> {
  const reposByKey = new Map<string, GitHubRepo>();

  for (const entry of catalog) {
    const repo = parseGitHubRepo(entry.repoURL);
    if (repo === null) {
      continue;
    }
    reposByKey.set(repoKey(repo), repo);
  }

  const languagesByRepoKey = new Map<string, Languages>();
  const repoEntries = [...reposByKey.entries()];
  const fetchedLanguages = await mapWithConcurrency(repoEntries, 8, async ([key, repo]) => {
    const languages = await fetchLanguages(repo);
    return [key, languages] as const;
  });

  for (const [key, languages] of fetchedLanguages) {
    languagesByRepoKey.set(key, languages);
  }

  const items = catalog.map((entry): StatsItem => {
    const repo = parseGitHubRepo(entry.repoURL);
    const languages = repo === null ? {} : languagesByRepoKey.get(repoKey(repo));
    if (languages === undefined) {
      throw new Error(`Languages were not fetched for ${entry.repoURL}.`);
    }

    const isRust = rustOverrides.includes(entry.id) || Object.hasOwn(languages, "Rust");
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      summary: entry.summary ?? null,
      author: entry.author ?? null,
      repoUrl: entry.repoURL ?? null,
      latestVersion: entry["latest-version"] ?? null,
      isGithubSource: repo !== null,
      isRust,
      hasNativeBinary: isRust || hasNativeBinary(entry),
      languages,
    };
  });

  const githubSource = items.filter((item) => item.isGithubSource).length;
  const rust = items.filter((item) => item.isRust).length;
  const nonGithub = items.length - githubSource;
  const nonRustGithub = githubSource - rust;

  return {
    generatedAt: now.toISOString(),
    cacheMaxAgeSeconds: CACHE_MAX_AGE_SECONDS,
    sourceUrl: CATALOG_URL,
    totals: {
      target: items.length,
      githubSource,
      rust,
      nonRustGithub,
      nonGithub,
      rustRatioOfTarget: ratio(rust, items.length),
      rustRatioOfGithubSource: ratio(rust, githubSource),
    },
    items,
  };
}

function hasNativeBinaryExtension(path: string): boolean {
  const extension = path.split(".").pop();
  if (extension === undefined) {
    return false;
  }

  return NATIVE_BINARY_EXTENSIONS.has(extension.toLowerCase());
}

export function repoKey(repo: GitHubRepo): string {
  return `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) {
        return;
      }
      results[index] = await mapper(value);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
