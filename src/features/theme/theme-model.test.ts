import { describe, expect, it } from 'vitest';
import {
    DEFAULT_THEME_ID,
    THEME_OPTIONS,
    getThemeOption,
    normalizeThemeId
} from './theme-model';

describe('theme model', () => {
    it('returns the default theme when the stored value is missing or invalid', () => {
        expect(normalizeThemeId(undefined)).toBe(DEFAULT_THEME_ID);
        expect(normalizeThemeId('unknown-theme')).toBe(DEFAULT_THEME_ID);
    });

    it('keeps supported theme ids unchanged', () => {
        expect(normalizeThemeId('operator-light')).toBe('operator-light');
        expect(normalizeThemeId('night-console')).toBe('night-console');
        expect(normalizeThemeId('paper-terminal')).toBe('paper-terminal');
        expect(normalizeThemeId('aurora-mist')).toBe('aurora-mist');
        expect(normalizeThemeId('copper-nocturne')).toBe('copper-nocturne');
    });

    it('exposes five selectable themes with stable ids and labels', () => {
        expect(THEME_OPTIONS).toHaveLength(5);
        expect(THEME_OPTIONS.map((theme) => theme.id)).toEqual([
            'operator-light',
            'night-console',
            'paper-terminal',
            'aurora-mist',
            'copper-nocturne'
        ]);
        expect(getThemeOption('night-console')?.label).toBe('Night Console');
    });
});
