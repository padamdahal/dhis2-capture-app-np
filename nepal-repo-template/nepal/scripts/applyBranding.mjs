#!/usr/bin/env node
/**
 * Idempotent Nepal branding & identity stamper for capture-app-np.
 *
 * Reads nepal/branding.json and nepal/assets/app-icon.png and applies:
 *  1. d2.config.js (name, title, id, coreApp)
 *  2. package.json (name, cacheVersion)
 *  3. public/manifest.json (name, short_name, icons)
 *  4. public/dhis2-app-icon.png, all PNG favicons, and valid PNG-in-ICO public/favicon.ico
 *  5. __MANIFEST_APP_TITLE in i18n/en.pot and every i18n/*.po file
 *
 * Safe to run on every build and after every upstream DHIS2 Capture merge.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const BRANDING_PATH = path.join(ROOT, 'nepal', 'branding.json');
const branding = JSON.parse(fs.readFileSync(BRANDING_PATH, 'utf8'));

function writeIfChanged(filePath, nextContent) {
    const isBuffer = Buffer.isBuffer(nextContent);
    if (fs.existsSync(filePath)) {
        const current = isBuffer ? fs.readFileSync(filePath) : fs.readFileSync(filePath, 'utf8');
        const equal = isBuffer ? current.equals(nextContent) : current === nextContent;
        if (equal) return false;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, nextContent);
    return true;
}

function readPngDimensions(pngBuffer) {
    // PNG signature (8 bytes) + IHDR length (4) + 'IHDR' (4) + width (4 BE) + height (4 BE)
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (pngBuffer.length < 24 || !pngBuffer.subarray(0, 8).equals(pngSig)) {
        throw new Error(`Invalid PNG icon file: ${branding.iconSource}`);
    }
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);
    return { width, height };
}

function buildPngIco(pngBuffer) {
    const { width, height } = readPngDimensions(pngBuffer);
    const header = Buffer.alloc(22);
    // ICONDIR (6 bytes)
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: 1 = ICO
    header.writeUInt16LE(1, 4); // count: 1 image
    // ICONDIRENTRY (16 bytes)
    header.writeUInt8(width >= 256 ? 0 : width, 6);
    header.writeUInt8(height >= 256 ? 0 : height, 7);
    header.writeUInt8(0, 8); // color palette
    header.writeUInt8(0, 9); // reserved
    header.writeUInt16LE(1, 10); // color planes
    header.writeUInt16LE(32, 12); // bits per pixel
    header.writeUInt32LE(pngBuffer.length, 14); // image size
    header.writeUInt32LE(22, 18); // image data offset
    return Buffer.concat([header, pngBuffer]);
}

function stampD2Config() {
    const filePath = path.join(ROOT, 'd2.config.js');
    if (!fs.existsSync(filePath)) {
        throw new Error('d2.config.js not found at repository root');
    }
    let content = fs.readFileSync(filePath, 'utf8');

    const replacements = [
        [/^(\s*name:\s*)(['"`])[^'"`]*\2/m, `$1'${branding.name}'`],
        [/^(\s*title:\s*)(['"`])[^'"`]*\2/m, `$1'${branding.title}'`],
        [/^(\s*id:\s*)(['"`])[^'"`]*\2/m, `$1'${branding.id}'`],
        [/^(\s*coreApp:\s*)(true|false)/m, `$1${Boolean(branding.coreApp)}`],
    ];

    for (const [pattern, replacement] of replacements) {
        if (pattern.test(content)) {
            content = content.replace(pattern, replacement);
        } else {
            // Insert missing field directly after `const config = {`
            const fieldSnippet = replacement.replace('$1', '    ');
            content = content.replace(/(const\s+config\s*=\s*\{\n)/, `$1${fieldSnippet},\n`);
        }
    }

    return writeIfChanged(filePath, content);
}

function stampPackageJson() {
    const filePath = path.join(ROOT, 'package.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const indentMatch = raw.match(/\n([ \t]+)"name"/);
    const indent = indentMatch ? indentMatch[1] : '    ';
    const pkg = JSON.parse(raw);

    let changed = false;
    if (pkg.name !== branding.name) {
        pkg.name = branding.name;
        changed = true;
    }
    if (branding.cacheVersion && String(pkg.cacheVersion || '') !== String(branding.cacheVersion)) {
        pkg.cacheVersion = String(branding.cacheVersion);
        changed = true;
    }
    if (!changed) return false;
    return writeIfChanged(filePath, `${JSON.stringify(pkg, null, indent)}\n`);
}

function stampPublicManifest(iconDims) {
    const filePath = path.join(ROOT, 'public', 'manifest.json');
    const manifest = fs.existsSync(filePath)
        ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
        : {
            start_url: './index.html',
            display: 'standalone',
            theme_color: '#000000',
            background_color: '#ffffff',
        };

    manifest.short_name = branding.title;
    manifest.name = branding.title;
    manifest.icons = [
        {
            src: 'dhis2-app-icon.png',
            sizes: `${iconDims.width}x${iconDims.height}`,
            type: 'image/png',
        },
        {
            src: 'favicon.ico',
            sizes: '48x48',
            type: 'image/x-icon',
        },
    ];

    return writeIfChanged(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function stampIcons() {
    const iconSourcePath = path.join(ROOT, branding.iconSource);
    if (!fs.existsSync(iconSourcePath)) {
        throw new Error(`Master Nepal icon not found at ${branding.iconSource}`);
    }
    const pngBuffer = fs.readFileSync(iconSourcePath);
    const dims = readPngDimensions(pngBuffer);
    const icoBuffer = buildPngIco(pngBuffer);

    const pngTargets = [
        'dhis2-app-icon.png',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-48x48.png',
        'apple-touch-icon.png',
        'android-chrome-192x192.png',
        'android-chrome-384x384.png',
        'mstile-150x150.png',
    ];

    let updatedCount = 0;
    for (const filename of pngTargets) {
        if (writeIfChanged(path.join(ROOT, 'public', filename), pngBuffer)) {
            updatedCount += 1;
        }
    }
    if (writeIfChanged(path.join(ROOT, 'public', 'favicon.ico'), icoBuffer)) {
        updatedCount += 1;
    }

    return { updatedCount, dims };
}

function escapePoString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stampI18nAppTitle() {
    const i18nDir = path.join(ROOT, 'i18n');
    if (!fs.existsSync(i18nDir)) {
        return { total: 0, updated: 0 };
    }

    const escapedTitle = escapePoString(branding.title);
    const files = fs
        .readdirSync(i18nDir)
        .filter(name => name === 'en.pot' || name.endsWith('.po'))
        .sort();

    // Matches:
    // msgid "__MANIFEST_APP_TITLE"
    // msgstr "..." (including multiline continuation strings if any)
    const pattern = /(msgid\s+"__MANIFEST_APP_TITLE"\r?\n)msgstr\s+"(?:\\.|[^"\\])*"(?:\r?\n"(?:\\.|[^"\\])*")*/g;

    let updated = 0;
    for (const file of files) {
        const filePath = path.join(i18nDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.includes('"__MANIFEST_APP_TITLE"')) {
            continue;
        }
        const next = content.replace(pattern, `$1msgstr "${escapedTitle}"`);
        if (next !== content) {
            fs.writeFileSync(filePath, next, 'utf8');
            updated += 1;
        }
    }

    return { total: files.length, updated };
}

function main() {
    const d2Changed = stampD2Config();
    const pkgChanged = stampPackageJson();
    const { updatedCount: iconUpdated, dims } = stampIcons();
    const manifestChanged = stampPublicManifest(dims);
    const i18nResult = stampI18nAppTitle();

    console.log(
        `[nepal:brand] Applied "${branding.title}" (${branding.name}, id=${branding.id}, coreApp=${branding.coreApp})`,
    );
    console.log(
        `[nepal:brand] d2.config.js=${d2Changed ? 'updated' : 'ok'} | package.json=${pkgChanged ? 'updated' : 'ok'} | manifest.json=${manifestChanged ? 'updated' : 'ok'} | icons=${iconUpdated} updated | i18n=${i18nResult.updated}/${i18nResult.total} updated`,
    );
}

main();
