import { describe, expect, it } from 'vitest';
import {
    DEFAULT_IBMEYEAI_UI_PREFERENCES,
    normalizeIBMEyeAiUiPreferences
} from './ui-model';

describe('ibmeyeai ui-model', () => {
    it('returns defaults when no preferences are stored', () => {
        expect(normalizeIBMEyeAiUiPreferences(undefined)).toEqual({
            transcriptHeight: 320,
            widgetOpen: false,
            widgetWidth: 480,
            widgetHeight: 700
        });
    });

    it('clamps transcript and widget dimensions into safe bounds', () => {
        expect(normalizeIBMEyeAiUiPreferences({
            transcriptHeight: 999,
            widgetWidth: 100,
            widgetHeight: 999,
            widgetOpen: true
        })).toEqual({
            transcriptHeight: 560,
            widgetWidth: 340,
            widgetHeight: 820,
            widgetOpen: true
        });
    });

    it('normalizes valid custom preferences', () => {
        expect(normalizeIBMEyeAiUiPreferences({
            transcriptHeight: 388.4,
            widgetOpen: true,
            widgetWidth: 512.2,
            widgetHeight: 690.7
        })).toEqual({
            transcriptHeight: 388,
            widgetOpen: true,
            widgetWidth: 512,
            widgetHeight: 691
        });
    });
});
