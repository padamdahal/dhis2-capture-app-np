#!/usr/bin/env node
/**
 * History-independent upstream DHIS2 Capture sync engine for Capture NP.
 *
 * Works in standalone repositories exported WITHOUT shared `dhis2/capture-app`
 * git history by caching shallow snapshots of the tracked baseline tag and the
 * target upstream tag, mirroring clean upstream core changes, and running true
 * 3-way merges (`git merge-file --diff3`) on the thin Nepal hook points.
 *
 * Modes:
 *   npm run nepal:check-updates                        # Discover latest DHIS2 2.41+ stable tag
 *   npm run nepal:sync:dry-run                         # Preview diff & simulate 3-way hook merges
 *   npm run nepal:sync                                 # Sync to latest DHIS2 2.41+ stable tag
 *   npm run nepal:sync -- --tag v107.10.0              # Sync to an explicit upstream tag
 *   npm run nepal:sync -- --max-dhis2-version 2.42     # Raise DHIS2 compatibility ceiling
 *   npm run nepal:sync -- --finish v107.10.0           # Resume after resolving manual hook conflicts
 *
 * Flags:
 *   --check                     Check for newer compatible upstream release only
 *   --dry-run                   Simulate sync and 3-way hook merges without modifying files
 *   --tag <tag>                 Target upstream tag (e.g. v107.10.0)
 *   --max-dhis2-version <ver>   Max allowed minDHIS2Version (default from nepal/branding.json, e.g. 2.41)
 *   --allow-dirty               Allow running with uncommitted changes
 *   --no-branch                 Do not create/switch to upgrade/<tag> git branch
 *   --skip-build                Skip build:zip after branding, verify, and lint
 *   --refresh-cache             Re-fetch cached shallow tag snapshots
 *   --finish <tag>              Complete an upgrade after manual conflict resolution
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const BRANDING_PATH = path.join(ROOT, 'nepal', 'branding.json');
const CACHE_ROOT = path.join(ROOT, '.nepal-cache', 'upstream-sync');

/**
 * Ownership Ruleset
 * 1. PROTECTED_PREFIXES / PROTECTED_FILES: Strictly Nepal-owned; never overwritten or deleted.
 * 2. THREE_WAY_FILES: Thin upstream hook files & shared build config merged with git merge-file.
 * 3. SCRIPT_MANAGED_FILES: Deterministically re-stamped by `npm run nepal:brand`.
 * 4. UPSTREAM_SYNC_ROOTS: Directories/files mirrored from upstream diff (oldBaseTag -> targetTag).
 */
const PROTECTED_PREFIXES = [
    'src/nepal/',
    'nepal/',
    'nepal-repo-template/',
    '.nepal-cache/',
    '.nepal-workspace/',
    'public/assets/aistudio/',
    'dist/',
    'build/',
];

const PROTECTED_FILES = new Set([
    'server.ts',
    'README.nepal.md',
    'metadata.json',
    '.env.example',
    '.github/workflows/release-capture-app-np.yml',
]);

const THREE_WAY_FILES = [
    'src/index.tsx',
    'src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.component.tsx',
    'src/core_modules/capture-ui/DateAndTimeFields/DateField/Date.types.ts',
    'src/core_modules/capture-ui/DateAndTimeFields/DateRangeField/DateRangeField.component.tsx',
    'src/core_modules/capture-ui/internal/AgeInput/AgeDateInput.component.tsx',
    'src/core_modules/capture-ui/AgeField/ageField.module.css',
    'src/core_modules/capture-core/storageControllers/mainStorageController.ts',
    'src/core_modules/capture-core-utils/hash/hashSHA256.ts',
    'tsconfig.json',
    'vite.config.mts',
];

const THREE_WAY_SET = new Set(THREE_WAY_FILES);

const UPSTREAM_SYNC_ROOTS = [
    'src',
    'packages',
    'i18n',
    'public',
    'scripts',
    'config',
    'patches',
    'd2.config.js',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    '.babelrc',
    'jest.config.js',
];

const NEPAL_PRESERVED_DEPS = [
    'nepali-date-converter',
    'express',
];

const NEPAL_PRESERVED_DEV_DEPS = [
    '@types/express',
    '@types/node',
    'dotenv',
    'tsx',
    'esbuild',
];

const NEPAL_PRESERVED_SCRIPTS = [
    'dev',
    'start',
    'start:prod',
    'build',
    'build:standalone',
    'build:zip',
    'lint',
];

function readBranding() {
    if (!fs.existsSync(BRANDING_PATH)) {
        throw new Error('nepal/branding.json not found.');
    }
    return JSON.parse(fs.readFileSync(BRANDING_PATH, 'utf8'));
}

function normalizeTag(raw) {
    if (!raw) return '';
    return raw.startsWith('v') ? raw : `v${raw}`;
}

function parseSemverTag(tag) {
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (!match) return null;
    return {
        tag,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

function compareSemverDesc(a, b) {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
}

function parseDhis2Version(ver) {
    if (!ver) return null;
    const match = /(\d+)\.(\d+)/.exec(String(ver));
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
}

function isDhis2VersionCompatible(minRequired, maxAllowed) {
    const req = parseDhis2Version(minRequired);
    const max = parseDhis2Version(maxAllowed);
    if (!req || !max) return true;
    if (req[0] !== max[0]) return req[0] < max[0];
    return req[1] <= max[1];
}

function parseArgs(argv, branding) {
    const opts = {
        checkOnly: false,
        dryRun: false,
        targetTag: '',
        finishTag: '',
        maxDhis2Version: branding.maxMinDHIS2Version || '2.41',
        allowDirty: false,
        noBranch: false,
        skipBuild: false,
        refreshCache: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--check') {
            opts.checkOnly = true;
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
        } else if (arg === '--tag' && argv[i + 1]) {
            opts.targetTag = normalizeTag(argv[i + 1]);
            i += 1;
        } else if (arg === '--finish' && argv[i + 1]) {
            opts.finishTag = normalizeTag(argv[i + 1]);
            i += 1;
        } else if (arg === '--max-dhis2-version' && argv[i + 1]) {
            opts.maxDhis2Version = argv[i + 1];
            i += 1;
        } else if (arg === '--allow-dirty') {
            opts.allowDirty = true;
        } else if (arg === '--no-branch') {
            opts.noBranch = true;
        } else if (arg === '--skip-build') {
            opts.skipBuild = true;
        } else if (arg === '--refresh-cache') {
            opts.refreshCache = true;
        } else if (!arg.startsWith('-') && !opts.targetTag) {
            opts.targetTag = normalizeTag(arg);
        }
    }

    return opts;
}

function listUpstreamStableTags(repoUrl) {
    const out = execFileSync('git', ['ls-remote', '--tags', '--refs', repoUrl], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tags = [];
    for (const line of out.split(/\r?\n/)) {
        const match = /refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line.trim());
        if (!match) continue;
        const parsed = parseSemverTag(match[1]);
        if (parsed) tags.push(parsed);
    }
    tags.sort(compareSemverDesc);
    return tags;
}

function githubRawUrlForFile(repoUrl, tag, relPath) {
    const match = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i.exec(repoUrl);
    if (!match) return null;
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${tag}/${relPath}`;
}

async function fetchTagMinDhis2Version(repoUrl, tag) {
    const rawUrl = githubRawUrlForFile(repoUrl, tag, 'd2.config.js');
    if (rawUrl) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(rawUrl, { signal: controller.signal });
            if (res.ok) {
                const text = await res.text();
                const m = /minDHIS2Version:\s*['"]([^'"]+)['"]/.exec(text);
                return m ? m[1] : null;
            }
        } catch {
            // Fall through to shallow clone check if raw fetch fails
        } finally {
            clearTimeout(timer);
        }
    }
    const snapDir = ensureTagSnapshot(repoUrl, tag, false);
    const d2Path = path.join(snapDir, 'd2.config.js');
    if (!fs.existsSync(d2Path)) return null;
    const text = fs.readFileSync(d2Path, 'utf8');
    const m = /minDHIS2Version:\s*['"]([^'"]+)['"]/.exec(text);
    return m ? m[1] : null;
}

async function discoverLatestCompatibleTag(repoUrl, baseTag, maxDhis2Version) {
    const stableTags = listUpstreamStableTags(repoUrl);
    if (stableTags.length === 0) {
        throw new Error(`No stable semver tags found at ${repoUrl}`);
    }

    const latestAny = stableTags[0].tag;
    const baseParsed = parseSemverTag(baseTag);
    const inspected = [];

    // Inspect newest tags (up to 25) until we find one with minDHIS2Version <= maxDhis2Version
    const candidates = stableTags.slice(0, 25);
    let selected = null;

    for (const candidate of candidates) {
        const minDhis2 = await fetchTagMinDhis2Version(repoUrl, candidate.tag);
        const compatible = isDhis2VersionCompatible(minDhis2, maxDhis2Version);
        inspected.push({ tag: candidate.tag, minDhis2: minDhis2 || 'unspecified', compatible });
        if (compatible) {
            selected = {
                tag: candidate.tag,
                minDhis2: minDhis2 || 'unspecified',
                isNewer: baseParsed ? compareSemverDesc(candidate, baseParsed) < 0 : candidate.tag !== baseTag,
            };
            break;
        }
    }

    return { latestAny, selected, inspected };
}

function ensureTagSnapshot(repoUrl, tag, refreshCache) {
    const repoHash = crypto.createHash('sha256').update(repoUrl).digest('hex').slice(0, 8);
    const safeTag = tag.replace(/[^0-9A-Za-z._-]+/g, '_');
    const snapDir = path.join(CACHE_ROOT, `${safeTag}-${repoHash}`);

    if (refreshCache && fs.existsSync(snapDir)) {
        fs.rmSync(snapDir, { recursive: true, force: true });
    }

    if (!fs.existsSync(path.join(snapDir, 'package.json'))) {
        fs.mkdirSync(path.dirname(snapDir), { recursive: true });
        console.log(`  [FETCH] Shallow cloning ${tag} into ${path.relative(ROOT, snapDir)}...`);
        execFileSync('git', ['clone', '--branch', tag, '--depth', '1', repoUrl, snapDir], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } else {
        console.log(`  [CACHE] Reusing cached snapshot for ${tag}`);
    }

    return snapDir;
}

function isProtectedPath(relPosix) {
    if (PROTECTED_FILES.has(relPosix)) return true;
    for (const prefix of PROTECTED_PREFIXES) {
        if (relPosix.startsWith(prefix) || `${relPosix}/` === prefix) return true;
    }
    return false;
}

function collectFilesInRoots(baseDir, roots) {
    const result = new Map(); // relPosix -> absPath
    function walk(absPath, relPosix) {
        if (!fs.existsSync(absPath)) return;
        const stat = fs.lstatSync(absPath);
        if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) {
            if (path.basename(absPath) === '.git' || path.basename(absPath) === 'node_modules') return;
            for (const entry of fs.readdirSync(absPath)) {
                const nextRel = relPosix ? `${relPosix}/${entry}` : entry;
                walk(path.join(absPath, entry), nextRel);
            }
            return;
        }
        if (stat.isFile()) {
            result.set(relPosix, absPath);
        }
    }

    for (const root of roots) {
        walk(path.join(baseDir, root), root);
    }
    return result;
}

function filesEqual(pathA, pathB) {
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) return false;
    return fs.readFileSync(pathA).equals(fs.readFileSync(pathB));
}

function runThreeWayMerge(localPath, basePath, targetPath, baseTag, targetTag, dryRun) {
    if (!fs.existsSync(localPath)) {
        if (fs.existsSync(targetPath)) {
            if (!dryRun) {
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.copyFileSync(targetPath, localPath);
            }
            return { status: 'new' };
        }
        return { status: 'unchanged' };
    }

    if (!fs.existsSync(targetPath)) {
        return { status: 'protected-local' };
    }

    // If upstream did not change the file between baseTag and targetTag, keep local untouched!
    if (fs.existsSync(basePath) && filesEqual(basePath, targetPath)) {
        return { status: 'unchanged' };
    }

    // If local still matches old base identically, fast-forward cleanly to new target
    if (fs.existsSync(basePath) && filesEqual(localPath, basePath)) {
        if (!dryRun) {
            fs.copyFileSync(targetPath, localPath);
        }
        return { status: 'fast-forward' };
    }

    // True 3-way merge using git merge-file --diff3 (works with zero shared git commit history)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-np-3way-'));
    try {
        const tmpLocal = path.join(tmpDir, 'local');
        const tmpBase = path.join(tmpDir, 'base');
        const tmpTarget = path.join(tmpDir, 'target');
        fs.copyFileSync(localPath, tmpLocal);
        if (fs.existsSync(basePath)) {
            fs.copyFileSync(basePath, tmpBase);
        } else {
            fs.writeFileSync(tmpBase, '', 'utf8');
        }
        fs.copyFileSync(targetPath, tmpTarget);

        const res = spawnSync(
            'git',
            [
                'merge-file',
                '--diff3',
                '-L',
                'capture-app-np (local)',
                '-L',
                `upstream (${baseTag})`,
                '-L',
                `upstream (${targetTag})`,
                tmpLocal,
                tmpBase,
                tmpTarget,
            ],
            { encoding: 'utf8' },
        );

        if (res.error) {
            throw res.error;
        }

        const mergedContent = fs.readFileSync(tmpLocal, 'utf8');
        if (!dryRun) {
            fs.writeFileSync(localPath, mergedContent, 'utf8');
        }

        if (res.status === 0) {
            return { status: '3-way-ok' };
        }
        return { status: 'conflict', conflictCount: res.status || 1 };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function ensureNepalConfigGuards() {
    // Safety net: guarantee capture-nepal alias in tsconfig.json
    const tsconfigPath = path.join(ROOT, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
        const raw = fs.readFileSync(tsconfigPath, 'utf8');
        if (!raw.includes('"capture-nepal"') && !raw.includes('<<<<<<<')) {
            const next = raw.replace(
                /("capture-core-utils\/\*":\s*\[[^\]]+\])/,
                '$1,\n      "capture-nepal": ["./src/nepal"],\n      "capture-nepal/*": ["./src/nepal/*"]',
            );
            if (next !== raw) fs.writeFileSync(tsconfigPath, next, 'utf8');
        }
    }

    // Safety net: guarantee capture-nepal alias & DHIS2_CACHE_VERSION in vite.config.mts
    const vitePath = path.join(ROOT, 'vite.config.mts');
    if (fs.existsSync(vitePath)) {
        let raw = fs.readFileSync(vitePath, 'utf8');
        if (!raw.includes('<<<<<<<')) {
            let next = raw;
            if (!next.includes("'capture-nepal'")) {
                next = next.replace(
                    /('capture-core-utils':[^\n]+,)/,
                    "$1\n                'capture-nepal': path.resolve(__dirname, 'src/nepal'),",
                );
            }
            if (!next.includes('DHIS2_CACHE_VERSION')) {
                next = next.replace(
                    /(define:\s*\{)/,
                    "$1\n            'process.env.DHIS2_CACHE_VERSION': JSON.stringify(process.env.DHIS2_CACHE_VERSION || '4'),",
                );
            }
            if (next !== raw) fs.writeFileSync(vitePath, next, 'utf8');
        }
    }
}

function mergePackageJson(localPkgPath, targetPkgPath, branding, dryRun) {
    const localPkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf8'));
    const targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf8'));

    const summary = {
        oldVersion: localPkg.version,
        newVersion: targetPkg.version,
        depsChanged: 0,
        devDepsChanged: 0,
    };

    const mergedDeps = { ...(targetPkg.dependencies || {}) };
    for (const dep of NEPAL_PRESERVED_DEPS) {
        if (localPkg.dependencies?.[dep] && !mergedDeps[dep]) {
            mergedDeps[dep] = localPkg.dependencies[dep];
        }
    }

    const mergedDevDeps = { ...(targetPkg.devDependencies || {}) };
    for (const dep of NEPAL_PRESERVED_DEV_DEPS) {
        if (localPkg.devDependencies?.[dep] && !mergedDevDeps[dep]) {
            mergedDevDeps[dep] = localPkg.devDependencies[dep];
        }
    }

    const allDepKeys = new Set([
        ...Object.keys(localPkg.dependencies || {}),
        ...Object.keys(mergedDeps),
    ]);
    for (const k of allDepKeys) {
        if (localPkg.dependencies?.[k] !== mergedDeps[k]) summary.depsChanged += 1;
    }

    const allDevKeys = new Set([
        ...Object.keys(localPkg.devDependencies || {}),
        ...Object.keys(mergedDevDeps),
    ]);
    for (const k of allDevKeys) {
        if (localPkg.devDependencies?.[k] !== mergedDevDeps[k]) summary.devDepsChanged += 1;
    }

    const mergedScripts = { ...(targetPkg.scripts || {}) };
    for (const [key, val] of Object.entries(localPkg.scripts || {})) {
        if (key.startsWith('nepal:') || NEPAL_PRESERVED_SCRIPTS.includes(key)) {
            mergedScripts[key] = val;
        }
    }

    const nextPkg = {
        ...targetPkg,
        name: branding.name,
        cacheVersion: String(branding.cacheVersion || localPkg.cacheVersion || '4'),
        dependencies: mergedDeps,
        scripts: mergedScripts,
        devDependencies: mergedDevDeps,
    };

    if (!dryRun) {
        fs.writeFileSync(localPkgPath, `${JSON.stringify(nextPkg, null, 4)}\n`, 'utf8');
    }
    return summary;
}

function isGitRepo() {
    const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    return res.status === 0 && res.stdout.trim() === 'true';
}

function ensureCleanGitAndBranch(targetTag, allowDirty, noBranch) {
    if (!isGitRepo()) {
        console.log('  [NOTE] Not inside a Git working tree; proceeding without branch creation.');
        return null;
    }
    if (!allowDirty) {
        const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
        if (status) {
            throw new Error(
                'Working tree has uncommitted changes. Commit or stash first, or pass --allow-dirty.',
            );
        }
    }
    if (noBranch) return null;
    const branchName = `upgrade/${targetTag}`;
    console.log(`  [GIT] Switching to isolated branch '${branchName}'...`);
    execFileSync('git', ['checkout', '-B', branchName], { cwd: ROOT, stdio: 'inherit' });
    return branchName;
}

function updateBrandingBaseTag(targetTag) {
    const data = readBranding();
    data.upstreamBaseTag = targetTag;
    fs.writeFileSync(BRANDING_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function findRemainingConflictMarkers() {
    const conflicted = [];
    for (const rel of THREE_WAY_FILES) {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>')) {
            conflicted.push(rel);
        }
    }
    return conflicted;
}

function finalizeUpgrade(targetTag, skipBuild) {
    const remaining = findRemainingConflictMarkers();
    if (remaining.length > 0) {
        console.error('\n[FAIL] Unresolved conflict markers still found in:');
        for (const f of remaining) console.error(`  - ${f}`);
        console.error('\nResolve the markers above, then re-run:');
        console.error(`  npm run nepal:sync -- --finish ${targetTag}`);
        process.exit(2);
    }

    ensureNepalConfigGuards();
    updateBrandingBaseTag(targetTag);

    console.log('\n[6/7] Brand, Install & Verify');
    console.log('  Installing dependencies...');
    execSync('npm install --legacy-peer-deps --no-audit --no-fund', { cwd: ROOT, stdio: 'inherit' });

    console.log('  Re-applying Nepal branding, icons & 38 locale app titles...');
    execSync('npm run nepal:brand', { cwd: ROOT, stdio: 'inherit' });

    console.log('  Running Nepal integration verifier...');
    execSync('npm run nepal:verify', { cwd: ROOT, stdio: 'inherit' });

    console.log('  Typechecking...');
    execSync('npm run lint', { cwd: ROOT, stdio: 'inherit' });

    console.log('\n[7/7] Build & Inspect DHIS2 ZIP');
    if (skipBuild) {
        console.log('  [SKIP] --skip-build specified; run `npm run build:zip` when ready.');
    } else {
        execSync('npm run build:zip', { cwd: ROOT, stdio: 'inherit' });
        execFileSync('node', ['nepal/scripts/verifyIntegration.mjs', '--zip'], {
            cwd: ROOT,
            stdio: 'inherit',
        });
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    console.log(`\n[PASS] Capture NP synced cleanly to upstream ${targetTag} (package v${pkg.version}).`);
    console.log('Next steps:');
    console.log('  1. Review changes: git status && git diff --stat');
    console.log(`  2. Commit upgrade: git add -A && git commit -m "chore: sync upstream capture-app to ${targetTag}"`);
    console.log(`  3. Release ZIP:    git tag v${pkg.version}-np.1 && git push origin HEAD --tags`);
}

async function main() {
    const branding = readBranding();
    const opts = parseArgs(process.argv.slice(2), branding);
    const repoUrl = branding.upstreamRepo || 'https://github.com/dhis2/capture-app.git';
    const baseTag = normalizeTag(branding.upstreamBaseTag || 'v107.9.3');

    if (opts.finishTag) {
        console.log(`[nepal:sync] Resuming finalization for ${opts.finishTag}...`);
        finalizeUpgrade(opts.finishTag, opts.skipBuild);
        return;
    }

    console.log('[1/7] Discover Upstream Release');
    console.log(`  Tracked baseline:  ${baseTag}`);
    console.log(`  Upstream repo:     ${repoUrl}`);
    console.log(`  DHIS2 target:      ${opts.maxDhis2Version}+ (minDHIS2Version <= ${opts.maxDhis2Version})`);

    let targetTag = opts.targetTag;
    let targetMinDhis2 = null;

    if (!targetTag) {
        const discovery = await discoverLatestCompatibleTag(repoUrl, baseTag, opts.maxDhis2Version);
        if (!discovery.selected) {
            console.error(`  [FAIL] No stable release found with minDHIS2Version <= ${opts.maxDhis2Version}.`);
            process.exit(1);
        }
        targetTag = discovery.selected.tag;
        targetMinDhis2 = discovery.selected.minDhis2;
        console.log(`  Latest overall:    ${discovery.latestAny}`);
        console.log(`  Latest compatible: ${targetTag} (minDHIS2Version=${targetMinDhis2})`);

        if (opts.checkOnly) {
            if (discovery.selected.isNewer) {
                console.log(`\n  [UPDATE AVAILABLE] ${baseTag} -> ${targetTag}`);
                console.log('  Preview safely with zero file edits:');
                console.log(`    npm run nepal:sync:dry-run -- --tag ${targetTag}`);
                console.log('  Apply on an isolated upgrade branch:');
                console.log(`    npm run nepal:sync -- --tag ${targetTag}`);
            } else {
                console.log(`\n  [UP TO DATE] Already on latest DHIS2 ${opts.maxDhis2Version}+ compatible release (${baseTag}).`);
            }
            return;
        }
    } else {
        targetMinDhis2 = await fetchTagMinDhis2Version(repoUrl, targetTag);
        const compat = isDhis2VersionCompatible(targetMinDhis2, opts.maxDhis2Version);
        console.log(`  Requested tag:     ${targetTag} (minDHIS2Version=${targetMinDhis2 || 'unspecified'})`);
        if (!compat) {
            console.log(
                `  [WARN] ${targetTag} declares minDHIS2Version=${targetMinDhis2}, which exceeds ${opts.maxDhis2Version}.`,
            );
        }
        if (opts.checkOnly) {
            console.log(`  [PASS] Tag ${targetTag} verified (compatible=${compat}).`);
            return;
        }
    }

    if (targetTag === baseTag) {
        console.log(`\n  [UP TO DATE] Already synced to ${baseTag}. Nothing to do.`);
        return;
    }

    if (!opts.dryRun) {
        ensureCleanGitAndBranch(targetTag, opts.allowDirty, opts.noBranch);
    } else {
        console.log('\n  [DRY-RUN] Simulation mode active — zero workspace files will be modified.');
    }

    console.log('\n[2/7] Dual Shallow Snapshot Cache');
    const oldSnapDir = ensureTagSnapshot(repoUrl, baseTag, opts.refreshCache);
    const newSnapDir = ensureTagSnapshot(repoUrl, targetTag, opts.refreshCache);

    console.log('\n[3/7] Sync Pure Upstream Core');
    const oldFiles = collectFilesInRoots(oldSnapDir, UPSTREAM_SYNC_ROOTS);
    const newFiles = collectFilesInRoots(newSnapDir, UPSTREAM_SYNC_ROOTS);

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let protectedCount = 0;

    for (const [relPosix, newAbs] of newFiles.entries()) {
        if (isProtectedPath(relPosix)) {
            protectedCount += 1;
            continue;
        }
        if (THREE_WAY_SET.has(relPosix)) {
            continue;
        }
        const oldAbs = oldFiles.get(relPosix);
        const dstAbs = path.join(ROOT, relPosix);
        if (!oldAbs) {
            addedCount += 1;
            if (!opts.dryRun) {
                fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
                fs.copyFileSync(newAbs, dstAbs);
            }
        } else if (!filesEqual(oldAbs, newAbs)) {
            updatedCount += 1;
            if (!opts.dryRun) {
                fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
                fs.copyFileSync(newAbs, dstAbs);
            }
        }
    }

    for (const [relPosix] of oldFiles.entries()) {
        if (newFiles.has(relPosix)) continue;
        if (isProtectedPath(relPosix) || THREE_WAY_SET.has(relPosix)) continue;
        const dstAbs = path.join(ROOT, relPosix);
        if (fs.existsSync(dstAbs)) {
            deletedCount += 1;
            if (!opts.dryRun) {
                fs.rmSync(dstAbs, { force: true });
            }
        }
    }

    console.log(`  [NEW]       ${addedCount} upstream file(s) added`);
    console.log(`  [UPDATED]   ${updatedCount} upstream file(s) updated`);
    console.log(`  [DELETED]   ${deletedCount} removed upstream file(s) cleaned up`);
    console.log(`  [PROTECTED] Nepal modules, branding config, server proxy & workflows untouched (${protectedCount} skipped)`);

    console.log('\n[4/7] 3-Way Merge Thin Nepal Hooks & Shared Config');
    const conflicts = [];
    for (const relPosix of THREE_WAY_FILES) {
        const localAbs = path.join(ROOT, relPosix);
        const baseAbs = path.join(oldSnapDir, relPosix);
        const targetAbs = path.join(newSnapDir, relPosix);
        const outcome = runThreeWayMerge(localAbs, baseAbs, targetAbs, baseTag, targetTag, opts.dryRun);

        if (outcome.status === 'unchanged') {
            console.log(`  [UNCHANGED] ${relPosix}`);
        } else if (outcome.status === 'fast-forward') {
            console.log(`  [UPDATED]   ${relPosix} (fast-forward)`);
        } else if (outcome.status === '3-way-ok') {
            console.log(`  [3-WAY OK]  ${relPosix} (preserved Nepal hook + upstream changes)`);
        } else if (outcome.status === 'new') {
            console.log(`  [NEW]       ${relPosix}`);
        } else if (outcome.status === 'protected-local') {
            console.log(`  [PROTECTED] ${relPosix} (kept local file)`);
        } else {
            conflicts.push(relPosix);
            console.log(`  [CONFLICT]  ${relPosix} (manual resolution needed)`);
        }
    }

    console.log('\n[5/7] Merge package.json Dependencies & Scripts');
    const pkgSummary = mergePackageJson(
        path.join(ROOT, 'package.json'),
        path.join(newSnapDir, 'package.json'),
        branding,
        opts.dryRun,
    );
    console.log(
        `  [PKG]       Version ${pkgSummary.oldVersion} -> ${pkgSummary.newVersion} | dependencies changed: ${pkgSummary.depsChanged} | devDependencies changed: ${pkgSummary.devDepsChanged}`,
    );
    console.log('  [PROTECTED] Preserved Capture NP name, cacheVersion, nepali-date-converter, express/tsx & nepal:* scripts');

    if (opts.dryRun) {
        console.log('\n[DRY-RUN COMPLETE] Zero workspace files were modified.');
        if (conflicts.length > 0) {
            console.log(`  Manual review will be needed in ${conflicts.length} hook file(s):`);
            for (const c of conflicts) console.log(`    - ${c}`);
        } else {
            console.log('  All thin Nepal hooks merged cleanly in simulation!');
        }
        console.log(`\nTo execute this upgrade on an isolated branch:\n  npm run nepal:sync -- --tag ${targetTag}`);
        return;
    }

    if (conflicts.length > 0) {
        console.error('\n[CONFLICT] Upstream refactored lines overlapping Nepal hooks in:');
        for (const c of conflicts) console.error(`  - ${c}`);
        console.error('\nHow to finish cleanly:');
        console.error('  1. Open the file(s) above and resolve the <<<<<<< / ======= / >>>>>>> blocks.');
        console.error('     Keep both upstream updates and the thin Nepal hook (see nepal/UPGRADE_GUIDE.md).');
        console.error('  2. Resume branding, verification, lint, and ZIP build with:');
        console.error(`       npm run nepal:sync -- --finish ${targetTag}`);
        process.exit(2);
    }

    finalizeUpgrade(targetTag, opts.skipBuild);
}

main().catch((err) => {
    console.error(`[nepal:sync] Error: ${err.message}`);
    process.exit(1);
});
