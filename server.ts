import express, { type Request, type Response } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function isBlockedHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return (
        lower === '169.254.169.254' ||
        lower === 'metadata.google.internal' ||
        lower === '0.0.0.0' ||
        lower === 'localhost' ||
        lower === '127.0.0.1' ||
        lower === '::1'
    );
}

function getCookieValue(cookieHeader: string | undefined, name: string): string {
    if (!cookieHeader) return '';
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (key === name) {
            try {
                return decodeURIComponent(part.slice(idx + 1).trim());
            } catch {
                return part.slice(idx + 1).trim();
            }
        }
    }
    return '';
}

function filterOutgoingCookies(cookieHeader: string | undefined): string {
    if (!cookieHeader) return '';
    return cookieHeader
        .split(';')
        .map(v => v.trim())
        .filter(v => v && !v.startsWith('dhis2_proxy_target='))
        .join('; ');
}

function rewriteSetCookie(rawCookie: string, isHttps: boolean): string {
    const parts = rawCookie
        .split(';')
        .map(p => p.trim())
        .filter(Boolean)
        .filter((p) => {
            const lower = p.toLowerCase();
            return (
                !lower.startsWith('domain=') &&
                !lower.startsWith('path=') &&
                !lower.startsWith('samesite=') &&
                lower !== 'secure' &&
                lower !== 'partitioned'
            );
        });

    parts.push('Path=/');
    if (isHttps) {
        parts.push('SameSite=None');
        parts.push('Secure');
        parts.push('Partitioned');
    } else {
        parts.push('SameSite=Lax');
    }
    return parts.join('; ');
}

interface ProxySessionEntry {
    cookies: Map<string, string>;
    updatedAt: number;
}

const proxySessionJar = new Map<string, ProxySessionEntry>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function pruneExpiredSessions(): void {
    if (proxySessionJar.size < 200) return;
    const now = Date.now();
    for (const [key, entry] of proxySessionJar.entries()) {
        if (now - entry.updatedAt > SESSION_TTL_MS) {
            proxySessionJar.delete(key);
        }
    }
}

function getSessionKey(sessionId: string, baseUrl: string): string {
    return `${sessionId}::${baseUrl.toLowerCase()}`;
}

function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
    const map = new Map<string, string>();
    if (!cookieHeader) return map;
    for (const part of cookieHeader.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const name = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (name && name !== 'dhis2_proxy_target') {
            map.set(name, value);
        }
    }
    return map;
}

function applySetCookiesToJar(sessionKey: string, setCookies: string[]): void {
    if (!sessionKey || setCookies.length === 0) return;
    pruneExpiredSessions();
    let entry = proxySessionJar.get(sessionKey);
    if (!entry) {
        entry = { cookies: new Map(), updatedAt: Date.now() };
        proxySessionJar.set(sessionKey, entry);
    }
    entry.updatedAt = Date.now();

    for (const raw of setCookies) {
        const segments = raw.split(';').map(s => s.trim()).filter(Boolean);
        if (segments.length === 0) continue;
        const eq = segments[0].indexOf('=');
        if (eq <= 0) continue;
        const name = segments[0].slice(0, eq).trim();
        const value = segments[0].slice(eq + 1).trim();
        if (!name) continue;

        let expired = value === '';
        for (let i = 1; i < segments.length; i += 1) {
            const lower = segments[i].toLowerCase();
            if (lower.startsWith('max-age=')) {
                const maxAge = Number(lower.slice('max-age='.length));
                if (Number.isFinite(maxAge) && maxAge <= 0) expired = true;
            } else if (lower.startsWith('expires=')) {
                const ts = Date.parse(segments[i].slice('expires='.length));
                if (Number.isFinite(ts) && ts <= Date.now()) expired = true;
            }
        }

        if (expired) {
            entry.cookies.delete(name);
        } else {
            entry.cookies.set(name, value);
        }
    }
}

function buildOutgoingCookieHeader(
    sessionKey: string,
    browserCookieHeader: string | undefined,
): string {
    const merged = new Map<string, string>();
    const browserCookies = parseCookieHeader(browserCookieHeader);
    for (const [k, v] of browserCookies.entries()) {
        merged.set(k, v);
    }
    if (sessionKey) {
        const entry = proxySessionJar.get(sessionKey);
        if (entry) {
            entry.updatedAt = Date.now();
            // Prefer server-tracked session cookies (stays authoritative when iframe cookies are blocked or stale)
            for (const [k, v] of entry.cookies.entries()) {
                merged.set(k, v);
            }
        }
    }
    if (merged.size === 0) return '';
    return Array.from(merged.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

function resolveSameServerRedirect(location: string, currentUrl: string, parsedBase: URL): string | null {
    try {
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.hostname.toLowerCase() !== parsedBase.hostname.toLowerCase()) {
            return null;
        }
        // Preserve upstream protocol when TLS-terminating reverse proxies emit http:// for https:// hosts
        if (parsedBase.protocol === 'https:' && nextUrl.protocol === 'http:' && !nextUrl.port) {
            nextUrl.protocol = 'https:';
        }
        return nextUrl.toString();
    } catch {
        return null;
    }
}

function readRawBody(req: Request): Promise<Buffer | undefined> {
    if (req.method === 'GET' || req.method === 'HEAD') {
        return Promise.resolve(undefined);
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
        req.on('error', reject);
    });
}

async function createDhis2DevViteMiddleware() {
    const cliRoot = path.join(__dirname, 'node_modules/@dhis2/cli-app-scripts');
    const bootstrapShell = require(path.join(cliRoot, 'src/lib/bootstrapShell.js'));
    const {
        verifyEntrypoints,
        createAppEntrypointWrapper,
        createPluginEntrypointWrapper,
    } = require(path.join(cliRoot, 'src/lib/compiler/entrypoints.js'));
    const { loadEnvFiles, getEnv } = require(path.join(cliRoot, 'src/lib/env'));
    const generateManifests = require(path.join(cliRoot, 'src/lib/generateManifests.js'));
    const parseConfig = require(path.join(cliRoot, 'src/lib/parseConfig.js'));
    const makePaths = require(path.join(cliRoot, 'src/lib/paths.js'));
    const i18n = require(path.join(cliRoot, 'src/lib/i18n'));

    const cwd = __dirname;
    if (
        !fs.existsSync(path.join(cwd, 'src', 'index.tsx')) ||
        !fs.existsSync(path.join(cwd, 'packages', 'rules-engine', 'build'))
    ) {
        console.log('Restoring missing capture-app v107.9.3 baseline files...');
        execSync(
            'rm -rf /tmp/capture-app-v107 && git clone --branch v107.9.3 --depth 1 https://github.com/dhis2/capture-app /tmp/capture-app-v107 && cp -rn /tmp/capture-app-v107/src/. ./src/ && cp -rn /tmp/capture-app-v107/packages/. ./packages/ && cp -rn /tmp/capture-app-v107/config/. ./config/ && cp -rn /tmp/capture-app-v107/public/. ./public/ && cp -rn /tmp/capture-app-v107/scripts/. ./scripts/ && rm -rf /tmp/capture-app-v107 && node scripts/createSymlinkToInternalPackages.mjs && npm run build --workspace=packages/rules-engine',
            { cwd, stdio: 'inherit' },
        );
    }
    const typeScript = fs.existsSync(path.join(cwd, 'tsconfig.json'));
    const paths = makePaths(cwd, { typeScript });
    const mode = 'development';
    process.env.BABEL_ENV = process.env.NODE_ENV = mode;
    loadEnvFiles(paths, mode);
    if (!process.env.DHIS2_CACHE_VERSION) {
        try {
            const pkgJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
            process.env.DHIS2_CACHE_VERSION = String(pkgJson.cacheVersion || '4');
        } catch {
            process.env.DHIS2_CACHE_VERSION = '4';
        }
    }

    const config = parseConfig(paths);

    await i18n.extract({
        input: paths.src,
        output: paths.i18nStrings,
        paths,
    });
    await i18n.generate({
        input: paths.i18nStrings,
        output: paths.i18nLocales,
        namespace: 'default',
        paths,
    });

    await bootstrapShell({ paths, force: false });

    verifyEntrypoints({ config, paths });
    if (config.entryPoints?.app) {
        await createAppEntrypointWrapper({
            entrypoint: config.entryPoints.app,
            paths,
        });
    }
    if (config.entryPoints?.plugin) {
        await createPluginEntrypointWrapper({
            entrypoint: config.entryPoints.plugin,
            paths,
        });
    }

    fs.rmSync(paths.shellApp, { recursive: true, force: true });
    fs.mkdirSync(paths.shellApp, { recursive: true });
    fs.cpSync(paths.src, paths.shellApp, { recursive: true, force: true });

    fs.rmSync(paths.shellPublic, { recursive: true, force: true });
    if (fs.existsSync(paths.shellSourcePublic)) {
        fs.cpSync(paths.shellSourcePublic, paths.shellPublic, { recursive: true, force: true });
    }
    if (fs.existsSync(paths.public)) {
        fs.cpSync(paths.public, paths.shellPublic, { recursive: true, force: true });
    }

    await generateManifests(paths, config, process.env.PUBLIC_URL);

    const env = getEnv({ config, publicUrl: '.' });
    const makeViteConfigUrl = pathToFileURL(path.join(cliRoot, 'config/makeViteConfig.mjs')).href;
    const { default: createViteConfig } = await import(makeViteConfigUrl);
    const viteConfig = await createViteConfig({
        config,
        paths,
        env,
        mode,
        host: '0.0.0.0',
        force: false,
        allowJsxInJs: false,
    });

    const { createServer } = await import('vite');
    const vite = await createServer({
        ...viteConfig,
        server: {
            ...viteConfig.server,
            middlewareMode: true,
            hmr: false,
        },
        appType: 'spa',
    });
    return vite;
}

async function startServer(): Promise<void> {
    const app = express();
    app.set('trust proxy', true);

    app.get('/api/health', (_req: Request, res: Response) => {
        res.json({ ok: true, service: 'capture-app-np-proxy' });
    });

    const serveBundleZip = (res: Response, requestedFilename?: string) => {
        const bundleDir = path.resolve(__dirname, 'build', 'bundle');
        let pkgVersion = '107.9.3';
        let pkgName = 'capture-app-np';
        try {
            const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
            pkgVersion = String(pkgJson.version || pkgVersion);
            pkgName = String(pkgJson.name || pkgName);
        } catch {
            // fall back to defaults
        }
        const defaultFilename = `${pkgName}-${pkgVersion}.zip`;
        const safeFilename = requestedFilename && /^capture-app-np-[0-9A-Za-z._-]+\.zip$/.test(requestedFilename)
            ? requestedFilename
            : defaultFilename;
        const targetPath = path.join(bundleDir, safeFilename);
        const fallbackPath = path.join(bundleDir, defaultFilename);
        const zipPath = fs.existsSync(targetPath) ? targetPath : fallbackPath;
        const downloadName = path.basename(zipPath);

        if (!fs.existsSync(zipPath)) {
            res.status(404).json({ error: 'Bundle zip not found. Run npm run build:zip first.' });
            return;
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.sendFile(zipPath);
    };

    app.get('/api/download/capture-app-np-overlay-repo.zip', (_req: Request, res: Response) => {
        const zipPath = path.resolve(__dirname, 'build', 'bundle', 'capture-app-np-overlay-repo.zip');
        if (!fs.existsSync(zipPath)) {
            res.status(404).json({ error: 'Overlay starter repo ZIP not found. Run npm run nepal:export-repo first.' });
            return;
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="capture-app-np-overlay-repo.zip"');
        res.sendFile(zipPath);
    });

    app.get('/api/download/capture-app-np-latest.zip', (_req: Request, res: Response) => {
        serveBundleZip(res);
    });

    app.get('/api/download/:filename', (req: Request, res: Response) => {
        const { filename } = req.params;
        if (!/^capture-app-np-[0-9A-Za-z._-]+\.zip$/.test(filename)) {
            res.status(404).json({ error: 'File not found.' });
            return;
        }
        serveBundleZip(res, filename);
    });

    app.use('/_dhis2_proxy', async (req: Request, res: Response) => {
        const headerTarget = typeof req.headers['x-dhis2-target'] === 'string'
            ? req.headers['x-dhis2-target'].trim()
            : '';
        const cookieTarget = getCookieValue(req.headers.cookie, 'dhis2_proxy_target');
        const rawBaseUrl = (headerTarget || cookieTarget).replace(/\/+$/, '');

        if (!rawBaseUrl) {
            res.status(400).json({ error: 'Missing DHIS2 target server URL.' });
            return;
        }

        let parsedBase: URL;
        try {
            parsedBase = new URL(rawBaseUrl);
        } catch {
            res.status(400).json({ error: 'Invalid DHIS2 server URL.' });
            return;
        }

        if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
            res.status(400).json({ error: 'Only http and https DHIS2 server URLs are supported.' });
            return;
        }

        if (isBlockedHost(parsedBase.hostname)) {
            res.status(403).json({ error: 'Target host is blocked by proxy policy.' });
            return;
        }

        const rawSessionHeader = typeof req.headers['x-dhis2-session'] === 'string'
            ? req.headers['x-dhis2-session'].trim()
            : '';
        const sessionId = rawSessionHeader || `srv_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
        const sessionKey = getSessionKey(sessionId, rawBaseUrl);

        const rawSuffix = req.originalUrl.replace(/^\/_dhis2_proxy/, '') || '/';
        const normalizedSuffix = `/${rawSuffix.replace(/^\/+/, '')}`;
        const initialTargetUrl = `${rawBaseUrl}${normalizedSuffix}`;

        if (normalizedSuffix.includes('logout.action') || normalizedSuffix.startsWith('/api/auth/logout')) {
            proxySessionJar.delete(sessionKey);
        }

        const baseForwardHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(req.headers)) {
            if (!val) continue;
            const lower = key.toLowerCase();
            if (
                lower === 'host' ||
                lower === 'connection' ||
                lower === 'content-length' ||
                lower === 'origin' ||
                lower === 'referer' ||
                lower === 'x-dhis2-target' ||
                lower === 'x-dhis2-session' ||
                lower === 'accept-encoding' ||
                lower === 'cookie'
            ) {
                continue;
            }
            baseForwardHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const bodyBuffer = await readRawBody(req);
            const allSetCookies: string[] = [];
            let currentUrl = initialTargetUrl;
            let currentMethod = req.method;
            let currentBody: Uint8Array | undefined = bodyBuffer ? new Uint8Array(bodyBuffer) : undefined;
            let upstream: globalThis.Response | null = null;
            const maxRedirects = 5;

            for (let hop = 0; hop <= maxRedirects; hop += 1) {
                const hopHeaders: Record<string, string> = { ...baseForwardHeaders };
                const outgoingCookies = buildOutgoingCookieHeader(
                    sessionKey,
                    typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
                );
                if (outgoingCookies) {
                    hopHeaders.cookie = outgoingCookies;
                }
                if (currentMethod === 'GET' || currentMethod === 'HEAD') {
                    delete hopHeaders['content-type'];
                    delete hopHeaders['Content-Type'];
                }

                upstream = await fetch(currentUrl, {
                    method: currentMethod,
                    headers: hopHeaders,
                    body: currentBody,
                    redirect: 'manual',
                    signal: controller.signal,
                });

                const headersWithCookies = upstream.headers as unknown as {
                    getSetCookie?: () => string[];
                };
                const hopCookies = typeof headersWithCookies.getSetCookie === 'function'
                    ? headersWithCookies.getSetCookie()
                    : [];
                if (hopCookies.length > 0) {
                    allSetCookies.push(...hopCookies);
                    applySetCookiesToJar(sessionKey, hopCookies);
                }

                const isRedirect =
                    upstream.status === 301 ||
                    upstream.status === 302 ||
                    upstream.status === 303 ||
                    upstream.status === 307 ||
                    upstream.status === 308;
                const location = upstream.headers.get('location');

                if (isRedirect && location && hop < maxRedirects) {
                    const nextUrl = resolveSameServerRedirect(location, currentUrl, parsedBase);
                    if (nextUrl) {
                        // Drain redirect response body to free socket
                        try {
                            await upstream.arrayBuffer();
                        } catch {
                            // ignore
                        }
                        currentUrl = nextUrl;
                        if (upstream.status === 301 || upstream.status === 302 || upstream.status === 303) {
                            currentMethod = 'GET';
                            currentBody = undefined;
                        }
                        continue;
                    }
                }
                break;
            }

            if (!upstream) {
                res.status(502).json({ error: 'No response received from DHIS2 server.' });
                return;
            }

            res.status(upstream.status);
            res.setHeader('x-dhis2-session', sessionId);
            res.setHeader('access-control-expose-headers', 'x-dhis2-session');

            const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

            upstream.headers.forEach((value, key) => {
                const lower = key.toLowerCase();
                if (
                    lower === 'set-cookie' ||
                    lower === 'content-encoding' ||
                    lower === 'content-length' ||
                    lower === 'transfer-encoding' ||
                    lower === 'access-control-allow-origin' ||
                    lower === 'access-control-allow-credentials' ||
                    lower === 'content-security-policy' ||
                    lower === 'x-frame-options' ||
                    lower === 'strict-transport-security'
                ) {
                    return;
                }
                if (lower === 'location') {
                    const nextSameHost = resolveSameServerRedirect(value, currentUrl, parsedBase);
                    if (nextSameHost && nextSameHost.startsWith(rawBaseUrl)) {
                        const rel = nextSameHost.slice(rawBaseUrl.length) || '/';
                        res.setHeader('location', `/_dhis2_proxy/${rel.replace(/^\/+/, '')}`);
                        return;
                    }
                }
                res.setHeader(key, value);
            });

            if (allSetCookies.length > 0) {
                res.setHeader(
                    'set-cookie',
                    allSetCookies.map(c => rewriteSetCookie(c, isHttps)),
                );
            }

            const respBuffer = Buffer.from(await upstream.arrayBuffer());
            res.send(respBuffer);
        } catch (err) {
            const message =
                err instanceof Error && err.name === 'AbortError'
                    ? 'DHIS2 server request timed out after 30 seconds.'
                    : err instanceof Error
                        ? err.message
                        : 'Failed to reach DHIS2 server.';
            res.status(502).json({ error: message });
        } finally {
            clearTimeout(timeout);
        }
    });

    if (!IS_PRODUCTION) {
        const vite = await createDhis2DevViteMiddleware();
        app.use(vite.middlewares);
    } else {
        const distDir = path.resolve(__dirname, 'build', 'app');
        app.use(express.static(distDir));
        app.get('*', (_req: Request, res: Response) => {
            const indexHtml = path.join(distDir, 'index.html');
            if (fs.existsSync(indexHtml)) {
                res.sendFile(indexHtml);
            } else {
                res.status(404).send('Build output not found. Run npm run build first.');
            }
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`DHIS2 Capture server running on http://0.0.0.0:${PORT}`);
    });
}

startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
