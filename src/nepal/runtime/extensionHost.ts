import React, { useEffect, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {
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
} from '@dhis2/ui';
import type { NepalBrandingConfig, NepalFeatureFlags } from '../config/nepalConfig';
import type { NepaliDateAddonProps } from '../calendar/NepaliDateAddon.component';

export type NepalExtensionHost = {
    React: typeof React;
    jsxRuntime: typeof jsxRuntime;
    dhis2Ui: Record<string, any>;
};

export type NepalExtensionAPI = {
    NEPAL_BRANDING: NepalBrandingConfig;
    NEPAL_FEATURES: NepalFeatureFlags;
    NepaliDateAddon: React.FC<NepaliDateAddonProps>;
};

declare global {
    interface Window {
        __CAPTURE_NP_HOST__?: NepalExtensionHost;
        __CAPTURE_NP_EXT__?: NepalExtensionAPI | null;
    }
}

const hostContext: NepalExtensionHost = {
    React,
    jsxRuntime,
    dhis2Ui: {
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
    },
};

let loadedExtension: NepalExtensionAPI | null = null;
let loadPromise: Promise<NepalExtensionAPI | null> | null = null;
const listeners = new Set<() => void>();

const notifyListeners = () => {
    listeners.forEach((fn) => {
        try {
            fn();
        } catch {
            // ignore subscriber errors
        }
    });
};

export const registerNepalHost = (): NepalExtensionHost => {
    if (typeof globalThis !== 'undefined') {
        (globalThis as any).__CAPTURE_NP_HOST__ = hostContext;
    }
    if (typeof window !== 'undefined') {
        window.__CAPTURE_NP_HOST__ = hostContext;
    }
    return hostContext;
};

export const getNepalExtension = (): NepalExtensionAPI | null => loadedExtension;

export const subscribeNepalExtension = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const isDevRuntime = (): boolean => {
    try {
        return Boolean((import.meta as any).env?.DEV);
    } catch {
        return false;
    }
};

const resolveExtensionBundleUrl = async (): Promise<string> => {
    let cacheTag = 'v1';
    try {
        const metaUrl = new URL('./nepal-extension.meta.json', window.location.href).href;
        const resp = await fetch(metaUrl, { cache: 'no-cache' });
        if (resp.ok) {
            const meta = await resp.json();
            if (meta && typeof meta.hash === 'string' && meta.hash.length > 0) {
                cacheTag = meta.hash;
            }
        }
    } catch {
        // fallback to default cacheTag if meta.json is unavailable
    }
    const bundleUrl = new URL('./nepal-extension.js', window.location.href);
    bundleUrl.searchParams.set('v', cacheTag);
    return bundleUrl.href;
};

export const ensureNepalExtensionLoaded = (): Promise<NepalExtensionAPI | null> => {
    registerNepalHost();

    if (loadedExtension) {
        return Promise.resolve(loadedExtension);
    }
    if (loadPromise) {
        return loadPromise;
    }

    loadPromise = (async () => {
        try {
            let mod: any;
            if (isDevRuntime()) {
                // Direct module load in Vite dev server for instant source edits
                mod = await import('../extensionEntry');
            } else {
                // Standalone runtime bundle loaded in production so Nepal edits rebuild in ~2s
                const bundleUrl = await resolveExtensionBundleUrl();
                mod = await import(/* @vite-ignore */ bundleUrl);
            }

            const api: NepalExtensionAPI | null =
                typeof mod?.initNepalExtension === 'function'
                    ? mod.initNepalExtension(hostContext)
                    : mod?.NepaliDateAddon
                        ? {
                            NEPAL_BRANDING: mod.NEPAL_BRANDING,
                            NEPAL_FEATURES: mod.NEPAL_FEATURES,
                            NepaliDateAddon: mod.NepaliDateAddon,
                        }
                        : null;

            if (api && typeof api.NepaliDateAddon === 'function') {
                loadedExtension = api;
                if (typeof window !== 'undefined') {
                    window.__CAPTURE_NP_EXT__ = api;
                }
                notifyListeners();
                return api;
            }
            return null;
        } catch (err) {
            // Graceful fallback to native AD DateField if extension script is unavailable
            // eslint-disable-next-line no-console
            console.warn('[capture-app-np] Nepal extension unavailable, falling back to native AD input:', err);
            return null;
        }
    })();

    return loadPromise;
};

export const useNepalExtension = (): NepalExtensionAPI | null => {
    const [ext, setExt] = useState<NepalExtensionAPI | null>(() => getNepalExtension());

    useEffect(() => {
        if (getNepalExtension()) {
            setExt(getNepalExtension());
            return undefined;
        }
        const unsubscribe = subscribeNepalExtension(() => {
            setExt(getNepalExtension());
        });
        void ensureNepalExtensionLoaded();
        return unsubscribe;
    }, []);

    return ext;
};

export const NepalDateAddonBridge: React.FC<NepaliDateAddonProps> = (props) => {
    const ext = useNepalExtension();
    const { width = '100%', maxWidth, children } = props;

    if (ext && ext.NEPAL_FEATURES?.nepaliDatePicker && typeof ext.NepaliDateAddon === 'function') {
        return React.createElement(ext.NepaliDateAddon, props);
    }

    return React.createElement(
        'div',
        {
            style: {
                width,
                maxWidth: maxWidth || undefined,
            },
        },
        children,
    );
};
