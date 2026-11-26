# Nepal Extension & Release Tooling (`nepal/`)

This directory holds the single-source branding configuration, master app icon, history-independent upstream sync engine, and maintainer documentation for **Capture NP (`capture-app-np`)**.

- Full project documentation: [`../README.nepal.md`](../README.nepal.md)
- Detailed upstream sync & feature extension playbook: [`UPGRADE_GUIDE.md`](UPGRADE_GUIDE.md)

## Quick Commands (run from repository root)

| Command | Description |
|---|---|
| `npm run nepal:check-updates` | Checks upstream `dhis2/capture-app` for the latest stable DHIS2 2.41+ compatible release (zero file edits) |
| `npm run nepal:sync:dry-run` | Previews upstream file changes and simulates 3-way merges on all thin Nepal hooks (zero file edits) |
| `npm run nepal:sync` | Syncs to the latest DHIS2 2.41+ stable release on an isolated `upgrade/<tag>` branch, re-brands, verifies, and builds the ZIP |
| `npm run nepal:sync -- --tag v107.10.0` | Syncs to an explicit upstream tag |
| `npm run nepal:sync -- --finish <tag>` | Resumes branding, verification, lint, and ZIP build after resolving a manual hook conflict |
| `npm run nepal:brand` | Stamps `d2.config.js`, `package.json`, `public/manifest.json`, icons/`favicon.ico`, and `__MANIFEST_APP_TITLE` in `i18n/*` |
| `npm run nepal:verify` | Verifies branding, icon integrity, `capture-nepal` aliases, all thin upstream hooks, and BS ↔ AD conversions |
| `npm run nepal:build-fast` | ~2–3s Nepal-only rebuild that updates `nepal-extension.js`, branding, and ZIP without rebuilding Capture core |
| `npm run build:zip` | Full production build + `build/bundle/capture-app-np-<version>.zip` |
| `node nepal/scripts/verifyIntegration.mjs --zip` | Inspects the built ZIP's `manifest.webapp`, 38 locale titles, embedded icon, and `nepal-extension.js` |

## Contents

- `branding.json` — App name, title (`Capture NP`), custom UUID, `coreApp: false`, cache version, icon path, tracked upstream tag, and DHIS2 compatibility target (`maxMinDHIS2Version: "2.41"`).
- `assets/app-icon.png` — Master `125×125` Capture NP icon.
- `scripts/syncUpstream.mjs` — History-independent upstream release discovery, dry-run preview, and 3-way hook merge engine.
- `scripts/upgradeUpstream.sh` — Shell wrapper delegating to `syncUpstream.mjs`.
- `scripts/applyBranding.mjs` — Idempotent branding & i18n stamper.
- `scripts/verifyIntegration.mjs` — 21-point integration & ZIP verifier.
- `UPGRADE_GUIDE.md` — Step-by-step upstream sync, conflict recovery, and new-feature guide.
