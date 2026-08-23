# State Tracker — Operator's Descent / github-pages-build-script

## Program / Feature / Intent / Sessions

- **Program:** Operator's Descent (`operator-s-descent`)
- **Feature:** `github-pages-build-script`
- **Intent:** Publish a minimal, deterministic GitHub Pages artifact made only from verified production assets, then deploy it on updates to `main` without changing the browser runtime or its project-subpath behavior.
- **Sessions:** 4
- **Authoritative config:** `./program/operator-s-descent/FORGE-CONFIG.md` (existing; reused without override)

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Complete the offline manifest and Pages asset contract | M81, M94, M96, M107 | `./service-worker.js`, `./scripts/verify-assets.js`, `./scripts/report-budget.js`, `./tests/integration/service-worker.test.js` | done | 2/2 | 2026-08-23 | Cache runtime SVG sprite (./assets/icons.svg) into PRODUCTION_ASSETS, bump service-worker cache v8→v9, and align verify-assets.js/report-budget.js required-singleton and text-compression lists so cache, verifier, and budget reporter agree. |
| 02 | Create deterministic Pages artifact staging | M81, M83, M94, M107 | `./scripts/build-pages.js`, `./package.json`, `./.gitignore`, `./tests/tools/build-pages.test.js` | done | 2/2 | 2026-08-23 | Added ./scripts/build-pages.js — manifest-driven Pages stager (buildPages/parseBuildPagesArgs), npm run build:pages (check:assets-first), /dist/ gitignore entry, and 19 Vitest cases locking artifact exactness, byte identity, stale-output replacement, and unsafe-target/malformed-manifest rejection before any filesystem mutation. |
| 03 | Publish verified artifact with GitHub Actions | M81, M83, M94 | `./.github/workflows/deploy-pages.yml`, `./README.MD`, `./tests/tooling/github-pages-workflow.test.js` | done | 2/2 | 2026-08-23 | Worker delivery and both checkpoint commits completed. GitHub Actions run #1 then stopped at its correctly strict generated-output guard; that external deployment blockage is remediated by the disjoint SESSION-04 lease, not by reopening this workflow/documentation lease. |
| 04 | Reconcile committed assets for the Pages drift guard | M107, M108 | `./styles/tailwind.css`, `./assets/icons.svg` | blocked | 1/2 | — | Worker reported `checkpoint: 2`, but lease reconciliation found only one matching worker checkpoint commit (`4bc7d45`) for its two claimed checkpoints. The committed artifact and local verification remain intact; Jikijitsu cannot mark the session done without a human override. |

## Wave Plan

| Wave | Sessions | Why Concurrent |
|---|---|---|
| 1 | SESSION-01 | The production manifest is the artifact contract; it must first include the actual icon sprite used by the browser runtime. |
| 2 | SESSION-02 | Depends on SESSION-01's expanded manifest and has a disjoint write set. |
| 3 | SESSION-03 | Depends on the real `build:pages` command and its artifact behavior from SESSION-02; its workflow must not guess a future interface. |
| 4 | SESSION-04 | Depends on SESSION-03's committed workflow/test contract, writes only the two generated files that its existing command can change, and has a lease disjoint from every completed session. It is intentionally single-session: the CSS and SVG are coupled by `npm run build:assets` and must be committed and rechecked together. |

## Dependency Graph

```mermaid
flowchart TD
  S01["S01 · complete production manifest"] --> S02["S02 · stage Pages artifact"]
  S02 --> S03["S03 · deploy verified artifact"]
  S03 --> S04["S04 · reconcile committed generated assets"]
```

## Architecture Reference (Feature-Specific Only; Full Config in `./program/operator-s-descent/FORGE-CONFIG.md`)

- **Runtime remains static:** `./index.html`, CSS, ES modules, JSON, fonts, and the SVG sprite remain served as files. The new `build:pages` command only copies verified bytes; it does not bundle, transpile, minify, rewrite URLs, or import a package at runtime.
- **One production list:** `PRODUCTION_ASSETS` in `./service-worker.js` is both the offline precache manifest and the deployment-artifact allowlist. SESSION-01 makes `./assets/icons.svg` part of that list because `./src/ui/icon.js` fetches it through external SVG `<use>` references.
- **Safe staging:** `./scripts/build-pages.js` parses that literal list without executing the service-worker script, validates each relative path, and copies exactly those regular files into an empty output directory. Its default output is ignored `./dist/`; CI provides a directory under the runner temporary path.
- **Project Pages compatibility:** existing asset and service-worker references are relative, so the artifact retains its directory structure unchanged and works below the repository Pages path. No `<base>` tag, absolute-path rewrite, router rewrite, or custom-domain file is introduced.
- **CI boundary:** the workflow regenerates the committed CSS and icon outputs, rejects a dirty generated-file diff, runs the Pages-specific artifact contracts, then sends only the temporary staging directory to GitHub's Pages artifact action. It does not upload the repository root, `./node_modules/`, source design files, tests, or planning files.
- **Generated-output repair:** SESSION-04 regenerates only `./styles/tailwind.css` and `./assets/icons.svg`, then proves a second `npm run build:assets` leaves the same unchanged guard clean. The workflow, its guard, package scripts, and runtime source remain read-only.

## Scope Summary (Modules Affected, Indexed by ID)

| ID | Module | Scope |
|---|---|---|
| M81 | Service Worker | Add the runtime SVG sprite to the precache/deployment manifest and advance the cache namespace so installed clients receive the corrected asset set. |
| M83 | Package Manifest | Add a `build:pages` command only; no dependency or runtime-package change. |
| M94 | Validation Tooling | Extend static-manifest and transfer-budget enumeration to include both shipped assets, and add the manifest-driven Pages artifact builder. |
| M96 | Release Simulation | Measure the corrected production asset set through the existing budget reporter; no simulation algorithm changes. |
| M107 | Icon System | Treat the existing `./assets/icons.svg` runtime sprite as a first-class production asset in cache, budget, and artifact checks. |
| M108 | Tailwind Pipeline | Regenerate and commit only the deterministic `./styles/tailwind.css` artifact that GitHub Actions identified as stale; do not change Tailwind inputs, configuration, tooling, or runtime loading. |

## Design Decisions (Choice + Rationale)

1. **Deploy a staged allowlist rather than the repository root:** the source tree intentionally contains development scripts, mocks, specifications, tests, package metadata, and planning records. The Pages artifact must contain only the runtime list already vetted by the offline policy.
2. **Repair the icon-sprite omission before staging:** `./assets/icons.svg` is requested by the existing icon factory but is currently outside `PRODUCTION_ASSETS`. Adding it closes the known offline gap and prevents a Pages artifact that renders missing icons.
3. **Keep asset generation separate from artifact staging:** the workflow runs `npm run build:assets` and fails if committed outputs differ. `build:pages` copies the verified committed file set and never silently deploys regenerated-but-uncommitted CSS or SVG output.
4. **Use the official two-job Pages flow:** the build job uses the documented Pages permission set, while the deploy job receives the artifact through `needs`, has an explicit `github-pages` environment, checks out no source, and grants no write capability beyond `pages: write` plus `id-token: write`.
5. **Do not gate Pages deployment on the known unrelated suite failures:** planning inspection found `npm test` at **2 failed / 2817 passed**, both in `./tests/ui/exploration-screen.test.js`. The workflow runs the manifest, artifact, and workflow-contract tests instead; it must not edit, skip, or relabel those existing exploration failures.
6. **Repository configuration remains an external prerequisite:** after merge, an administrator must set the repository's Pages publishing source to **GitHub Actions** once. The workflow cannot safely change repository settings or infer a custom domain.
7. **Repair generated bytes, not the guard:** `npm run build:assets` can write both `./styles/tailwind.css` and `./assets/icons.svg`, so SESSION-04 leases exactly those two committed outputs. It reruns the existing command, commits only changed leased artifacts, and preserves the strict diff guard that correctly blocked run #1.
8. **Preserve user workspace state:** the repair snapshots the pre-existing unstaged `./README.MD` hunk and untracked `./.DS_Store`, commits with an explicit two-path lease, and compares the final status to the initial status. It must not clean, restore, stage, or commit either exempt path.

## Handoff Notes (Jikijitsu Writes Here After Each Session — From Mu's Handoff JSON, Verbatim)

### SESSION-01

- **notes:** Cache runtime SVG sprite (./assets/icons.svg) into PRODUCTION_ASSETS, bump service-worker cache v8→v9, and align verify-assets.js/report-budget.js required-singleton and text-compression lists so cache, verifier, and budget reporter agree.
- **followUp:** Manifest now cache-consistent for './assets/icons.svg'; SESSION-02 (Pages artifact staging) can safely enumerate PRODUCTION_ASSETS as the complete artifact allowlist including the sprite.

### SESSION-02

- **notes:** Added ./scripts/build-pages.js — manifest-driven Pages stager (buildPages/parseBuildPagesArgs), npm run build:pages (check:assets-first), /dist/ gitignore entry, and 19 Vitest cases locking artifact exactness, byte identity, stale-output replacement, and unsafe-target/malformed-manifest rejection before any filesystem mutation.
- **followUp:** SESSION-03 can call `npm run build:pages -- --output <runner-tmp-dir>` directly for its GitHub Actions workflow. build-pages.js is not yet a Module Registry entry (M-number) — Jikijitsu/Forge may want to fold it under M94 (Validation Tooling) or assign a new ID at feature close.

### SESSION-03

- **notes:** Added ./.github/workflows/deploy-pages.yml (two-job least-privilege GitHub Pages deploy: build regenerates+diff-checks CSS/icons, verifies manifest, runs the 3 Pages-specific Vitest suites, stages to $RUNNER_TEMP via npm run build:pages, uploads only that dir; deploy needs:build, github-pages environment, actions/deploy-pages@v4). Added ./tests/tooling/github-pages-workflow.test.js (16 no-dependency text-contract assertions on triggers, permissions, action versions, staging path, validation steps, deploy linkage). Documented the flow in ./README.MD under a new 'GitHub Pages Deployment' section, preserving the pre-existing unrelated title/live-site hunk unstaged exactly as instructed.
- **followUp:** The known pre-existing failures in ./tests/ui/exploration-screen.test.js (2 failed / 2817 passed on full npm test, per SESSION-02's handoff) remain unresolved and out of scope — this workflow does not run npm test/validate/check:release, so they cannot block Pages deployment. After merge, a repository administrator still needs to set Settings → Pages → Build and deployment → Source → GitHub Actions once (external state, documented in README but not something code can set).

### SESSION-04

- **notes:** Regenerated the stale committed Tailwind artifact; checkpoint-1 commit 4bc7d4570e131f5aa0d8aafd2bbbb35f90bb4d45 contains only ./styles/tailwind.css.
- **followUp:** Hashes: tailwind 924fff33b6c4e3f8fbdc099caa10dd1d99c17a010a1aead7deb70d6618b41d20 → afbe59eee57459362e72a3a892f3f6fb2cb89199d17184a25187646b060e02e8; icons cde2323387278fa47573c690fec771fbbbc2896b36d1d6687afe313ded0d6a95 unchanged. A new push/Actions run may exercise the unchanged deployment workflow.

## External Verification

### GitHub Actions run #1 — 2026-08-23

- **Status:** blocked.
- **Evidence:** the build job ran `git diff --exit-code -- ./styles/tailwind.css ./assets/icons.svg` after asset generation. The regenerated `./styles/tailwind.css` differed from the committed artifact, so the command exited 1 before artifact upload or deployment.
- **Constraint resolved in plan:** no completed session owns `./styles/tailwind.css`; Jikijitsu must not widen SESSION-03's lease. SESSION-04 now owns exactly `./styles/tailwind.css` and `./assets/icons.svg`, because the existing generation command can write both.
- **Required follow-up:** execute SESSION-04, verify the clean targeted diff and local Pages contract, then let its artifact-only commit trigger or retry the unchanged Pages workflow. No guard bypass or workflow rewrite is authorized.
