/**
 * Supported UI theme ids.
 */
export type ThemeId =
    | 'operator-light'
    | 'night-console'
    | 'paper-terminal'
    | 'aurora-mist'
    | 'copper-nocturne';

/**
 * Selectable theme metadata for the renderer switcher.
 */
export interface ThemeOption {
    id: ThemeId;
    label: string;
    description: string;
}

/**
 * Default theme for first launch and invalid stored values.
 */
export const DEFAULT_THEME_ID: ThemeId = 'operator-light';

/**
 * All theme options exposed to the UI.
 */
export const THEME_OPTIONS: ThemeOption[] = [
    {
        id: 'operator-light',
        label: 'Operator Light',
        description: 'Warm glass surfaces with deep green operator accents.'
    },
    {
        id: 'night-console',
        label: 'Night Console',
        description: 'Dark graphite panels with cool teal signal contrast.'
    },
    {
        id: 'paper-terminal',
        label: 'Paper Terminal',
        description: 'Soft paper tones with ink-heavy terminals and amber highlights.'
    },
    {
        id: 'aurora-mist',
        label: 'Aurora Mist',
        description: 'Cool pearl panels with sea-glass accents and low-contrast depth.'
    },
    {
        id: 'copper-nocturne',
        label: 'Copper Nocturne',
        description: 'Deep evening surfaces with copper signals and restrained contrast.'
    }
];

/**
 * Returns the canonical theme id for a stored or user-supplied value.
 */
export function normalizeThemeId(candidate: string | undefined | null): ThemeId {
    const matchedTheme = THEME_OPTIONS.find((theme) => theme.id === candidate);
    return matchedTheme?.id ?? DEFAULT_THEME_ID;
}

/**
 * Looks up one theme option by id.
 */
export function getThemeOption(themeId: string | undefined | null) {
    const normalizedThemeId = normalizeThemeId(themeId);
    return THEME_OPTIONS.find((theme) => theme.id === normalizedThemeId);
}
