import { describe, expect, it } from 'vitest';
import {
    DEFAULT_IBMEYEAI_UI_PREFERENCES,
    normalizeIBMEyeAiUiPreferences
} from './ui-model';

describe('ibmeyeai ui-model', () => {
    it('returns defaults when no preferences are stored', () => {
        expect(normalizeIBMEyeAiUiPreferences(undefined)).toEqual({
            transcriptHeight: 760,
            widgetOpen: false,
            widgetWidth: 680,
            widgetHeight: 920
        });
    });

    it('clamps transcript and widget dimensions into safe bounds', () => {
        expect(normalizeIBMEyeAiUiPreferences({
            transcriptHeight: 999,
            widgetWidth: 100,
            widgetHeight: 999,
            widgetOpen: true
        })).toEqual({
            transcriptHeight: 760,
            widgetWidth: 420,
            widgetHeight: 920,
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
