export interface IBMEyeAiUiPreferences {
    transcriptHeight: number;
    widgetOpen: boolean;
    widgetWidth: number;
    widgetHeight: number;
}

export const DEFAULT_IBMEYEAI_UI_PREFERENCES: IBMEyeAiUiPreferences = {
    transcriptHeight: 760,
    widgetOpen: false,
    widgetWidth: 680,
    widgetHeight: 920
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
            ? Math.max(260, Math.min(760, Math.round(transcriptHeight)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.transcriptHeight,
        widgetOpen: candidate?.widgetOpen ?? DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetOpen,
        widgetWidth: Number.isFinite(widgetWidth)
            ? Math.max(420, Math.min(680, Math.round(widgetWidth)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetWidth,
        widgetHeight: Number.isFinite(widgetHeight)
            ? Math.max(520, Math.min(920, Math.round(widgetHeight)))
            : DEFAULT_IBMEYEAI_UI_PREFERENCES.widgetHeight
    };
}
