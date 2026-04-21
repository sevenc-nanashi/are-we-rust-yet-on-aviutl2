import { describe, expect, it, vi } from "vitest";
import {
  type CatalogEntry,
  type GitHubRepo,
  type GitHubLanguagesFetcher,
  buildStats,
  hasNativeBinary,
  isTargetType,
  parseCatalogEntries,
  parseGitHubRepo,
  repoKey,
} from "./catalog";

describe("isTargetType", () => {
  it("keeps scripts and plugin variants", () => {
    expect(isTargetType("スクリプト")).toBe(true);
    expect(isTargetType("汎用プラグイン")).toBe(true);
    expect(isTargetType("フィルタプラグイン")).toBe(true);
    expect(isTargetType("本体")).toBe(false);
    expect(isTargetType("MOD")).toBe(false);
  });
});

describe("parseGitHubRepo", () => {
  it("extracts owner and repository from GitHub URLs", () => {
    expect(parseGitHubRepo("https://github.com/sevenc-nanashi/tex.auf2")).toEqual({
      owner: "sevenc-nanashi",
      repo: "tex.auf2",
    });
    expect(parseGitHubRepo("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("rejects non GitHub URLs", () => {
    expect(
      parseGitHubRepo("https://raw.githubusercontent.com/owner/repo/main/README.md"),
    ).toBeNull();
    expect(parseGitHubRepo("https://example.com/owner/repo")).toBeNull();
    expect(parseGitHubRepo(undefined)).toBeNull();
  });
});

describe("parseCatalogEntries", () => {
  it("parses catalog entries with required fields and known optional fields", () => {
    expect(
      parseCatalogEntries([
        {
          id: "plugin",
          name: "Plugin",
          type: "汎用プラグイン",
          summary: "Summary",
          author: "Author",
          repoURL: "https://github.com/example/plugin",
          "latest-version": "1.0.0",
          version: [
            {
              version: "1.0.0",
              file: [{ path: "{pluginsDir}/plugin.aux2" }],
            },
          ],
          popularity: 100,
        },
      ]),
    ).toEqual([
      {
        id: "plugin",
        name: "Plugin",
        type: "汎用プラグイン",
        summary: "Summary",
        author: "Author",
        repoURL: "https://github.com/example/plugin",
        "latest-version": "1.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{pluginsDir}/plugin.aux2" }],
          },
        ],
        popularity: 100,
      },
    ]);
  });

  it("rejects invalid catalog roots and entries", () => {
    expect(() => parseCatalogEntries({})).toThrow("Catalog JSON is invalid:");
    expect(() => parseCatalogEntries([{ name: "Plugin", type: "汎用プラグイン" }])).toThrow(
      "Catalog JSON is invalid:",
    );
    expect(() =>
      parseCatalogEntries([
        {
          id: "plugin",
          name: "Plugin",
          type: "汎用プラグイン",
          version: [{ version: "1.0.0", file: [{ path: 1 }] }],
        },
      ]),
    ).toThrow("Catalog JSON is invalid:");
  });
});

describe("buildStats", () => {
  it("resolves repoUrl to canonical after rename, detected via redirect", async () => {
    const catalog: CatalogEntry[] = [
      {
        id: "aviutl2-community.aviutl2_community_translation_companion",
        name: "AviUtl2 Community Translation Companion",
        type: "言語ファイル",
        repoURL: "https://github.com/aviutl2/aviutl2-community-translation",
      },
    ];
    // Simulate: fetch was called with the old repo name, but the GitHub API redirected
    // to the new name (aviutl2_community_translation), detected via response.url
    const renamedRepo: GitHubRepo = { owner: "aviutl2", repo: "aviutl2_community_translation" };
    const fetchLanguages = vi.fn<GitHubLanguagesFetcher>(async (repo: GitHubRepo) => {
      const key = repoKey(repo);
      if (key === "aviutl2/aviutl2-community-translation") {
        return { languages: { Ruby: 500 }, canonicalRepo: renamedRepo };
      }
      throw new Error(`Unexpected repo ${key}`);
    });

    const stats = await buildStats(catalog, fetchLanguages, new Date("2026-04-21T00:00:00.000Z"));

    expect(fetchLanguages).toHaveBeenCalledTimes(1);
    expect(fetchLanguages).toHaveBeenCalledWith({
      owner: "aviutl2",
      repo: "aviutl2-community-translation",
    });
    expect(stats.items[0].repoUrl).toBe("https://github.com/aviutl2/aviutl2_community_translation");
    expect(stats.items[0].isRust).toBe(false);
  });

  it("summarizes Rust ratios for all catalog entries and deduplicates GitHub repository calls", async () => {
    const catalog: CatalogEntry[] = [
      {
        id: "rust.plugin",
        name: "Rust Plugin",
        type: "汎用プラグイン",
        repoURL: "https://github.com/example/rusty",
        "latest-version": "1.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{pluginsDir}/rust.aui2" }],
          },
        ],
      },
      {
        id: "rust.script",
        name: "Rust Script",
        type: "スクリプト",
        repoURL: "https://github.com/example/rusty",
        "latest-version": "1.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{scriptsDir}/rust.anm2" }],
          },
        ],
      },
      {
        id: "ts.plugin",
        name: "TS Plugin",
        type: "フィルタプラグイン",
        repoURL: "https://github.com/example/ts",
        "latest-version": "1.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{pluginsDir}/ts.auf2" }],
          },
        ],
      },
      {
        id: "drive.script",
        name: "Drive Script",
        type: "スクリプト",
        repoURL: "https://drive.google.com/file/d/example",
      },
      {
        id: "core",
        name: "Core",
        type: "本体",
        repoURL: "https://github.com/example/rusty",
        "latest-version": "1.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{appDir}/aviutl2.exe" }],
          },
        ],
      },
    ];
    const fetchLanguages = vi.fn<GitHubLanguagesFetcher>(async (repo: GitHubRepo) => {
      const key = repoKey(repo);
      if (key === "example/rusty") {
        return { languages: { Rust: 1200, TypeScript: 30 }, canonicalRepo: repo };
      }
      if (key === "example/ts") {
        return { languages: { TypeScript: 900 }, canonicalRepo: repo };
      }
      throw new Error(`Unexpected repo ${key}`);
    });

    const stats = await buildStats(catalog, fetchLanguages, new Date("2026-04-20T00:00:00.000Z"));

    expect(fetchLanguages).toHaveBeenCalledTimes(2);
    expect(stats.totals).toEqual({
      target: 5,
      githubSource: 4,
      rust: 3,
      nonRustGithub: 1,
      nonGithub: 1,
      rustRatioOfTarget: 3 / 5,
      rustRatioOfGithubSource: 3 / 4,
    });
    expect(stats.items.map((item) => [item.id, item.isRust, item.hasNativeBinary])).toEqual([
      ["rust.plugin", true, true],
      ["rust.script", true, true],
      ["ts.plugin", false, true],
      ["drive.script", false, false],
      ["core", true, true],
    ]);
  });
});

describe("hasNativeBinary", () => {
  it("detects native binary extensions from the latest version files", () => {
    const extensions = ["aui2", "auo2", "auf2", "aux2", "mod2"];

    for (const extension of extensions) {
      expect(
        hasNativeBinary({
          id: extension,
          name: extension,
          type: "汎用プラグイン",
          "latest-version": "1.0.0",
          version: [
            {
              version: "1.0.0",
              file: [{ path: `{pluginsDir}/plugin.${extension}` }],
            },
          ],
        }),
      ).toBe(true);
    }
  });

  it("ignores native binary files from non-latest versions", () => {
    expect(
      hasNativeBinary({
        id: "legacy-native",
        name: "Legacy Native",
        type: "汎用プラグイン",
        "latest-version": "2.0.0",
        version: [
          {
            version: "1.0.0",
            file: [{ path: "{pluginsDir}/legacy.aux2" }],
          },
          {
            version: "2.0.0",
            file: [{ path: "{scriptsDir}/latest.anm2" }],
          },
        ],
      }),
    ).toBe(false);
  });
});
