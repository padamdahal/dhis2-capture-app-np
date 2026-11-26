import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const dhis2ProxyShimPlugin = (): Plugin => ({
    name: 'dhis2-iframe-proxy-shim',
    transformIndexHtml(html: string) {
        const shim = `<script>
(function () {
  if (typeof window === 'undefined' || window.__dhis2ProxyShimInstalled) return;
  window.__dhis2ProxyShimInstalled = true;

  var nativeFetch = window.fetch.bind(window);
  var SESSION_STORAGE_KEY = '__dhis2_proxy_session_id';

  function getOrCreateProxySessionId() {
    var existing = '';
    try { existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY) || ''; } catch (_) {}
    if (!existing) {
      try { existing = window.localStorage.getItem(SESSION_STORAGE_KEY) || ''; } catch (_) {}
    }
    if (!existing) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        existing = window.crypto.randomUUID();
      } else {
        existing = 'sess_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      }
      try { window.sessionStorage.setItem(SESSION_STORAGE_KEY, existing); } catch (_) {}
      try { window.localStorage.setItem(SESSION_STORAGE_KEY, existing); } catch (_) {}
    }
    return existing;
  }

  function saveProxySessionId(token) {
    if (!token) return;
    try { window.sessionStorage.setItem(SESSION_STORAGE_KEY, token); } catch (_) {}
    try { window.localStorage.setItem(SESSION_STORAGE_KEY, token); } catch (_) {}
  }

  function setTargetCookie(base) {
    try {
      var attrs = window.location.protocol === 'https:'
        ? '; SameSite=None; Secure; Partitioned'
        : '; SameSite=Lax';
      document.cookie = 'dhis2_proxy_target=' + encodeURIComponent(base) + '; path=/' + attrs;
    } catch (_) {}
  }

  function normalizeRest(rest) {
    var cleaned = String(rest || '/').replace(/^\\/+/, '');
    return '/' + cleaned;
  }

  function resolveProxyTarget(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https?:\\/\\//i.test(rawUrl)) return null;
    try {
      var parsed = new URL(rawUrl);
      if (parsed.origin === window.location.origin) return null;

      var storedBase = '';
      try {
        storedBase = (window.localStorage.getItem('DHIS2_BASE_URL') || '').trim().replace(/\\/+$/, '');
      } catch (_) {}

      if (storedBase && rawUrl.indexOf(storedBase) === 0) {
        var boundaryChar = rawUrl.charAt(storedBase.length);
        if (boundaryChar === '' || boundaryChar === '/' || boundaryChar === '?') {
          var rest = rawUrl.slice(storedBase.length) || '/';
          return { base: storedBase, rewrittenUrl: '/_dhis2_proxy' + normalizeRest(rest) };
        }
      }

      var match = parsed.pathname.match(/^(.*?)(?:\\/api\\/|\\/dhis-web-|\\/icons\\/|\\/images\\/|\\/login\\.action)/);
      if (match) {
        var base = (parsed.origin + match[1]).replace(/\\/+$/, '');
        var remainder = normalizeRest(parsed.pathname.slice(match[1].length)) + parsed.search;
        return { base: base, rewrittenUrl: '/_dhis2_proxy' + remainder };
      }
    } catch (_) {}
    return null;
  }

  window.fetch = function (input, init) {
    var rawUrl = typeof input === 'string'
      ? input
      : (typeof URL !== 'undefined' && input instanceof URL)
        ? input.href
        : (input && input.url) || '';
    var resolved = resolveProxyTarget(rawUrl);
    if (!resolved) {
      return nativeFetch(input, init);
    }

    setTargetCookie(resolved.base);
    var sessionId = getOrCreateProxySessionId();
    var headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    headers.set('x-dhis2-target', resolved.base);
    headers.set('x-dhis2-session', sessionId);

    var nextInit = Object.assign({}, init || {}, {
      headers: headers,
      credentials: 'same-origin',
    });

    var reqPromise;
    if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) {
      reqPromise = nativeFetch(resolved.rewrittenUrl, nextInit);
    } else {
      var reqMethod = (init && init.method) || input.method || 'GET';
      var hasBody = reqMethod !== 'GET' && reqMethod !== 'HEAD';
      var reqBody = hasBody ? ((init && init.body !== undefined) ? init.body : input.body) : undefined;
      var clonedReq = new Request(resolved.rewrittenUrl, {
        method: reqMethod,
        headers: headers,
        body: reqBody,
        credentials: 'same-origin',
      });
      reqPromise = nativeFetch(clonedReq, nextInit);
    }

    return reqPromise.then(function (resp) {
      try {
        var returnedSession = resp && resp.headers && resp.headers.get('x-dhis2-session');
        if (returnedSession) saveProxySessionId(returnedSession);
      } catch (_) {}
      return resp;
    });
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    var resolved = resolveProxyTarget(String(url || ''));
    if (resolved) {
      this.__dhis2TargetBase = resolved.base;
      setTargetCookie(resolved.base);
      return origOpen.call(this, method, resolved.rewrittenUrl, async !== false, user, password);
    }
    this.__dhis2TargetBase = null;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__dhis2TargetBase) {
      try {
        this.withCredentials = true;
        this.setRequestHeader('x-dhis2-target', this.__dhis2TargetBase);
        this.setRequestHeader('x-dhis2-session', getOrCreateProxySessionId());
      } catch (_) {}
    }
    return origSend.call(this, body);
  };
})();
</script>`;
        return html.replace('</head>', `${shim}\n</head>`);
    },
});

const viteConfig = defineConfig((configEnv) => {
    const { mode } = configEnv;
    return {
        clearScreen: mode !== 'development',
        plugins: [dhis2ProxyShimPlugin()],
        resolve: {
            alias: {
                'capture-core': path.resolve(__dirname, 'src/core_modules/capture-core'),
                'capture-ui': path.resolve(__dirname, 'src/core_modules/capture-ui'),
                'capture-core-utils': path.resolve(__dirname, 'src/core_modules/capture-core-utils'),
                'capture-nepal': path.resolve(__dirname, 'src/nepal'),
                '@dhis2/rules-engine-javascript': path.resolve(__dirname, 'packages/rules-engine/src'),
            },
        },
        define: {
            global: 'window',
            'process.env.DHIS2_CACHE_VERSION': JSON.stringify(process.env.DHIS2_CACHE_VERSION || '4'),
        },
        build: {
            sourcemap: false,
            minify: false,
            rollupOptions: {
                maxParallelFileOps: 1,
            },
        },
        optimizeDeps: {
            include: [
                'react',
                'react-dom',
                'react-router-dom',
                'history',
                'prop-types',
                'redux',
                'react-redux',
                'redux-observable',
                'redux-batched-actions',
                'reselect',
                'rxjs',
                '@tanstack/react-query',
                '@tanstack/react-query-devtools',
                '@dhis2/ui',
                '@dhis2/app-runtime',
                '@dhis2/rule-engine',
                '@dhis2/d2-i18n',
                '@dhis2/d2-ui-rich-text',
                'leaflet',
                'leaflet-draw',
                'react-leaflet',
                'react-leaflet-draw',
                'react-leaflet-search-unpolyfilled',
                'lodash',
                'uuid',
                'moment',
                'date-fns',
                'nepali-date-converter',
                'loglevel',
                'query-string',
                '@emotion/react',
                '@emotion/react/jsx-dev-runtime',
                '@emotion/css',
                'react-jss',
                '@popperjs/core',
                'react-popper',
                'react-select',
                'react-dnd',
                'react-dnd-html5-backend',
                'react-html-parser-ultimate',
                'react-transform-tree',
                'd2-utilizr',
            ],
            esbuildOptions: {
                target: 'esnext',
            },
        },
        server: {
            host: '0.0.0.0',
            port: 3000,
            allowedHosts: true,
            hmr: process.env.DISABLE_HMR !== 'true',
            watch: process.env.DISABLE_HMR === 'true' ? null : {
                ignored: ['**/node_modules/**', '**/.d2/**'],
            },
            fs: {
                cachedChecks: true,
                strict: false,
            },
        },
        css: {
            devSourcemap: false,
        },
    };
});

export default viteConfig;
