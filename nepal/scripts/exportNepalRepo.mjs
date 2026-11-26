#!/usr/bin/env node
/**
 * Generates a clean, ready-to-push Nepal-only overlay GitHub repository in
 * `nepal-repo-template/` and packages it as
 * `build/bundle/capture-app-np-overlay-repo.zip`.
 *
 * The exported repository contains ZERO upstream DHIS2 Capture core bloat —
 * only Nepal features, branding/icon assets, minimal hook references,
 * upstream DHIS2 2.41+ update checker, overlay & ~2s fast-rebuild scripts,
 * a cached GitHub Actions release workflow, LICENSE, and first-commit README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const TEMPLATE_DIR = path.join(ROOT, 'nepal-repo-template');
const ZIP_OUTPUT = path.join(ROOT, 'build', 'bundle', 'capture-app-np-overlay-repo.zip');

function copyFile(relSrc, relDst = relSrc) {
    const src = path.join(ROOT, relSrc);
    const dst = path.join(TEMPLATE_DIR, relDst);
    if (!fs.existsSync(src)) {
        throw new Error(`Missing source file for Nepal repo template: ${relSrc}`);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

function main() {
    const branding = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepal', 'branding.json'), 'utf8'));

    fs.rmSync(TEMPLATE_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });

    // 1. Copy isolated Nepal runtime module
    fs.cpSync(path.join(ROOT, 'src', 'nepal'), path.join(TEMPLATE_DIR, 'src', 'nepal'), { recursive: true });

    // 2. Copy minimal upstream hook reference files used by applyOverlayToBase.mjs
    copyFile('src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.component.tsx');
    copyFile('src/core_modules/capture-core-utils/hash/hashSHA256.ts');

    // 3. Copy branding config, master icon, license, scripts, and upgrade docs
    copyFile('nepal/branding.json');
    copyFile('nepal/assets/app-icon.png');
    copyFile('nepal/UPGRADE_GUIDE.md');
    copyFile('nepal/README.md');
    if (fs.existsSync(path.join(ROOT, 'LICENSE'))) {
        copyFile('LICENSE');
    }

    for (const script of [
        'applyBranding.mjs',
        'applyOverlayToBase.mjs',
        'buildExtension.mjs',
        'buildFast.mjs',
        'buildRulesEngineCached.mjs',
        'syncUpstream.mjs',
        'verifyIntegration.mjs',
    ]) {
        copyFile(`nepal/scripts/${script}`);
    }

    // 4. Write clean Nepal-only package.json
    const templatePkg = {
        name: `${branding.name}-overlay`,
        version: '1.0.0',
        private: true,
        license: 'BSD-3-Clause',
        description:
            'Tiny Nepal-only overlay repository for DHIS2 Capture NP (BS calendar, custom branding, DHIS2 2.41+ update check, ~2s fast rebuilds)',
        scripts: {
            'check-updates': 'node nepal/scripts/syncUpstream.mjs --check',
            overlay: 'node nepal/scripts/applyOverlayToBase.mjs',
            'build:full': 'node nepal/scripts/applyOverlayToBase.mjs --build-full',
            'build:fast': 'node nepal/scripts/applyOverlayToBase.mjs --build-fast',
            'build:ext': 'node nepal/scripts/buildExtension.mjs --out dist',
        },
        dependencies: {
            'nepali-date-converter': '^3.4.2',
        },
        devDependencies: {
            esbuild: '^0.25.0',
            tsx: '^4.21.0',
            typescript: '^5.8.2',
        },
    };
    fs.writeFileSync(
        path.join(TEMPLATE_DIR, 'package.json'),
        `${JSON.stringify(templatePkg, null, 2)}\n`,
        'utf8',
    );

    // 5. Write .gitignore
    const gitignore = `# Dependencies
node_modules/

# Overlay staging & cached upstream Capture clones
.nepal-workspace/
.nepal-cache/

# Generated bundles & build output
dist/
build/

# OS & logs
.DS_Store
*.log
npm-debug.log*
`;
    fs.writeFileSync(path.join(TEMPLATE_DIR, '.gitignore'), gitignore, 'utf8');

    // 6. Write GitHub Actions workflow tailored specifically for the Nepal-only overlay repo (with upstream cache)
    const workflowYaml = `name: Release Capture NP (DHIS2 ZIP)

on:
  push:
    tags:
      - 'v*-np*'
  workflow_dispatch:
    inputs:
      upstream_tag:
        description: 'Upstream dhis2/capture-app tag (defaults to nepal/branding.json upstreamBaseTag)'
        required: false
        default: ''
      release_tag:
        description: 'Optional GitHub Release tag (e.g. v107.9.3-np.1). Leave blank to build artifact only.'
        required: false
        default: ''

permissions:
  contents: write

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Nepal overlay repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Resolve upstream DHIS2 Capture tag
        id: upstream
        run: |
          TAG="\${{ inputs.upstream_tag }}"
          if [ -z "$TAG" ]; then
            TAG="$(node -p "require('./nepal/branding.json').upstreamBaseTag")"
          fi
          REPO="$(node -p "require('./nepal/branding.json').upstreamRepo")"
          echo "tag=\${TAG}" >> "$GITHUB_OUTPUT"
          echo "repo=\${REPO}" >> "$GITHUB_OUTPUT"

      - name: Cache upstream Capture base clone & node_modules
        uses: actions/cache@v4
        with:
          path: .nepal-cache/upstream-base
          key: \${{ runner.os }}-capture-base-\${{ steps.upstream.outputs.tag }}
          restore-keys: |
            \${{ runner.os }}-capture-base-

      - name: Install Nepal overlay tooling
        run: npm install --no-audit --no-fund

      - name: Apply Nepal overlay on upstream tag, build Capture NP ZIP & verify
        run: npm run build:full -- --repo "\${{ steps.upstream.outputs.repo }}" --tag "\${{ steps.upstream.outputs.tag }}"

      - name: Compute checksum & artifact metadata
        id: bundle
        run: |
          ZIP_FILE="$(ls dist/capture-app-np-*.zip | head -n 1)"
          if [ ! -f "$ZIP_FILE" ]; then
            echo "Expected ZIP not found in dist/"
            exit 1
          fi
          sha256sum "$ZIP_FILE" > "\${ZIP_FILE}.sha256"
          echo "zip_file=\${ZIP_FILE}" >> "$GITHUB_OUTPUT"
          echo "sha_file=\${ZIP_FILE}.sha256" >> "$GITHUB_OUTPUT"

      - name: Upload DHIS2 Capture NP ZIP artifact
        uses: actions/upload-artifact@v4
        with:
          name: capture-app-np-bundle
          path: |
            \${{ steps.bundle.outputs.zip_file }}
            \${{ steps.bundle.outputs.sha_file }}

      - name: Publish GitHub Release
        if: startsWith(github.ref, 'refs/tags/v') || inputs.release_tag != ''
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ inputs.release_tag != '' && inputs.release_tag || github.ref_name }}
          name: Capture NP \${{ inputs.release_tag != '' && inputs.release_tag || github.ref_name }}
          generate_release_notes: true
          files: |
            \${{ steps.bundle.outputs.zip_file }}
            \${{ steps.bundle.outputs.sha_file }}
`;
    const wfDir = path.join(TEMPLATE_DIR, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'release-capture-app-np.yml'), workflowYaml, 'utf8');

    // 7. Write comprehensive first-commit README.md for the Nepal-only GitHub repository
    const readme = `# Capture NP (\`capture-app-np\`) — Nepal-Only Overlay Repository

This repository maintains **Capture NP**, a custom Nepal distribution of [DHIS2 Capture](https://github.com/dhis2/capture-app) (\`coreApp: false\`, Apps Menu title \`"Capture NP"\`, custom UUID \`${branding.id}\`) with an integrated **Bikram Sambat (BS)** date picker and floating dual AD/BS pill.

Unlike a full fork, this repository commits **zero upstream DHIS2 Capture core code** (~20 Nepal files total). At build time, it automatically shallow-clones and caches the pinned upstream release tag, overlays your Nepal features and branding, runs 20 automated verification checks, and outputs an installable DHIS2 \`.zip\`.

---

## 1. First-Time Push to a Fresh GitHub Repository

After unzipping this starter package:

\`\`\`bash
cd capture-app-np-overlay
git init -b main
git add -A
git commit -m "chore: initial Capture NP Nepal-only overlay repository"
git remote add origin https://github.com/<your-org>/capture-app-np.git
git push -u origin main
\`\`\`

---

## 2. Local Build & Fast Iteration

### Prerequisites
- **Node.js** \`20+\` and **npm** \`10+\`
- **Git** and **Python 3** (used for ZIP verification)

### One-Time Base Build (Per Upstream DHIS2 Capture Tag)

\`\`\`bash
npm install
npm run build:full
\`\`\`

What \`npm run build:full\` does:
1. Shallow-clones \`upstreamRepo\` at \`upstreamBaseTag\` (\`${branding.upstreamBaseTag}\`) into \`.nepal-cache/upstream-base/\` and installs upstream dependencies once.
2. Stages a clean build workspace (\`.nepal-workspace/\`), applies the thin Capture hooks and \`src/nepal/**\`, stamps \`Capture NP\` branding/icons across all 38 locales, builds the bundle, and runs all 20 verification checks.
3. Copies the installable DHIS2 bundle to \`dist/capture-app-np-<version>.zip\`.

### Fast ~2-Second Nepal-Only Rebuilds

Whenever you edit anything under \`src/nepal/**\`, \`nepal/branding.json\`, or \`nepal/assets/app-icon.png\`, run:

\`\`\`bash
npm run build:fast
\`\`\`

Recompiles **only** \`src/nepal/**\`, re-stamps branding/icons, repacks \`dist/capture-app-np-<version>.zip\`, and re-verifies the ZIP in ~2 seconds—zero network calls and zero Capture core recompilation.

---

## 3. Pulling Latest Upstream DHIS2 Capture Releases

### Step 1 — Check for Newer DHIS2 ${branding.maxMinDHIS2Version || '2.41'}+ Compatible Releases

\`\`\`bash
npm run check-updates
\`\`\`

This queries \`dhis2/capture-app\` tags, skips pre-releases, checks \`minDHIS2Version <= ${branding.maxMinDHIS2Version || '2.41'}\`, and prints the latest compatible tag without modifying any files.

### Step 2 — Test Against the New Tag Locally

\`\`\`bash
npm run build:full -- --tag v107.9.5
\`\`\`

### Step 3 — Pin & Publish Release ZIP via GitHub Actions

1. Update \`upstreamBaseTag\` in \`nepal/branding.json\` to the verified tag (e.g. \`"v107.9.5"\`).
2. Commit, tag, and push:

\`\`\`bash
git add nepal/branding.json
git commit -m "chore: upgrade upstream Capture base to v107.9.5"
git tag v107.9.5-np.1
git push origin main --tags
\`\`\`

GitHub Actions (\`.github/workflows/release-capture-app-np.yml\`) automatically caches the upstream tag, overlays Nepal features, runs all 20 verification checks, computes a \`.sha256\` checksum, and attaches \`capture-app-np-<version>.zip\` to a GitHub Release.

You can also trigger a manual build anytime under **GitHub → Actions → Release Capture NP (DHIS2 ZIP) → Run workflow**.

---

## 4. Installing Capture NP in DHIS2

1. Open **DHIS2 → App Management → Manual Install**.
2. Upload \`dist/capture-app-np-<version>.zip\` (or download it from your GitHub Release).
3. Under **Users → User role**, grant access to **Capture NP** (\`M_dhis-web-capture-app-np\`).
4. Open **Capture NP** from the DHIS2 Apps Menu (installs side-by-side with core Capture).

---

## 5. Adding Future Nepal-Specific Features

1. Create a module under \`src/nepal/<feature-name>/\`.
2. Add a feature flag in \`src/nepal/config/nepalConfig.ts\` (\`NEPAL_FEATURES\`).
3. Export it via \`src/nepal/index.ts\` / \`src/nepal/extensionEntry.ts\`.
4. If a new Capture core hook is needed, add the patch in \`nepal/scripts/applyOverlayToBase.mjs\` and an assertion in \`nepal/scripts/verifyIntegration.mjs\`.

See [\`nepal/UPGRADE_GUIDE.md\`](nepal/UPGRADE_GUIDE.md) for full details.
`;
    fs.writeFileSync(path.join(TEMPLATE_DIR, 'README.md'), readme, 'utf8');

    // 8. Package nepal-repo-template/ into build/bundle/capture-app-np-overlay-repo.zip
    fs.mkdirSync(path.dirname(ZIP_OUTPUT), { recursive: true });
    const pyZip = `
import os, sys, zipfile
src_dir, zip_path = sys.argv[1], sys.argv[2]
tmp_path = zip_path + '.tmp'
with zipfile.ZipFile(tmp_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.join('capture-app-np-overlay', os.path.relpath(full, src_dir))
            zf.write(full, rel)
os.replace(tmp_path, zip_path)
`;
    execFileSync('python3', ['-c', pyZip, TEMPLATE_DIR, ZIP_OUTPUT], {
        cwd: ROOT,
        stdio: 'inherit',
    });

    const sizeKb = (fs.statSync(ZIP_OUTPUT).size / 1024).toFixed(1);
    console.log(`[nepal:export-repo] Generated nepal-repo-template/ and ${path.relative(ROOT, ZIP_OUTPUT)} (${sizeKb} KB)`);
}

main();
