# Capture NP (`capture-app-np`) — Architecture & Upstream Sync Guide

This repository maintains **Capture NP**, a custom Nepal distribution of DHIS2 Capture (`coreApp: false`, title `"Capture NP"`, custom UUID `c4f7a91e-8d2b-4f63-9a5c-7e1b3d0f82a4`), organized so you can pull the latest DHIS2 Capture updates into a **standalone repository (without shared upstream Git history)** without breaking Nepal features or re-doing branding.

---

## 1. How Safe Upstream Sync Works (No Shared Git History Required)

Because this repository is exported as a standalone repo rather than a direct GitHub fork of `dhis2/capture-app`, a normal `git merge` fails with `refusing to merge unrelated histories`.

Instead, `nepal/scripts/syncUpstream.mjs` uses a **history-independent 3-way sync engine**:

1. **Discover & Filter**: Lists stable upstream semver tags (`vX.Y.Z`, excluding `alpha`/`beta`/`rc`) and checks `d2.config.js` `minDHIS2Version` to pick the latest release compatible with your DHIS2 server (`2.41+` by default, configured via `maxMinDHIS2Version` in `nepal/branding.json`).
2. **Dual Shallow Snapshot**: Caches shallow clones of both your currently tracked baseline tag (`upstreamBaseTag`) and the target tag under `.nepal-cache/upstream-sync/`.
3. **Strict Ownership Protection**:
   - **Nepal-Owned (Protected)**: `src/nepal/**`, `nepal/**`, `server.ts`, `README.nepal.md`, `.github/workflows/release-capture-app-np.yml`, and local assets are never overwritten or deleted.
   - **Pure Upstream Core**: Computes exact additions, updates, and deletions between `oldBaseTag` and `targetTag` and applies them cleanly.
   - **Thin Nepal Hooks & Shared Config (3-Way Merged)**: Uses `git merge-file --diff3` (`local` + `old upstream` + `new upstream`) so **both** upstream bugfixes and your Nepal hooks are preserved together.
   - **`package.json` Structured Merge**: Adopts upstream's new `version`, `dependencies`, and `devDependencies` while preserving Capture NP's `name`, `cacheVersion`, Nepal packages (`nepali-date-converter`, `express`, `tsx`, `dotenv`, `@types/express`, `@types/node`), and `nepal:*` scripts.
   - **Branding & 38 Locale Titles**: Re-stamped deterministically via `npm run nepal:brand`.

---

## 2. Step-by-Step: Pulling Latest DHIS2 Capture Updates

### Step 1 — Check for a Newer DHIS2 2.41+ Compatible Release (Zero File Edits)

```bash
npm run nepal:check-updates
```

This prints your current baseline tag, the latest upstream Capture release overall, and the latest stable release compatible with DHIS2 `2.41+`.

*(When your DHIS2 server upgrades to 2.42+, pass `--max-dhis2-version 2.42` or update `maxMinDHIS2Version` in `nepal/branding.json`.)*

### Step 2 — Dry-Run Preview (Zero File Edits)

```bash
npm run nepal:sync:dry-run
# or target a specific tag:
npm run nepal:sync:dry-run -- --tag v107.10.0
```

This simulates the full upstream diff and runs a 3-way merge preview on every thin Nepal hook file without modifying a single file in your workspace. Look for:
- `[UNCHANGED]` / `[3-WAY OK]` — hook merges cleanly automatically.
- `[CONFLICT]` — upstream refactored the exact lines around that hook (you will resolve only that file during Step 3).

### Step 3 — Run the Sync on an Isolated Upgrade Branch

Ensure your working tree is clean (`git status`), then run:

```bash
npm run nepal:sync
# or target a specific tag:
npm run nepal:sync -- --tag v107.10.0
```

What happens automatically:
1. Switches to an isolated branch `upgrade/<tag>` (leaving `main` untouched).
2. Mirrors upstream core changes while protecting all Nepal-owned folders.
3. 3-way merges all thin Nepal hook files and build configs (`tsconfig.json`, `vite.config.mts`).
4. Merges `package.json` dependencies while preserving Nepal packages and scripts.
5. Updates `upstreamBaseTag` in `nepal/branding.json`.
6. Runs `npm install --legacy-peer-deps` → `npm run nepal:brand` → `npm run nepal:verify` → `npm run lint` → `npm run build:zip` → ZIP inspection (`--zip`).

### Step 4 — If a Hook Conflict Occurs (Guided Recovery)

If upstream heavily refactored one of the thin hook files, the sync pauses with exit code `2` and lists the exact conflicted file(s):

1. Open the listed file(s) and resolve the `<<<<<<<` / `=======` / `>>>>>>>` conflict markers—keeping upstream's new logic **and** the thin Nepal hook from Section 3 below.
2. Resume branding, verification, typecheck, and ZIP build in one command:

```bash
npm run nepal:sync -- --finish v107.10.0
```

### Step 5 — Smoke-Test & Publish Release ZIP

1. Start locally (`npm run dev`), open a Capture form, and verify:
   - Right-side `BS` calendar icon button opens the Nepali popover (`Baisakh`–`Chaitra`).
   - Selecting a BS date populates the native AD input and displays the floating top-right `YYYY-MM-DD BS` pill.
   - Age / Date of Birth field displays cleanly without clipping.
2. Commit and push your upgrade branch, merge to `main`, and push a release tag:

```bash
git add -A
git commit -m "chore: sync upstream capture-app to v107.10.0"
git tag v107.10.0-np.1
git push origin HEAD --tags
```

GitHub Actions (`.github/workflows/release-capture-app-np.yml`) will build, run all verification checks, compute a `.sha256` checksum, and attach `capture-app-np-107.10.0.zip` to a GitHub Release.

---

## 3. Thin Upstream Hook Points (Reference Checklist)

Upstream `dhis2/capture-app` files are kept untouched except for these minimal hooks (all 3-way merged by `nepal:sync` and checked by `npm run nepal:verify`):

| # | Core File | Purpose |
|---|-----------|---------|
| 0 | `src/index.tsx` | Calls `ensureNepalExtensionLoaded()` at startup to register the host bridge and preload `nepal-extension.js` |
| 1 | `src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.component.tsx` | Imports `NepalDateAddonBridge` from `'capture-nepal/runtime/extensionHost'` and wraps `<CalendarInput>` |
| 2 | `src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.types.ts` | Adds optional `hideNepaliPicker?: boolean` prop |
| 3 | `src/core_modules/capture-ui/DateAndTimeFields/DateRangeField/DateRangeField.component.tsx` | Passes `hideNepaliPicker` on filter date-range inputs |
| 4a | `src/core_modules/capture-ui/internal/AgeInput/AgeDateInput.component.tsx` | Sets DoB `width={185}` so AD input + BS pill + `BS` button fit cleanly |
| 4b | `src/core_modules/capture-ui/AgeField/ageField.module.css` | Sets `.ageDateInputContainerHorizontal` `width: 185px` |
| 5 | `src/core_modules/capture-core/storageControllers/mainStorageController.ts` | Fallback `DHIS2_CACHE_VERSION` (`'4'`) so IndexedDB never opens with `NaN` |
| 6 | `src/core_modules/capture-core-utils/hash/hashSHA256.ts` | Pure-JS SHA-256 fallback for HTTP (non-HTTPS) local/LAN DHIS2 deployments |

Branding files (`d2.config.js`, `package.json` name, `public/manifest.json`, `public/dhis2-app-icon.png`, favicons, and `__MANIFEST_APP_TITLE` in `i18n/*.pot`/`*.po`) are **never merged by hand** — `npm run nepal:brand` regenerates them deterministically from `nepal/branding.json` and `nepal/assets/app-icon.png`.

---

## 4. Fast ~2–3s Nepal-Only Rebuilds (Skipping Unchanged Capture Core)

Because `DateField` loads `nepal-extension.js` through the runtime host bridge (`src/nepal/runtime/extensionHost.ts`), you only run a full `npm run build:zip` **once per upstream DHIS2 Capture version**.

Whenever you edit anything under `src/nepal/**`, `nepal/branding.json`, or `nepal/assets/app-icon.png`, run:

```bash
npm run nepal:build-fast
```

This recompiles **only** `src/nepal/**` with `esbuild` (~0.3s), updates branding/icons and cache-busting metadata, repacks `build/bundle/capture-app-np-<version>.zip`, and verifies the ZIP in ~2–3 seconds total.

---

## 5. Adding Future Nepal-Specific Features Safely

To ensure new Nepal customizations survive every future upstream sync automatically:
1. Build the feature in a dedicated subfolder under `src/nepal/<feature-name>/` (protected from upstream sync).
2. Add a feature flag in `src/nepal/config/nepalConfig.ts` (`NEPAL_FEATURES`).
3. Re-export the feature from `src/nepal/index.ts` (and expose via the runtime extension bridge if applicable).
4. Wire it into upstream Capture via a 1–3 line hook.
5. Add that hooked core file to `THREE_WAY_FILES` in `nepal/scripts/syncUpstream.mjs` and add an assertion in `nepal/scripts/verifyIntegration.mjs`.
