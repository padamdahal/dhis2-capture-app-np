#!/usr/bin/env node
/**
 * Integration verifier for capture-app-np.
 *
 * Checks:
 *  1. Nepal branding config & master PNG asset integrity
 *  2. Path alias wiring (tsconfig.json + vite.config.mts)
 *  3. Branded identity across d2.config.js, package.json, public/manifest.json, icons, and i18n
 *  4. Presence of the thin upstream DHIS2 Capture hooks (6 files)
 *  5. Live BS <-> AD calendar conversion & validation roundtrips via tsx
 *  6. Optional (--zip): verifies build/bundle/<name>-<version>.zip manifest, translations, and icon
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const CHECK_ZIP = process.argv.includes('--zip');
const errors = [];
const passes = [];

function pass(label) {
    passes.push(label);
    console.log(`  [PASS] ${label}`);
}

function fail(label, detail) {
    errors.push({ label, detail });
    console.error(`  [FAIL] ${label}: ${detail}`);
}

function assertFileContains(relPath, needles, label) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
        fail(label, `Missing file ${relPath}`);
        return;
    }
    const text = fs.readFileSync(fullPath, 'utf8');
    const missing = needles.filter(n => (n instanceof RegExp ? !n.test(text) : !text.includes(n)));
    if (missing.length > 0) {
        fail(label, `${relPath} missing expected marker(s): ${missing.map(String).join(', ')}`);
        return;
    }
    pass(label);
}

function verifyBrandingAndAssets(branding) {
    const iconSrc = path.join(ROOT, branding.iconSource);
    if (!fs.existsSync(iconSrc)) {
        fail('Master Nepal icon', `Not found at ${branding.iconSource}`);
        return;
    }
    const masterBuf = fs.readFileSync(iconSrc);
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!masterBuf.subarray(0, 8).equals(pngSig)) {
        fail('Master Nepal icon', `${branding.iconSource} is not a valid PNG`);
    } else {
        pass(`Master Nepal icon valid PNG (${masterBuf.length} bytes)`);
    }

    const publicIcon = path.join(ROOT, 'public', 'dhis2-app-icon.png');
    if (!fs.existsSync(publicIcon) || !fs.readFileSync(publicIcon).equals(masterBuf)) {
        fail('Public app icon', 'public/dhis2-app-icon.png does not match nepal/assets/app-icon.png (run npm run nepal:brand)');
    } else {
        pass('public/dhis2-app-icon.png matches master icon');
    }

    const faviconPath = path.join(ROOT, 'public', 'favicon.ico');
    if (!fs.existsSync(faviconPath)) {
        fail('Public favicon.ico', 'Missing public/favicon.ico');
    } else {
        const ico = fs.readFileSync(faviconPath);
        if (ico.length < 22 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
            fail('Public favicon.ico', 'Invalid ICO header');
        } else {
            pass(`public/favicon.ico valid ICO (${ico.length} bytes)`);
        }
    }

    assertFileContains(
        'd2.config.js',
        [
            new RegExp(`name:\\s*['"]${branding.name}['"]`),
            new RegExp(`title:\\s*['"]${branding.title}['"]`),
            new RegExp(`id:\\s*['"]${branding.id}['"]`),
            new RegExp(`coreApp:\\s*${Boolean(branding.coreApp)}`),
        ],
        'd2.config.js Nepal identity',
    );

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg.name !== branding.name) {
        fail('package.json name', `Expected "${branding.name}", got "${pkg.name}"`);
    } else {
        pass(`package.json name="${pkg.name}", version="${pkg.version}"`);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'));
    if (manifest.name !== branding.title || manifest.short_name !== branding.title) {
        fail('public/manifest.json', `Expected title "${branding.title}", got "${manifest.name}" / "${manifest.short_name}"`);
    } else {
        pass(`public/manifest.json title="${manifest.name}"`);
    }

    const i18nDir = path.join(ROOT, 'i18n');
    if (fs.existsSync(i18nDir)) {
        const files = fs.readdirSync(i18nDir).filter(f => f === 'en.pot' || f.endsWith('.po'));
        const mismatched = [];
        const expected = `msgid "__MANIFEST_APP_TITLE"\nmsgstr "${branding.title}"`;
        for (const f of files) {
            const raw = fs.readFileSync(path.join(i18nDir, f), 'utf8').replace(/\r\n/g, '\n');
            if (raw.includes('"__MANIFEST_APP_TITLE"') && !raw.includes(expected)) {
                mismatched.push(f);
            }
        }
        if (mismatched.length > 0) {
            fail('i18n __MANIFEST_APP_TITLE', `Mismatched title in: ${mismatched.join(', ')}`);
        } else {
            pass(`i18n __MANIFEST_APP_TITLE="${branding.title}" across ${files.length} files`);
        }
    }
}

function verifyAliasesAndHooks() {
    assertFileContains(
        'tsconfig.json',
        ['"capture-nepal"', '"./src/nepal"'],
        'tsconfig.json capture-nepal alias',
    );
    assertFileContains(
        'vite.config.mts',
        ["'capture-nepal'", "'src/nepal'"],
        'vite.config.mts capture-nepal alias',
    );
    assertFileContains(
        'src/nepal/index.ts',
        ['NEPAL_BRANDING', 'NEPAL_FEATURES', './calendar'],
        'src/nepal/index.ts barrel exports',
    );
    assertFileContains(
        'src/index.tsx',
        ["from 'capture-nepal/runtime/extensionHost'", 'ensureNepalExtensionLoaded'],
        'Hook #0: src/index.tsx Nepal extension preload',
    );
    assertFileContains(
        'src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.component.tsx',
        ["from 'capture-nepal/runtime/extensionHost'", 'NepalDateAddonBridge'],
        'Hook #1: Date.component.tsx -> NepalDateAddonBridge',
    );
    assertFileContains(
        'src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.types.ts',
        ['hideNepaliPicker'],
        'Hook #2: Date.types.ts hideNepaliPicker prop',
    );
    assertFileContains(
        'src/core_modules/capture-ui/DateAndTimeFields/DateRangeField/DateRangeField.component.tsx',
        ['hideNepaliPicker'],
        'Hook #3: DateRangeField.component.tsx hideNepaliPicker',
    );
    assertFileContains(
        'src/core_modules/capture-ui/internal/AgeInput/AgeDateInput.component.tsx',
        ['width={185}'],
        'Hook #4a: AgeDateInput.component.tsx DoB width',
    );
    assertFileContains(
        'src/core_modules/capture-ui/AgeField/ageField.module.css',
        ['185px'],
        'Hook #4b: ageField.module.css DoB container width',
    );
    assertFileContains(
        'src/core_modules/capture-core/storageControllers/mainStorageController.ts',
        ['DHIS2_CACHE_VERSION'],
        'Hook #5: mainStorageController.ts cache version fallback',
    );
    assertFileContains(
        'src/core_modules/capture-core-utils/hash/hashSHA256.ts',
        ['crypto?.subtle'],
        'Hook #6: hashSHA256.ts non-HTTPS fallback',
    );

    const deprecatedFiles = [
        'src/core_modules/capture-ui/utils/nepaliDate.ts',
        'src/core_modules/capture-ui/DateAndTimeFields/DateField/NepaliDateSubField.component.tsx',
    ];
    for (const rel of deprecatedFiles) {
        if (fs.existsSync(path.join(ROOT, rel))) {
            fail('Cleanup check', `Deprecated duplicate file still exists: ${rel}`);
        }
    }
    pass('No deprecated duplicate Nepal calendar files in capture-ui');
}

function verifyCalendarConversion() {
    const tsxBin = path.join(ROOT, 'node_modules', '.bin', 'tsx');
    const runner = fs.existsSync(tsxBin) ? tsxBin : 'npx';
    const baseArgs = fs.existsSync(tsxBin) ? [] : ['tsx'];

    const script = `
import { adStringToBsParts, bsPartsToAd, parseAndConvertBsInput } from './src/nepal/calendar/nepaliDate.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// 2026-11-18 AD <-> 2083-08-02 BS
const bs1 = adStringToBsParts('2026-11-18', 'YYYY-MM-DD');
assert(bs1 && bs1.formatted === '2083-08-02', 'Expected 2026-11-18 -> 2083-08-02, got ' + JSON.stringify(bs1));

const ad1 = bsPartsToAd(2083, 8, 2, 'YYYY-MM-DD');
assert(ad1 && ad1.adFormatted === '2026-11-18', 'Expected 2083-08-02 -> 2026-11-18, got ' + JSON.stringify(ad1));

// DD-MM-YYYY format roundtrip (Baisakh 1, 2082 BS = 14-04-2025 AD)
const ad2 = bsPartsToAd(2082, 1, 1, 'DD-MM-YYYY');
assert(ad2 && ad2.adFormatted === '14-04-2025' && ad2.bsFormatted === '01-01-2082', 'Expected 01-01-2082 -> 14-04-2025, got ' + JSON.stringify(ad2));

const bs2 = adStringToBsParts('14-04-2025', 'DD-MM-YYYY');
assert(bs2 && bs2.formatted === '01-01-2082', 'Expected 14-04-2025 -> 01-01-2082, got ' + JSON.stringify(bs2));

// Max date rejection
const maxCheck = parseAndConvertBsInput('2083-08-05', 'YYYY-MM-DD', '2026-11-18');
assert(maxCheck.valid === false && maxCheck.errorCode === 'INVALID_DATE_MORE_THAN_MAX', 'Expected max date violation, got ' + JSON.stringify(maxCheck));

// Invalid calendar date rejection
const invalidCheck = parseAndConvertBsInput('2083-13-40', 'YYYY-MM-DD');
assert(invalidCheck.valid === false, 'Expected invalid BS date to fail');

console.log('BS_CONVERSION_OK');
`;

    try {
        const out = execFileSync(runner, [...baseArgs, '-e', script], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (out.includes('BS_CONVERSION_OK')) {
            pass('BS <-> AD conversion & validation roundtrips');
        } else {
            fail('BS <-> AD conversion', `Unexpected output: ${out}`);
        }
    } catch (err) {
        fail('BS <-> AD conversion', err.stderr || err.message);
    }
}

function verifyZipBundle(branding) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const zipPath = path.join(ROOT, 'build', 'bundle', `${branding.name}-${pkg.version}.zip`);
    if (!fs.existsSync(zipPath)) {
        fail('DHIS2 ZIP bundle', `Expected ${path.relative(ROOT, zipPath)} not found`);
        return;
    }

    const pyInspect = `
import json, sys, zipfile
zip_path, icon_path, expected_title, expected_name, expected_id, expected_core = sys.argv[1:7]
with zipfile.ZipFile(zip_path, 'r') as zf:
    names = set(zf.namelist())
    if 'manifest.webapp' not in names:
        raise SystemExit('manifest.webapp missing in ZIP')
    manifest = json.loads(zf.read('manifest.webapp').decode('utf-8'))
    assert manifest.get('name') == expected_title, f"manifest.webapp name={manifest.get('name')}"
    assert manifest.get('short_name') == expected_name, f"manifest.webapp short_name={manifest.get('short_name')}"
    assert manifest.get('app_hub_id') == expected_id, f"manifest.webapp app_hub_id={manifest.get('app_hub_id')}"
    assert bool(manifest.get('core_app')) == (expected_core == 'true'), f"manifest.webapp core_app={manifest.get('core_app')}"

    if 'manifest.webapp.translations.json' in names:
        tr = json.loads(zf.read('manifest.webapp.translations.json').decode('utf-8'))
        entries = tr if isinstance(tr, list) else [dict(locale=k, **v) for k, v in tr.items() if isinstance(v, dict)]
        assert len(entries) > 0, 'manifest.webapp.translations.json is empty'
        for entry in entries:
            loc = entry.get('locale', '?')
            if 'title' in entry:
                assert entry['title'] == expected_title, f"translation[{loc}].title={entry['title']}"
            if 'name' in entry:
                assert entry['name'] == expected_title, f"translation[{loc}].name={entry['name']}"

    assert 'dhis2-app-icon.png' in names, 'dhis2-app-icon.png missing in ZIP'
    with open(icon_path, 'rb') as f:
        expected_icon = f.read()
    actual_icon = zf.read('dhis2-app-icon.png')
    assert actual_icon == expected_icon, 'dhis2-app-icon.png inside ZIP does not match nepal/assets/app-icon.png'

    assert 'nepal-extension.js' in names, 'nepal-extension.js missing in ZIP'
    assert 'nepal-extension.meta.json' in names, 'nepal-extension.meta.json missing in ZIP'
    ext_code = zf.read('nepal-extension.js').decode('utf-8')
    assert '__CAPTURE_NP_HOST__' in ext_code, 'nepal-extension.js missing host bridge binding'
    ext_meta = json.loads(zf.read('nepal-extension.meta.json').decode('utf-8'))
    assert ext_meta.get('hash') and ext_meta.get('title') == expected_title, f'Invalid nepal-extension.meta.json: {ext_meta}'

print('ZIP_VERIFIED_OK')
`;

    try {
        const out = execFileSync(
            'python3',
            [
                '-c',
                pyInspect,
                zipPath,
                path.join(ROOT, branding.iconSource),
                branding.title,
                branding.name,
                branding.id,
                String(Boolean(branding.coreApp)),
            ],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        if (out.includes('ZIP_VERIFIED_OK')) {
            const sizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
            pass(`DHIS2 ZIP verified: ${path.basename(zipPath)} (${sizeMb} MB)`);
        } else {
            fail('DHIS2 ZIP bundle', `Unexpected output: ${out}`);
        }
    } catch (err) {
        fail('DHIS2 ZIP bundle', err.stderr || err.message);
    }
}

function main() {
    console.log('[nepal:verify] Running Capture NP integration checks...');
    const brandingPath = path.join(ROOT, 'nepal', 'branding.json');
    if (!fs.existsSync(brandingPath)) {
        fail('nepal/branding.json', 'Missing branding configuration');
        process.exit(1);
    }
    const branding = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));

    verifyBrandingAndAssets(branding);
    verifyAliasesAndHooks();
    verifyCalendarConversion();
    if (CHECK_ZIP) {
        verifyZipBundle(branding);
    }

    console.log(`[nepal:verify] Summary: ${passes.length} passed, ${errors.length} failed.`);
    if (errors.length > 0) {
        process.exit(1);
    }
}

main();
