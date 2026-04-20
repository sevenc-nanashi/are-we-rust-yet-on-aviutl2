import {
  CACHE_MAX_AGE_SECONDS,
  CATALOG_URL,
  type CatalogEntry,
  type GitHubRepo,
  type Languages,
  assertCatalogEntries,
  buildStats,
} from "./catalog";

type Env = {
  GITHUB_TOKEN?: string;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/stats") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405, {
        Allow: "GET",
      });
    }

    try {
      const cacheKey = new Request(new URL("/api/stats", url.origin), request);
      const cache = getDefaultCache();
      const cached = await cache.match(cacheKey);
      if (cached !== undefined) {
        const headers = new Headers(cached.headers);
        headers.set("X-Cache", "HIT");
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        });
      }

      const token = env.GITHUB_TOKEN;
      if (token === undefined || token.length === 0) {
        throw new Error("GITHUB_TOKEN is required.");
      }

      const catalog = await fetchCatalog();
      const stats = await buildStats(
        catalog,
        (repo) => fetchGitHubLanguages(repo, token),
        new Date(),
      );
      const response = json(stats, 200, {
        "X-Cache": "MISS",
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      return json({ error: message }, 500, {
        "Cache-Control": "no-store",
      });
    }
  },
};

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
  assertCatalogEntries(json);
  return json;
}

async function fetchGitHubLanguages(repo: GitHubRepo, token: string): Promise<Languages> {
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

  const json = await response.json();
  assertLanguages(json, `${repo.owner}/${repo.repo}`);
  return json;
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
