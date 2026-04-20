// NOTE:
// - KuroNeko.CopyAlias：デフォルトブランチにRustが含まれていないだけで、実際はRustが使われている
const rustOverrides = ["KuroNeko.CopyAlias"];

export const CATALOG_URL =
  "https://raw.githubusercontent.com/Neosku/aviutl2-catalog-data/refs/heads/main/index.json";

export const CACHE_MAX_AGE_SECONDS = 5 * 60;

export type CatalogEntry = {
  id: string;
  name: string;
  type: string;
  summary?: string;
  author?: string;
  repoURL?: string;
  "latest-version"?: string;
  version?: CatalogVersion[];
};

export type CatalogVersion = {
  version: string;
  file?: CatalogFile[];
};

export type CatalogFile = {
  path: string;
};

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

export function assertCatalogEntries(value: unknown): asserts value is CatalogEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("Catalog JSON must be an array.");
  }

  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Catalog entry at index ${index} must be an object.`);
    }
    assertString(entry.id, `Catalog entry at index ${index}.id`);
    assertString(entry.name, `Catalog entry at index ${index}.name`);
    assertString(entry.type, `Catalog entry at index ${index}.type`);
    assertCatalogVersions(entry.version, `Catalog entry at index ${index}.version`);
  }
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

    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      summary: entry.summary ?? null,
      author: entry.author ?? null,
      repoUrl: entry.repoURL ?? null,
      latestVersion: entry["latest-version"] ?? null,
      isGithubSource: repo !== null,
      isRust: rustOverrides.includes(entry.id) || Object.hasOwn(languages, "Rust"),
      hasNativeBinary: hasNativeBinary(entry),
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

function assertCatalogVersions(
  value: unknown,
  label: string,
): asserts value is CatalogVersion[] | undefined {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  for (const [versionIndex, version] of value.entries()) {
    if (!isRecord(version)) {
      throw new Error(`${label} at index ${versionIndex} must be an object.`);
    }
    assertString(version.version, `${label} at index ${versionIndex}.version`);
    assertCatalogFiles(version.file, `${label} at index ${versionIndex}.file`);
  }
}

function assertCatalogFiles(
  value: unknown,
  label: string,
): asserts value is CatalogFile[] | undefined {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  for (const [fileIndex, file] of value.entries()) {
    if (!isRecord(file)) {
      throw new Error(`${label} at index ${fileIndex} must be an object.`);
    }
    assertString(file.path, `${label} at index ${fileIndex}.path`);
  }
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

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
