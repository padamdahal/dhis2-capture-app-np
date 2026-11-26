#!/usr/bin/env node
/**
 * Compiles ONLY the isolated Nepal runtime extension (src/nepal/**) into a
 * standalone ESM bundle (`nepal-extension.js`) + cache-busting metadata
 * (`nepal-extension.meta.json`) in under 1 second using esbuild.
 *
 * Host React, jsx-runtime, and @dhis2/ui primitives are resolved through the
 * Capture host bridge (`globalThis.__CAPTURE_NP_HOST__`) so there is never a
 * duplicate React instance or mismatched DHIS2 UI context.
 *
 * Usage:
 *   node nepal/scripts/buildExtension.mjs [--out public] [--out build/app]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

function resolveEsbuild() {
    const candidates = [
        path.join(ROOT, 'node_modules', 'esbuild'),
        'esbuild',
    ];
    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch {
            // try next candidate
        }
    }
    throw new Error('Could not locate esbuild. Run npm install first.');
}

function parseOutDirs(argv) {
    const dirs = [];
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--out' && argv[i + 1]) {
            dirs.push(path.resolve(ROOT, argv[i + 1]));
            i += 1;
        }
    }
    if (dirs.length === 0) {
        dirs.push(path.join(ROOT, 'public'));
    }
    return [...new Set(dirs)];
}

const nepalHostBridgePlugin = {
    name: 'nepal-host-bridge',
    setup(build) {
        build.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'nepal-host',
        }));
        build.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, () => ({
            path: 'react-jsx-runtime',
            namespace: 'nepal-host',
        }));
        build.onResolve({ filter: /^@dhis2\/ui$/ }, () => ({
            path: 'dhis2-ui',
            namespace: 'nepal-host',
        }));

        build.onLoad({ filter: /^react$/, namespace: 'nepal-host' }, () => ({
            contents: `
const R = globalThis.__CAPTURE_NP_HOST__ && globalThis.__CAPTURE_NP_HOST__.React;
if (!R) throw new Error('[capture-app-np] Host React runtime not registered');
export default R;
export const {
    Children,
    Component,
    Fragment,
    PureComponent,
    StrictMode,
    Suspense,
    cloneElement,
    createContext,
    createElement,
    createRef,
    forwardRef,
    isValidElement,
    lazy,
    memo,
    startTransition,
    useCallback,
    useContext,
    useDebugValue,
    useDeferredValue,
    useEffect,
    useId,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
    useTransition,
} = R;
`,
            loader: 'js',
        }));

        build.onLoad({ filter: /^react-jsx-runtime$/, namespace: 'nepal-host' }, () => ({
            contents: `
const J = globalThis.__CAPTURE_NP_HOST__ && globalThis.__CAPTURE_NP_HOST__.jsxRuntime;
if (!J) throw new Error('[capture-app-np] Host React JSX runtime not registered');
export const jsx = J.jsx;
export const jsxs = J.jsxs;
export const jsxDEV = J.jsxDEV || J.jsx;
export const Fragment = J.Fragment;
export default J;
`,
            loader: 'js',
        }));

        build.onLoad({ filter: /^dhis2-ui$/, namespace: 'nepal-host' }, () => ({
            contents: `
const UI = globalThis.__CAPTURE_NP_HOST__ && globalThis.__CAPTURE_NP_HOST__.dhis2Ui;
if (!UI) throw new Error('[capture-app-np] Host @dhis2/ui runtime not registered');
export default UI;
export const {
    Button,
    ButtonStrip,
    IconCalendar16,
    IconChevronLeft16,
    IconChevronRight16,
    InputField,
    Layer,
    Modal,
    ModalActions,
    ModalContent,
    ModalTitle,
    NoticeBox,
    Popper,
    SingleSelect,
    SingleSelectOption,
    Tag,
    Tooltip,
    colors,
    elevations,
    spacers,
    theme,
} = UI;
`,
            loader: 'js',
        }));
    },
};

export async function buildNepalExtension({
    rootDir = ROOT,
    outDirs,
} = {}) {
    const startMs = Date.now();
    const esbuild = resolveEsbuild();
    const entryPoint = path.join(rootDir, 'src', 'nepal', 'extensionEntry.ts');
    if (!fs.existsSync(entryPoint)) {
        throw new Error(`Missing Nepal extension entry point: ${entryPoint}`);
    }

    const targets = outDirs && outDirs.length > 0 ? outDirs : [path.join(rootDir, 'public')];
    const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: ['es2020'],
        jsx: 'automatic',
        minify: true,
        sourcemap: false,
        plugins: [nepalHostBridgePlugin],
        define: {
            'process.env.NODE_ENV': '"production"',
        },
        logLevel: 'silent',
    });

    const jsOutput = result.outputFiles[0];
    if (!jsOutput) {
        throw new Error('esbuild produced no output for nepal-extension.js');
    }

    const codeBuffer = Buffer.from(jsOutput.contents);
    const hash = crypto.createHash('sha256').update(codeBuffer).digest('hex').slice(0, 12);

    let branding = { name: 'capture-app-np', title: 'Capture NP', upstreamBaseTag: '' };
    const brandingPath = path.join(rootDir, 'nepal', 'branding.json');
    if (fs.existsSync(brandingPath)) {
        branding = JSON.parse(fs.readFileSync(brandingPath, 'utf8'));
    }

    let appVersion = '107.9.3';
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || appVersion;
    }

    const meta = {
        name: branding.name,
        title: branding.title,
        version: appVersion,
        hash,
        sizeBytes: codeBuffer.length,
        builtAt: new Date().toISOString(),
    };
    const metaContent = `${JSON.stringify(meta, null, 2)}\n`;

    for (const dir of targets) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'nepal-extension.js'), codeBuffer);
        fs.writeFileSync(path.join(dir, 'nepal-extension.meta.json'), metaContent, 'utf8');
    }

    const elapsedMs = Date.now() - startMs;
    const kb = (codeBuffer.length / 1024).toFixed(1);
    console.log(
        `[nepal:build-ext] Built nepal-extension.js (${kb} KB, hash=${hash}) in ${elapsedMs}ms -> ${targets.map(d => path.relative(rootDir, d) || '.').join(', ')}`,
    );

    return { hash, sizeBytes: codeBuffer.length, elapsedMs, outDirs: targets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const outDirs = parseOutDirs(process.argv.slice(2));
    buildNepalExtension({ outDirs }).catch((err) => {
        console.error('[nepal:build-ext] Failed:', err);
        process.exit(1);
    });
}
