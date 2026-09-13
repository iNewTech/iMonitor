function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function text(value, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function dateLabel(value) {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export function normalizeAiCitations(value, relevanceReasons = []) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === 'object' && typeof item.recordId === 'string')
        .slice(0, 12)
        .map((item) => ({
            id: text(item.id, 240) || `citation:${text(item.recordId, 240)}`,
            recordId: text(item.recordId, 240),
            label: text(item.label, 240) || 'Evidence source',
            sourceType: text(item.sourceType, 60) || text(item.sourceRef?.kind, 40) || 'evidence',
            status: text(item.status, 40) || 'unknown',
            excerpt: text(item.excerpt, 500),
            observedAt: text(item.observedAt, 40),
            reasons: Array.isArray(relevanceReasons)
                ? (relevanceReasons.find((reason) => reason?.recordId === item.recordId)?.reasons || []).filter((reason) => typeof reason === 'string').slice(0, 3)
                : [],
            sourceRef: item.sourceRef && typeof item.sourceRef === 'object'
                ? {
                    kind: text(item.sourceRef.kind, 40),
                    id: text(item.sourceRef.id, 240),
                    locator: text(item.sourceRef.locator, 500)
                }
                : undefined
        }));
}

export function renderAiCitationChips(citations) {
    const items = normalizeAiCitations(citations);
    if (!items.length) return '';
    return `<div class="ai-citation-strip" aria-label="Answer sources">
        <span class="ai-citation-label">Sources</span>
        ${items.map((citation, index) => `<button type="button" class="ai-citation-chip" data-ai-citation-id="${escapeHtml(citation.id)}">${index + 1} · ${escapeHtml(citation.label)}</button>`).join('')}
    </div>`;
}

export function renderAiCitationDetail(citation, scope) {
    const source = citation?.sourceRef;
    const scopeParts = [scope?.customerScope, scope?.systemScope, scope?.qualifiedJob]
        .map((value) => text(value, 240)).filter(Boolean);
    const excerpt = text(citation?.excerpt, 500);
    return `<div class="ai-citation-detail-content">
        <p class="eyebrow mb-1">Evidence source</p>
        <h2 class="section-title mb-2">${escapeHtml(text(citation?.label, 240) || 'Evidence source')}</h2>
        <div class="ai-citation-detail-meta">
            <span>${escapeHtml(text(citation?.sourceType, 60) || 'evidence')}</span>
            <span>${escapeHtml(text(citation?.status, 40).replace(/[-_]/g, ' ') || 'unknown')}</span>
            <span>Observed ${escapeHtml(dateLabel(citation?.observedAt))}</span>
            ${scopeParts.length ? `<span>Scope: ${escapeHtml(scopeParts.join(' · '))}</span>` : ''}
        </div>
        ${citation?.reasons?.length ? `<p class="stat-note mb-2"><strong>Why this source:</strong> ${escapeHtml(citation.reasons.join(' · '))}</p>` : ''}
        ${excerpt
            ? `<p class="ai-citation-excerpt">${escapeHtml(excerpt)}</p>`
            : '<p class="stat-note mb-0">Source excerpt unavailable. The record may have been deleted or access may have changed.</p>'}
        ${source?.kind || source?.id || source?.locator
            ? `<p class="stat-note mb-0">Provenance: ${escapeHtml([source.kind, source.id, source.locator].filter(Boolean).join(' · '))}</p>`
            : '<p class="stat-note mb-0">Provenance unavailable.</p>'}
    </div>`;
}
