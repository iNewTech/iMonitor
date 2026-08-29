function escapeHtml(value) {
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

function renderInlineMarkdown(value) {
    return value
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n][^*\n]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(value) {
    const escaped = escapeHtml(value).replace(/\r\n/g, '\n');
    const blocks = [];
    const lines = escaped.split('\n');
    let listItems = [];
    let paragraphLines = [];

    function flushList() {
        if (!listItems.length) {
            return;
        }

        blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
        listItems = [];
    }

    function flushParagraph() {
        if (!paragraphLines.length) {
            return;
        }

        blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('<br>'))}</p>`);
        paragraphLines = [];
    }

    for (const line of lines) {
        const trimmedLine = line.trim();
        const listMatch = trimmedLine.match(/^[-*]\s+(.+)$/);

        if (!trimmedLine) {
            flushParagraph();
            flushList();
            continue;
        }

        if (listMatch) {
            flushParagraph();
            listItems.push(listMatch[1]);
            continue;
        }

        flushList();
        paragraphLines.push(trimmedLine);
    }

    flushParagraph();
    flushList();

    return blocks.join('') || '<p></p>';
}

export function buildAiTranscriptMarkup(conversation, pendingReply, pendingModelLabel = '') {
    if (!conversation.length) {
        return `
            <div class="activity-log-empty">
                <i class="bi bi-robot"></i>
                <span>Ask IBMEye AI about alerts, waits, SQL, or the selected job.</span>
            </div>
        `;
    }

    const transcriptMarkup = conversation.map((message) => `
        <div class="ai-chat-row is-${escapeHtml(message.role)}">
            <article class="ai-chat-message is-${escapeHtml(message.role)}">
                <div class="ai-chat-message-header">
                    <span class="ai-chat-author">${escapeHtml(message.role === 'assistant' ? 'IBMEye AI' : 'You')}</span>
                </div>
                <div class="ai-chat-message-copy">${renderMarkdown(message.content)}</div>
            </article>
        </div>
    `).join('');

    const pendingLabel = pendingModelLabel
        ? `IBMEye AI: ${escapeHtml(pendingModelLabel)} replying...`
        : 'IBMEye AI replying...';

    const pendingMarkup = pendingReply ? `
        <div class="ai-chat-row is-assistant">
            <article class="ai-chat-message is-assistant is-pending">
                <div class="ai-chat-message-header">
                    <span class="ai-chat-author">${pendingLabel}</span>
                </div>
                <div class="ai-chat-typing" aria-live="polite" aria-label="IBMEye AI is replying">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </article>
        </div>
    ` : '';

    return `${transcriptMarkup}${pendingMarkup}`;
}
