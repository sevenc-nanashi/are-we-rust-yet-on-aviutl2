import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
  CACHE_MAX_AGE_SECONDS,
  CATALOG_URL,
  type CatalogEntry,
  type GitHubRepo,
  type Languages,
  buildStats,
  parseCatalogEntries,
} from "./catalog";

type Env = {
  GITHUB_TOKEN?: string;
};

type HonoEnv = {
  Bindings: Env;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
};

const app = new Hono<HonoEnv>();

app.get("/api/version", (c) => {
  return c.json({
    id: env.CF_VERSION_METADATA.id,
  });
});

app.get("/api/stats", async (c) => {
  try {
    const cache = getDefaultCache();
    const cached = await cache.match(c.req.url);
    if (cached !== undefined) {
      const headers = new Headers(cached.headers);
      headers.set("X-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    const token = c.env.GITHUB_TOKEN;
    if (token === undefined || token.length === 0) {
      throw new Error("GITHUB_TOKEN is required.");
    }

    const catalog = await fetchCatalog();
    const stats = await buildStats(
      catalog,
      (repo) => fetchGitHubLanguages(repo, token),
      new Date(),
    );
    const response = c.json(stats, 200, {
      "X-Cache": "MISS",
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    });

    await cache.put(c.req.url, response.clone());

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return json({ error: message }, 500, {
      "Cache-Control": "no-store",
    });
  }
});

app.notFound(() => new Response("Not Found", { status: 404 }));

export default app;

function getDefaultCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default;
}

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(CATALOG_URL, {
    headers: {
      "User-Agent": "are-we-rust-yet-on-aviutl2",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: CACHE_MAX_AGE_SECONDS,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return parseCatalogEntries(json);
}

async function fetchGitHubLanguages(
  repo: GitHubRepo,
  token: string,
): Promise<{ languages: Languages; canonicalRepo: GitHubRepo }> {
  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/languages`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "are-we-rust-yet-on-aviutl2",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cf: {
        cacheEverything: true,
        cacheTtl: CACHE_MAX_AGE_SECONDS,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub languages for ${repo.owner}/${repo.repo}: ${response.status} ${response.statusText}`,
    );
  }

  // Detect if the repo was renamed by inspecting the final URL after redirect
  const canonicalRepo = parseGitHubApiLanguagesUrl(response.url) ?? repo;

  const json = await response.json();
  assertLanguages(json, `${repo.owner}/${repo.repo}`);
  return { languages: json, canonicalRepo };
}

function parseGitHubApiLanguagesUrl(url: string): GitHubRepo | null {
  const match = /\/repos\/([^/]+)\/([^/?]+)\/languages/.exec(url);
  if (match === null) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function assertLanguages(value: unknown, repo: string): asserts value is Languages {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GitHub languages for ${repo} must be an object.`);
  }

  for (const [language, bytes] of Object.entries(value)) {
    if (typeof bytes !== "number") {
      throw new Error(`GitHub language ${language} for ${repo} must be a number.`);
    }
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  });
}
