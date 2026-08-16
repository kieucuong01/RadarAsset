# DataVest production artifact build

The `Build production artifact` GitHub Actions workflow is manually dispatched for an explicit repository revision. A successful run proves that the selected SHA passed repository checks and produced a checksummed Linux artifact; it does not prove that the SHA is deployed.

## Build gates

The Ubuntu builder uses Node.js 24 and Python 3.12. It installs from repository lockfiles, runs `npm run check`, builds the Next.js standalone runtime, creates an offline Python wheelhouse, packages a pinned Prisma migration CLI, and assembles the allow-listed release payload.

No production application secret is available to the build job. The generated archive excludes environment files, local datasets, test directories, browser binaries, caches, Git data, and development `node_modules`.

## Artifact identity

Each workflow run publishes a 14-day artifact named `datavest-release-<full-git-sha>`. It contains:

- `datavest-release-<first-12-sha>.tar.gz`;
- the adjacent `.sha256` file covering the archive.

The archive also contains `release.json` and `manifest.sha256`. `release.json` records the full SHA, UTC build time, dependency hashes, and every runtime-file digest.

## Manual verification

After downloading both files on Linux, run:

```bash
sha256sum -c datavest-release-<first-12-sha>.tar.gz.sha256
mkdir release-check
tar -C release-check --strip-components=1 -xzf datavest-release-<first-12-sha>.tar.gz
cd release-check
sha256sum -c manifest.sha256
```

All checks must report `OK`. Record the GitHub run URL, full SHA, archive digest, and artifact name separately from deployment, service, HTTP, and browser evidence.
