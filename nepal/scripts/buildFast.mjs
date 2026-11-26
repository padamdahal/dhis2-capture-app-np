#!/usr/bin/env node
/**
 * Fast Nepal-only incremental rebuild (~2-3 seconds).
 *
 * Rebuilds ONLY:
 *  1. Nepal branding/icons/manifests into public/ and cached build/app/
 *  2. Standalone Nepal runtime extension (src/nepal/** -> nepal-extension.js + meta.json)
 *  3. Installable DHIS2 bundle ZIP (build/bundle/capture-app-np-<version>.zip)
 *  4. Full integration & ZIP verification
 *
 * Skips recompiling the 7,300+ unchanged DHIS2 Capture core modules completely.
 *
 * Usage:
 *   npm run nepal:build-fast
 *   node nepal/scripts/buildFast.mjs [--init-base] [--no-verify]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildNepalExtension } from './buildExtension.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const INIT_BASE = process.argv.includes('--init-base');
const SKIP_VERIFY = process.argv.includes('--no-verify');

function syncBrandingIntoBuildApp(branding, buildAppDir) {
    const publicDir = path.join(ROOT, 'public');
    const iconFiles = [
        'dhis2-app-icon.png',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-48x48.png',
        'apple-touch-icon.png',
        'android-chrome-192x192.png',
        'android-chrome-384x384.png',
        'mstile-150x150.png',
        'favicon.ico',
        'manifest.json',
    ];

    for (const file of iconFiles) {
        const src = path.join(publicDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(buildAppDir, file));
        }
    }

    const webappManifestPath = path.join(buildAppDir, 'manifest.webapp');
    if (fs.existsSync(webappManifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(webappManifestPath, 'utf8'));
        manifest.name = branding.title;
        manifest.short_name = branding.name;
        manifest.app_hub_id = branding.id;
        manifest.core_app = Boolean(branding.coreApp);
        manifest.manifest_generated_at = new Date().toUTCString();
        fs.writeFileSync(webappManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    const translationsPath = path.join(buildAppDir, 'manifest.webapp.translations.json');
    if (fs.existsSync(translationsPath)) {
        const tr = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
        if (Array.isArray(tr)) {
            for (const entry of tr) {
                if (entry && typeof entry === 'object' && 'title' in entry) {
                    entry.title = branding.title;
                }
            }
        } else if (tr && typeof tr === 'object') {
            for (const entry of Object.values(tr)) {
                if (entry && typeof entry === 'object') {
                    if ('title' in entry) entry.title = branding.title;
                    if ('name' in entry) entry.name = branding.title;
                }
            }
        }
        fs.writeFileSync(translationsPath, `${JSON.stringify(tr, null, 2)}\n`, 'utf8');
    }
}

function packZipFast(buildAppDir, zipPath) {
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const pyPack = `
import os, sys, zipfile
src_dir, zip_path = sys.argv[1], sys.argv[2]
tmp_path = zip_path + '.tmp'
with zipfile.ZipFile(tmp_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, src_dir)
            zf.write(full, rel)
os.replace(tmp_path, zip_path)
`;
    execFileSync('python3', ['-c', pyPack, buildAppDir, zipPath], {
        cwd: ROOT,
        stdio: 'inherit',
    });
}

async function main() {
    const t0 = Date.now();
    const buildAppDir = path.join(ROOT, 'build', 'app');
    const branding = JSON.parse(fs.readFileSync(path.join(ROOT, 'nepal', 'branding.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    if (!fs.existsSync(path.join(buildAppDir, 'index.html'))) {
        if (INIT_BASE) {
            console.log('[nepal:build-fast] Cached base build/app not found; running one-time full base build...');
            execSync('npm run build:zip', { cwd: ROOT, stdio: 'inherit' });
            return;
        }
        console.error('[nepal:build-fast] Base build/app/index.html not found.');
        console.error('Run `npm run build:zip` once (or pass `--init-base`) to initialize the Capture core base.');
        process.exit(1);
    }

    console.log('[nepal:build-fast] Skipping 7,300+ unchanged Capture core modules...');

    // 1. Re-stamp branding/icons into repo & cached build/app
    execFileSync('node', [path.join(ROOT, 'nepal', 'scripts', 'applyBranding.mjs')], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    syncBrandingIntoBuildApp(branding, buildAppDir);

    // 2. Recompile ONLY src/nepal/** (~0.4s)
    await buildNepalExtension({
        rootDir: ROOT,
        outDirs: [path.join(ROOT, 'public'), buildAppDir],
    });

    // 3. Repack DHIS2 ZIP bundle (~1s)
    const zipFilename = `${branding.name}-${pkg.version}.zip`;
    const zipPath = path.join(ROOT, 'build', 'bundle', zipFilename);
    packZipFast(buildAppDir, zipPath);
    const sizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
    console.log(`[nepal:build-fast] Packed ${path.relative(ROOT, zipPath)} (${sizeMb} MB)`);

    // 4. Verify ZIP & hooks
    if (!SKIP_VERIFY) {
        execFileSync('node', [path.join(ROOT, 'nepal', 'scripts', 'verifyIntegration.mjs'), '--zip'], {
            cwd: ROOT,
            stdio: 'inherit',
        });
    }

    const totalSec = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[nepal:build-fast] Done in ${totalSec}s (Nepal-only incremental rebuild).`);
}

main().catch((err) => {
    console.error('[nepal:build-fast] Failed:', err);
    process.exit(1);
});
