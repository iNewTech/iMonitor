const DEFAULT_PREFERENCES = {
    transcriptHeight: 760,
    widgetOpen: false,
    widgetWidth: 680,
    widgetHeight: 920
};
const LEGACY_DEFAULT_PREFERENCES = {
    transcriptHeight: 320,
    widgetWidth: 480,
    widgetHeight: 700
};

const STORAGE_KEY = 'ibmeyeai-ui-preferences';

function normalizeNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function loadIBMEyeAiPreferences() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_PREFERENCES };
        }

        const parsed = JSON.parse(raw);
        const hasLegacyDefaultSizing = Number(parsed?.transcriptHeight) === LEGACY_DEFAULT_PREFERENCES.transcriptHeight
            && Number(parsed?.widgetWidth) === LEGACY_DEFAULT_PREFERENCES.widgetWidth
            && Number(parsed?.widgetHeight) === LEGACY_DEFAULT_PREFERENCES.widgetHeight;

        if (hasLegacyDefaultSizing) {
            const upgradedPreferences = {
                ...DEFAULT_PREFERENCES,
                widgetOpen: Boolean(parsed?.widgetOpen)
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(upgradedPreferences));
            return upgradedPreferences;
        }

        return {
            transcriptHeight: normalizeNumber(parsed?.transcriptHeight, 260, 760, DEFAULT_PREFERENCES.transcriptHeight),
            widgetOpen: Boolean(parsed?.widgetOpen),
            widgetWidth: normalizeNumber(parsed?.widgetWidth, 420, 680, DEFAULT_PREFERENCES.widgetWidth),
            widgetHeight: normalizeNumber(parsed?.widgetHeight, 520, 920, DEFAULT_PREFERENCES.widgetHeight)
        };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

export function saveIBMEyeAiPreferences(nextPreferences) {
    const normalized = {
        transcriptHeight: normalizeNumber(nextPreferences?.transcriptHeight, 260, 760, DEFAULT_PREFERENCES.transcriptHeight),
        widgetOpen: Boolean(nextPreferences?.widgetOpen),
        widgetWidth: normalizeNumber(nextPreferences?.widgetWidth, 420, 680, DEFAULT_PREFERENCES.widgetWidth),
        widgetHeight: normalizeNumber(nextPreferences?.widgetHeight, 520, 920, DEFAULT_PREFERENCES.widgetHeight)
    };

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        return normalized;
    }

    return normalized;
}
