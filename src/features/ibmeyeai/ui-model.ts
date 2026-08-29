export interface IBMEyeAiUiPreferences {
    transcriptHeight: number;
    widgetOpen: boolean;
    widgetWidth: number;
    widgetHeight: number;
}

export const DEFAULT_IBMEYEAI_UI_PREFERENCES: IBMEyeAiUiPreferences = {
    transcriptHeight: 320,
    widgetOpen: false,
    widgetWidth: 480,
    widgetHeight: 700
};

/**
 * Normalizes renderer-only IBMEye AI UI preferences into a safe persisted shape.
 */
export function normalizeIBMEyeAiUiPreferences(
    candidate: Partial<IBMEyeAiUiPreferences> | undefined
): IBMEyeAiUiPreferences {
    const transcriptHeight = Number(candidate?.transcriptHeight);
    const widgetWidth = Number(candidate?.widgetWidth);
    const widgetHeight = Number(candidate?.widgetHeight);

    return {
        transcriptHeight: Number.isFinite(transcriptHeight)
            ? Math.max(220, Math.min(560, Math.round(transcriptHeight)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.transcriptHeight,
        widgetOpen: candidate?.widgetOpen ?? DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetOpen,
        widgetWidth: Number.isFinite(widgetWidth)
            ? Math.max(340, Math.min(720, Math.round(widgetWidth)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetWidth,
        widgetHeight: Number.isFinite(widgetHeight)
            ? Math.max(420, Math.min(820, Math.round(widgetHeight)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetHeight
    };
}
