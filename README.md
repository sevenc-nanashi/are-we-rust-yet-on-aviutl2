# Are We Rust Yet on AviUtl2?

A Cloudflare Workers + Vue page that counts Rust-powered plugin and script entries in the AviUtl2 catalog data.

## Development

Set `GITHUB_TOKEN` for GitHub Languages API access.

```sh
wrangler secret put GITHUB_TOKEN
```

Local commands use Vite+:

```sh
ni
nr dev
nr test
nr check
nr build
```

## Definition

An entry is counted as Rust-powered when:

- its catalog `type` is `スクリプト` or contains `プラグイン`
- its `repoURL` points to `https://github.com/{owner}/{repo}`
- GitHub Languages API for that repository includes `Rust`

The Worker caches `/api/stats` for one hour.
