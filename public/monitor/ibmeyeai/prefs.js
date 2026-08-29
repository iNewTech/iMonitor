const DEFAULT_PREFERENCES = {
    transcriptHeight: 320,
    widgetOpen: false,
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
        return {
            transcriptHeight: normalizeNumber(parsed?.transcriptHeight, 220, 560, DEFAULT_PREFERENCES.transcriptHeight),
            widgetOpen: Boolean(parsed?.widgetOpen),
            widgetWidth: normalizeNumber(parsed?.widgetWidth, 340, 720, DEFAULT_PREFERENCES.widgetWidth),
            widgetHeight: normalizeNumber(parsed?.widgetHeight, 420, 820, DEFAULT_PREFERENCES.widgetHeight)
        };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

export function saveIBMEyeAiPreferences(nextPreferences) {
    const normalized = {
        transcriptHeight: normalizeNumber(nextPreferences?.transcriptHeight, 220, 560, DEFAULT_PREFERENCES.transcriptHeight),
        widgetOpen: Boolean(nextPreferences?.widgetOpen),
        widgetWidth: normalizeNumber(nextPreferences?.widgetWidth, 340, 720, DEFAULT_PREFERENCES.widgetWidth),
        widgetHeight: normalizeNumber(nextPreferences?.widgetHeight, 420, 820, DEFAULT_PREFERENCES.widgetHeight)
    };

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        return normalized;
    }

    return normalized;
}
