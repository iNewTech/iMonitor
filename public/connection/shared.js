export function applyTheme(themeId) {
    document.body.dataset.theme = themeId || 'operator-light';
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
        {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;'
        }[char]
    ));
}
