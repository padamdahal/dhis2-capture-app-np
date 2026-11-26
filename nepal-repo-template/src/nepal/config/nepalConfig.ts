export type NepalBrandingConfig = {
    name: string;
    title: string;
    id: string;
    coreApp: boolean;
    cacheVersion: string;
};

export type NepalFeatureFlags = {
    nepaliDatePicker: boolean;
};

export const NEPAL_BRANDING: NepalBrandingConfig = {
    name: 'capture-app-np',
    title: 'Capture NP',
    id: 'c4f7a91e-8d2b-4f63-9a5c-7e1b3d0f82a4',
    coreApp: false,
    cacheVersion: '4',
};

export const NEPAL_FEATURES: NepalFeatureFlags = {
    nepaliDatePicker: true,
};
