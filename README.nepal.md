# Capture NP (`capture-app-np`) — Nepal Distribution of DHIS2 Capture

**Capture NP** is a custom, standalone Nepal distribution of the official [DHIS2 Capture app](https://github.com/dhis2/capture-app) designed to install cleanly alongside core DHIS2 Capture without replacing or conflicting with it.

It adds an integrated **Bikram Sambat (BS)** Nepali date picker and dual AD/BS display directly on DHIS2 date fields while keeping stored DHIS2 values 100% standard ISO/Gregorian (AD).

---

## App Identity

| Property | Value |
|---|---|
| **Apps Menu Title** | `Capture NP` (stamped across all 38 DHIS2 locales) |
| **Package / Short Name** | `capture-app-np` |
| **Custom App UUID** | `c4f7a91e-8d2b-4f63-9a5c-7e1b3d0f82a4` |
| **Core App** | `false` (installs side-by-side with core `Capture`) |
| **Minimum DHIS2 Version** | `2.41` |
| **Upstream Baseline** | `dhis2/capture-app` (`v107.9.3`) |
| **App Icon** | `nepal/assets/app-icon.png` (`125×125` PNG + generated `favicon.ico`) |

---

## Nepal-Specific Features

### 1. Dual AD / Bikram Sambat (BS) Date Input
- **Right-side `BS` icon button** placed next to every Gregorian/ISO date input (Registration, Enrollment, Event, Incident, and Date of Birth fields).
- **Floating top-right BS pill** (`YYYY-MM-DD BS` or `DD-MM-YYYY BS`) overlapping the top-right border of the native AD input so both AD and BS dates remain visible at once without breaking form layouts.
- **Full BS Calendar Popover**:
  - Month selector (`Baisakh` through `Chaitra`) and year selector (`2000 BS` – `2099 BS`)
  - Direct BS text input with `Set` / `Enter` support and validation feedback
  - `Today` and `Clear` quick actions
  - Respects DHIS2 `calendarMax` (blocks future dates when future dates are disallowed)
  - Supports both `YYYY-MM-DD` and `DD-MM-YYYY` DHIS2 system date formats
- **Always stores standard AD dates** in DHIS2 — analytics, program rules, indicators, and API integrations work unchanged.
- **Age / Date of Birth compatibility**: Widens the DoB input (`185px`) so AD input, BS pill, and `BS` trigger fit cleanly; excludes range-filter date pickers (`hideNepaliPicker`) to keep filter bars compact.

### 2. Custom Branding & Side-by-Side Installation
- Uses a dedicated app UUID (`c4f7a91e-8d2b-4f63-9a5c-7e1b3d0f82a4`) and `coreApp: false` so DHIS2 administrators can run **Capture NP** alongside core **Capture**.
- Automatically sets `__MANIFEST_APP_TITLE = "Capture NP"` across `i18n/en.pot` and all `i18n/*.po` files so the DHIS2 Apps Menu never falls back to `"Capture"`.

### 3. Local / LAN Deployment Resilience
- Includes a safe `DHIS2_CACHE_VERSION` fallback (`4`) to prevent IndexedDB startup errors on standalone builds.
- Includes a pure-JS SHA-256 fallback when DHIS2 is accessed over plain `http://` on local/intranet servers where `crypto.subtle` is unavailable.

---

## Installing Capture NP in DHIS2

1. Download or build `capture-app-np-<version>.zip` (from **GitHub Releases** or via `npm run build:zip`).
2. Log into your DHIS2 instance as a superuser or user with App Management authority.
3. Open **App Management** → **Manual Install**.
4. Upload `capture-app-np-<version>.zip`.
5. Grant user roles access to **Capture NP** (`M_dhis-web-capture-app-np`) under **Users → User role**.
6. Open **Capture NP** from the DHIS2 Apps Menu.

---

## Local Development & Building

### Prerequisites
- **Node.js** `20+`
- **npm** `10+`
- **Python 3** (used only by `--zip` bundle inspection)

### Common Commands

```bash
# 1. Install dependencies
npm install

# 2. Start local dev server (http://localhost:3000)
npm run dev

# 3. Apply Nepal branding, icons, favicons, and i18n app titles
npm run nepal:brand

# 4. Run Nepal integration checks (aliases, 6 hooks, BS <-> AD roundtrips)
npm run nepal:verify

# 5. Typecheck
npm run lint

# 6. Build installable DHIS2 ZIP bundle (build/bundle/capture-app-np-<version>.zip)
npm run build:zip

# 7. Verify the built ZIP (manifest.webapp, 38 locale titles, embedded app icon)
node nepal/scripts/verifyIntegration.mjs --zip
```

> **Note:** `npm run build` and `npm run build:zip` automatically invoke `npm run nepal:brand` first so branding and icon assets are always up to date.

---

## Repository Architecture

All Nepal customizations are isolated from upstream DHIS2 Capture core code:

```text
src/nepal/                              # Isolated runtime extension (aliased as 'capture-nepal')
├── index.ts                            # Barrel export
├── config/
│   └── nepalConfig.ts                  # Typed branding metadata & NEPAL_FEATURES flags
└── calendar/
    ├── index.ts
    ├── nepaliDate.ts                   # BS <-> AD conversion & validation utilities
    └── NepaliDateAddon.component.tsx   # BS icon button, floating pill, and calendar popover

nepal/                                  # Branding config, master assets, scripts & docs
├── README.md                           # Quick reference inside nepal/
├── UPGRADE_GUIDE.md                    # Detailed upstream upgrade & extensibility playbook
├── branding.json                       # Single source of truth for app identity & upstream tag
├── assets/
│   └── app-icon.png                    # Master 125x125 Capture NP icon
└── scripts/
    ├── applyBranding.mjs               # Idempotent branding, icon & i18n title stamper
    ├── verifyIntegration.mjs           # 20-point integration & ZIP bundle verifier
    └── upgradeUpstream.sh              # Upstream dhis2/capture-app tag upgrade script

.github/workflows/
└── release-capture-app-np.yml          # CI/CD workflow for automated GitHub Release ZIPs
```

### Thin Upstream Hook Points
Only **6 core files** touch upstream DHIS2 Capture (verified automatically by `npm run nepal:verify`):
1. `src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.component.tsx` — mounts `<NepaliDateAddon>` when `NEPAL_FEATURES.nepaliDatePicker` is enabled
2. `src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.types.ts` — adds optional `hideNepaliPicker?: boolean`
3. `src/core_modules/capture-ui/DateAndTimeFields/DateRangeField/DateRangeField.component.tsx` — passes `hideNepaliPicker`
4. `src/core_modules/capture-ui/internal/AgeInput/AgeDateInput.component.tsx` (+ `AgeField/ageField.module.css`) — sets `185px` DoB width
5. `src/core_modules/capture-core/storageControllers/mainStorageController.ts` — `DHIS2_CACHE_VERSION` fallback
6. `src/core_modules/capture-core-utils/hash/hashSHA256.ts` — pure-JS SHA-256 fallback for HTTP servers

---

## Upgrading to a New Upstream DHIS2 Capture Release

Capture NP includes a **history-independent 3-way sync engine** designed for standalone repositories exported without upstream `dhis2/capture-app` Git history. It automatically protects all Nepal-owned folders (`src/nepal/`, `nepal/`, `server.ts`, workflows), runs true 3-way merges (`git merge-file --diff3`) on the thin Nepal hooks so upstream bugfixes and Nepal hooks are both preserved, and re-stamps branding + all 38 locale titles.

```bash
# 1. Check if a newer DHIS2 2.41+ compatible Capture release is available (zero file edits)
npm run nepal:check-updates

# 2. Preview upstream diff & simulate 3-way hook merges safely (zero file edits)
npm run nepal:sync:dry-run

# 3. Apply the latest DHIS2 2.41+ compatible release on an isolated upgrade/<tag> branch
npm run nepal:sync
#    (or sync to a specific tag: npm run nepal:sync -- --tag v107.10.0)
#    (or after resolving any rare hook conflict: npm run nepal:sync -- --finish v107.10.0)
```

See [`nepal/UPGRADE_GUIDE.md`](nepal/UPGRADE_GUIDE.md) for the full step-by-step playbook, conflict-resolution guide, fast ~2s Nepal-only rebuilds (`npm run nepal:build-fast`), and instructions on adding future Nepal features behind `NEPAL_FEATURES`.

---

## Automated GitHub Releases

Push a release tag matching `v<version>-np.<rev>`:

```bash
git tag v107.9.3-np.1
git push origin v107.9.3-np.1
```

GitHub Actions (`.github/workflows/release-capture-app-np.yml`) will automatically build, verify, compute a `.sha256` checksum, and attach `capture-app-np-<version>.zip` to the GitHub Release.

---

## Upstream Documentation & License

- Official upstream DHIS2 Capture README: [`README.md`](README.md)
- License: BSD-3-Clause (see [`LICENSE`](LICENSE))
