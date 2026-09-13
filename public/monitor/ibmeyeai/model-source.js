export function getProviderCatalog(snapshot) {
    return Array.isArray(snapshot.providerCatalog) ? snapshot.providerCatalog : [];
}

export function getAiProviderOption(snapshot, providerId) {
    const catalog = getProviderCatalog(snapshot);
    return catalog.find((provider) => provider.id === providerId) ?? catalog[0] ?? null;
}

export function getProviderModels(snapshot, providerId) {
    if (!getAiProviderOption(snapshot, providerId)) {
        return [];
    }

    if (snapshot.availability?.provider !== providerId) {
        return [];
    }

    return Array.isArray(snapshot.availability.availableModels)
        ? snapshot.availability.availableModels.slice()
        : [];
}

export function getProviderModelSourceHint(snapshot, providerId) {
    if (snapshot.availability?.provider === providerId && snapshot.availability?.availableModels?.length) {
        const count = snapshot.availability.availableModels.length;
        return `Live models loaded (${count})`;
    }

    return 'No available models. Configure AI in Settings.';
}

/** A quick picker only offers providers proven ready by discovery. Setup stays in Settings. */
export function canUseProvider(snapshot, providerId) {
    return snapshot.settings?.enabled === true
        && snapshot.availability?.enabled !== false
        && snapshot.availability?.healthy === true
        && snapshot.availability?.provider === providerId
        && getProviderModels(snapshot, providerId).length > 0;
}
