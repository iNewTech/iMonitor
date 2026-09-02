function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

/**
 * Converts safe web URLs in an operator-log detail into external-link anchors.
 */
export function renderOperatorLogDetail(value) {
    const text = String(value ?? '');
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    let output = '';
    let cursor = 0;

    for (const match of text.matchAll(urlPattern)) {
        const rawUrl = match[0];
        const start = match.index ?? 0;
        let url = rawUrl;

        while (/[.,;:!?)]$/.test(url)) {
            url = url.slice(0, -1);
        }

        try {
            const parsedUrl = new URL(url);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                continue;
            }

            output += escapeHtml(text.slice(cursor, start));
            output += `<a class="operator-log-link" href="${escapeHtml(parsedUrl.toString())}" data-external-url="${escapeHtml(parsedUrl.toString())}" rel="noreferrer">${escapeHtml(parsedUrl.toString())}</a>`;
            output += escapeHtml(rawUrl.slice(url.length));
            cursor = start + rawUrl.length;
        } catch {
            continue;
        }
    }

    return output + escapeHtml(text.slice(cursor));
}
