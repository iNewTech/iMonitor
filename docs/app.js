const DOCS_THEME_KEY = 'ibmeye-docs-theme';

/**
 * Resolve the saved docs theme preference.
 * @returns {"light" | "dark" | "system"}
 */
function getSavedDocsTheme() {
    const savedTheme = window.localStorage.getItem(DOCS_THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        return savedTheme;
    }

    return 'system';
}

/**
 * Apply the selected docs theme to the page root.
 * @param {"light" | "dark" | "system"} theme
 */
function applyDocsTheme(theme) {
    const resolvedTheme = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;

    document.documentElement.dataset.theme = resolvedTheme;
}

/**
 * Initialize shared docs theme controls.
 */
function initializeDocsTheme() {
    const themeSelector = document.querySelector('[data-docs-theme-select]');
    const savedTheme = getSavedDocsTheme();

    applyDocsTheme(savedTheme);

    if (themeSelector instanceof HTMLSelectElement) {
        themeSelector.value = savedTheme;
        themeSelector.addEventListener('change', () => {
            const selectedTheme = themeSelector.value === 'light' || themeSelector.value === 'dark'
                ? themeSelector.value
                : 'system';

            window.localStorage.setItem(DOCS_THEME_KEY, selectedTheme);
            applyDocsTheme(selectedTheme);
        });
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
        if (getSavedDocsTheme() === 'system') {
            applyDocsTheme('system');
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeDocsTheme);
