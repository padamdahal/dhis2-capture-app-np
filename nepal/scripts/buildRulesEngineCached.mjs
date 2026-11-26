#!/usr/bin/env node
/**
 * Content-hashed build wrapper for packages/rules-engine.
 * Skips rebuilding @dhis2/rules-engine-javascript when its source files have
 * not changed and packages/rules-engine/build already exists.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const RULES_DIR = path.join(ROOT, 'packages', 'rules-engine');
const RULES_BUILD_DIR = path.join(RULES_DIR, 'build');
const CACHE_DIR = path.join(ROOT, '.nepal-cache');
const HASH_FILE = path.join(CACHE_DIR, 'rules-engine.sha256');

function hashDirectory(dir, hash) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            hashDirectory(full, hash);
        } else if (entry.isFile()) {
            hash.update(path.relative(RULES_DIR, full));
            hash.update(fs.readFileSync(full));
        }
    }
}

function computeRulesHash() {
    const h = crypto.createHash('sha256');
    for (const rel of ['package.json', 'tsconfig.json']) {
        const p = path.join(RULES_DIR, rel);
        if (fs.existsSync(p)) {
            h.update(rel);
            h.update(fs.readFileSync(p));
        }
    }
    hashDirectory(path.join(RULES_DIR, 'src'), h);
    return h.digest('hex');
}

function main() {
    if (!fs.existsSync(RULES_DIR)) {
        console.log('[nepal:rules-engine] packages/rules-engine not present, skipping.');
        return;
    }
    const force = process.argv.includes('--force');
    const currentHash = computeRulesHash();
    const cachedHash = fs.existsSync(HASH_FILE) ? fs.readFileSync(HASH_FILE, 'utf8').trim() : '';

    if (!force && cachedHash === currentHash && fs.existsSync(path.join(RULES_BUILD_DIR, 'es'))) {
        console.log(`[nepal:rules-engine] Unchanged (${currentHash.slice(0, 10)}), reusing cached build.`);
        return;
    }

    console.log('[nepal:rules-engine] Source changed or build missing, building packages/rules-engine...');
    execSync('npm run build --workspace=packages/rules-engine', {
        cwd: ROOT,
        stdio: 'inherit',
    });

    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(HASH_FILE, `${currentHash}\n`, 'utf8');
}

main();
