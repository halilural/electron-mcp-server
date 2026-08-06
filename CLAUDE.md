# Project guidelines

## Git

- Do **not** add `Co-Authored-By: Claude ...` or any other Claude/Anthropic attribution to commit messages.
- Do **not** add a "Generated with Claude Code" footer to pull request bodies.
- Commit messages: conventional-commit subject (`feat:`, `fix:`, `ci:`, `docs:`, `chore:`), plus a body only when the change needs explaining.
- Work on a branch and open a PR against `master`; don't push directly to `master`.

## Development

- Node.js 20+ is required (the build toolchain and runtime dependencies dropped 18).
- Before pushing: `npm run code:check` (lint + format check), `npm run test:unit`, `npm run build`.
- `npm test` includes `tests/integration/electron-security-integration.test.ts`, which needs a live Electron window with remote debugging on port 9222 and times out in headless environments. CI runs `test:unit` only.

## Releases

- Publishing is automated: creating a GitHub Release triggers `.github/workflows/publish.yml`, which publishes to npm with provenance using the `NPM_TOKEN` secret.
- Bump the version with `npm version <patch|minor|major>` and push with `--follow-tags` before creating the release.
- README badges are proxied through GitHub's camo cache, keyed by URL. If a badge shows stale data, changing the URL (e.g. the `cacheSeconds` query param) is the only reliable way to refresh it.
