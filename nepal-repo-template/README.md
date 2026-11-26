# Capture NP (`capture-app-np`) — Nepal-Only Overlay Repository

This repository maintains **Capture NP**, a custom Nepal distribution of [DHIS2 Capture](https://github.com/dhis2/capture-app) (`coreApp: false`, Apps Menu title `"Capture NP"`, custom UUID `c4f7a91e-8d2b-4f63-9a5c-7e1b3d0f82a4`) with an integrated **Bikram Sambat (BS)** date picker and floating dual AD/BS pill.

Unlike a full fork, this repository commits **zero upstream DHIS2 Capture core code** (~20 Nepal files total). At build time, it automatically shallow-clones and caches the pinned upstream release tag, overlays your Nepal features and branding, runs 20 automated verification checks, and outputs an installable DHIS2 `.zip`.

---

## 1. First-Time Push to a Fresh GitHub Repository

After unzipping this starter package:

```bash
cd capture-app-np-overlay
git init -b main
git add -A
git commit -m "chore: initial Capture NP Nepal-only overlay repository"
git remote add origin https://github.com/<your-org>/capture-app-np.git
git push -u origin main
```

---

## 2. Local Build & Fast Iteration

### Prerequisites
- **Node.js** `20+` and **npm** `10+`
- **Git** and **Python 3** (used for ZIP verification)

### One-Time Base Build (Per Upstream DHIS2 Capture Tag)

```bash
npm install
npm run build:full
```

What `npm run build:full` does:
1. Shallow-clones `upstreamRepo` at `upstreamBaseTag` (`v107.9.3`) into `.nepal-cache/upstream-base/` and installs upstream dependencies once.
2. Stages a clean build workspace (`.nepal-workspace/`), applies the thin Capture hooks and `src/nepal/**`, stamps `Capture NP` branding/icons across all 38 locales, builds the bundle, and runs all 20 verification checks.
3. Copies the installable DHIS2 bundle to `dist/capture-app-np-<version>.zip`.

### Fast ~2-Second Nepal-Only Rebuilds

Whenever you edit anything under `src/nepal/**`, `nepal/branding.json`, or `nepal/assets/app-icon.png`, run:

```bash
npm run build:fast
```

Recompiles **only** `src/nepal/**`, re-stamps branding/icons, repacks `dist/capture-app-np-<version>.zip`, and re-verifies the ZIP in ~2 seconds—zero network calls and zero Capture core recompilation.

---

## 3. Pulling Latest Upstream DHIS2 Capture Releases

### Step 1 — Check for Newer DHIS2 2.41+ Compatible Releases

```bash
npm run check-updates
```

This queries `dhis2/capture-app` tags, skips pre-releases, checks `minDHIS2Version <= 2.41`, and prints the latest compatible tag without modifying any files.

### Step 2 — Test Against the New Tag Locally

```bash
npm run build:full -- --tag v107.9.5
```

### Step 3 — Pin & Publish Release ZIP via GitHub Actions

1. Update `upstreamBaseTag` in `nepal/branding.json` to the verified tag (e.g. `"v107.9.5"`).
2. Commit, tag, and push:

```bash
git add nepal/branding.json
git commit -m "chore: upgrade upstream Capture base to v107.9.5"
git tag v107.9.5-np.1
git push origin main --tags
```

GitHub Actions (`.github/workflows/release-capture-app-np.yml`) automatically caches the upstream tag, overlays Nepal features, runs all 20 verification checks, computes a `.sha256` checksum, and attaches `capture-app-np-<version>.zip` to a GitHub Release.

You can also trigger a manual build anytime under **GitHub → Actions → Release Capture NP (DHIS2 ZIP) → Run workflow**.

---

## 4. Installing Capture NP in DHIS2

1. Open **DHIS2 → App Management → Manual Install**.
2. Upload `dist/capture-app-np-<version>.zip` (or download it from your GitHub Release).
3. Under **Users → User role**, grant access to **Capture NP** (`M_dhis-web-capture-app-np`).
4. Open **Capture NP** from the DHIS2 Apps Menu (installs side-by-side with core Capture).

---

## 5. Adding Future Nepal-Specific Features

1. Create a module under `src/nepal/<feature-name>/`.
2. Add a feature flag in `src/nepal/config/nepalConfig.ts` (`NEPAL_FEATURES`).
3. Export it via `src/nepal/index.ts` / `src/nepal/extensionEntry.ts`.
4. If a new Capture core hook is needed, add the patch in `nepal/scripts/applyOverlayToBase.mjs` and an assertion in `nepal/scripts/verifyIntegration.mjs`.

See [`nepal/UPGRADE_GUIDE.md`](nepal/UPGRADE_GUIDE.md) for full details.
