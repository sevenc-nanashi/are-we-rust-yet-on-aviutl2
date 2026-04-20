import { describe, expect, it, vi } from "vitest";
import {
  type CatalogEntry,
  type GitHubRepo,
  type GitHubLanguagesFetcher,
  type Languages,
  buildStats,
  isTargetType,
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

describe("buildStats", () => {
  it("summarizes Rust ratios and deduplicates GitHub repository calls", async () => {
    const catalog: CatalogEntry[] = [
      {
        id: "rust.plugin",
        name: "Rust Plugin",
        type: "汎用プラグイン",
        repoURL: "https://github.com/example/rusty",
      },
      {
        id: "rust.script",
        name: "Rust Script",
        type: "スクリプト",
        repoURL: "https://github.com/example/rusty",
      },
      {
        id: "ts.plugin",
        name: "TS Plugin",
        type: "フィルタプラグイン",
        repoURL: "https://github.com/example/ts",
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
      },
    ];
    const fetchLanguages = vi.fn<GitHubLanguagesFetcher>(
      async (repo: GitHubRepo): Promise<Languages> => {
        const key = repoKey(repo);
        if (key === "example/rusty") {
          return { Rust: 1200, TypeScript: 30 };
        }
        if (key === "example/ts") {
          return { TypeScript: 900 };
        }
        throw new Error(`Unexpected repo ${key}`);
      },
    );

    const stats = await buildStats(catalog, fetchLanguages, new Date("2026-04-20T00:00:00.000Z"));

    expect(fetchLanguages).toHaveBeenCalledTimes(2);
    expect(stats.totals).toEqual({
      target: 4,
      githubSource: 3,
      rust: 2,
      nonRustGithub: 1,
      nonGithub: 1,
      rustRatioOfTarget: 0.5,
      rustRatioOfGithubSource: 2 / 3,
    });
    expect(stats.items.map((item) => [item.id, item.isRust])).toEqual([
      ["rust.plugin", true],
      ["rust.script", true],
      ["ts.plugin", false],
      ["drive.script", false],
    ]);
  });
});
