import { escapeHtml, formatTimestamp } from './formatters.js';

export function renderStatusHistory(detailStatusHistory, entries) {
    if (!detailStatusHistory) {
        return;
    }

    if (!entries.length) {
        detailStatusHistory.innerHTML = `
            <div class="status-history-empty">No status changes recorded yet.</div>
        `;
        return;
    }

    detailStatusHistory.innerHTML = entries.slice().reverse().map((entry) => `
        <article class="status-history-item">
            <span class="status-history-status">${escapeHtml(entry.status)}</span>
            <span class="status-history-label">${escapeHtml(entry.label)}</span>
            <time class="status-history-time">${formatTimestamp(entry.timestamp)}</time>
        </article>
    `).join('');
}

export function renderRootCauseGuidance(elements, guidance) {
    if (elements.detailGuidanceHeadline) {
        elements.detailGuidanceHeadline.textContent = guidance?.headline || 'No guidance yet';
    }
    if (elements.detailGuidanceSeverity) {
        elements.detailGuidanceSeverity.textContent = guidance?.severity || 'info';
    }
    if (elements.detailGuidanceImpact) {
        elements.detailGuidanceImpact.textContent = guidance?.impact || '-';
    }
    if (elements.detailGuidanceCause) {
        elements.detailGuidanceCause.textContent = guidance?.likelyCause || '-';
    }
    if (elements.detailGuidanceTechnical) {
        elements.detailGuidanceTechnical.textContent = guidance?.technicalSummary || '-';
    }
    if (elements.detailGuidanceSteps) {
        const steps = Array.isArray(guidance?.nextSteps) ? guidance.nextSteps : [];
        elements.detailGuidanceSteps.innerHTML = steps.length
            ? steps.map((step) => `
                <article class="status-history-item">
                    <span class="status-history-status">Next Step</span>
                    <span class="status-history-label">${escapeHtml(step)}</span>
                </article>
            `).join('')
            : '<div class="status-history-empty">No next steps available.</div>';
    }
}

export function renderOperatorActions(detailOperatorActions, detailOperatorActionNote, actions) {
    if (!detailOperatorActions) {
        return;
    }

    const availableActions = Array.isArray(actions) ? actions : [];
    detailOperatorActions.innerHTML = availableActions.map((action) => `
        <button
            class="btn ${action.dangerous ? 'btn-soft-danger' : 'btn-outline-ink'} btn-sm job-action-button"
            data-action-kind="${escapeHtml(action.kind)}"
            ${action.enabled ? '' : 'disabled'}
            title="${escapeHtml(action.reason || action.label)}"
        >
            ${action.enabled ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'} ${escapeHtml(action.label)}
        </button>
    `).join('');

    if (detailOperatorActionNote) {
        const blockedActions = availableActions.filter((action) => !action.enabled && action.reason);
        detailOperatorActionNote.textContent = blockedActions.length
            ? blockedActions.map((action) => `${action.label}: ${action.reason}`).join(' | ')
            : 'These actions run from the current job detail drawer and are recorded in the Operator Log.';
    }
}
