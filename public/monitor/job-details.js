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
    detailOperatorActions.innerHTML = availableActions.map((action) => {
        const premiumLocked = !action.enabled && /requires Premium/i.test(String(action.reason || ''));
        return `
        <button
            class="btn ${action.dangerous ? 'btn-soft-danger' : 'btn-outline-ink'} btn-sm job-action-button"
            data-action-kind="${escapeHtml(action.kind)}"
            ${action.enabled ? '' : 'disabled'}
            title="${escapeHtml(action.reason || action.label)}"
        >
            ${action.enabled ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'} ${escapeHtml(action.label)}${premiumLocked ? ' <small class="premium-inline-label"><i class="bi bi-lock-fill" aria-hidden="true"></i>Premium</small>' : ''}
        </button>
        `;
    }).join('');

    if (detailOperatorActionNote) {
        const blockedActions = availableActions.filter((action) => !action.enabled && action.reason);
        detailOperatorActionNote.textContent = blockedActions.length
            ? blockedActions.map((action) => `${action.label}: ${action.reason}`).join(' | ')
            : 'These actions run from the current job detail drawer and are included in encrypted support diagnostics.';
    }
}

export function renderJobContext(output, context) {
    if (!output) {
        return;
    }

    const sections = [
        ['Job properties', context?.jobInfo],
        ['Job queue properties', context?.jobQueue],
        ['Subsystem properties', context?.subsystem]
    ];
    const availableSections = sections.filter(([, value]) => value && typeof value === 'object');

    output.innerHTML = availableSections.length
        ? availableSections.map(([label, value]) => `
            <section class="on-demand-record-group">
                <h4>${escapeHtml(label)}</h4>
                <dl class="on-demand-properties">
                    ${Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '').map(([key, entry]) => `
                        <div><dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${escapeHtml(entry)}</dd></div>
                    `).join('')}
                </dl>
            </section>
        `).join('')
        : '<div class="status-history-empty">No additional IBM i context was returned.</div>';
}

export function renderJobMessages(output, records, emptyMessage = 'No job messages returned.') {
    renderOnDemandRecords(output, records, emptyMessage, 'Job messages');
}

export function renderJobLog(output, records, emptyMessage = 'No job log entries returned.') {
    renderOnDemandRecords(output, records, emptyMessage, 'Recent job log');
}

function renderOnDemandRecords(output, records, emptyMessage, heading) {
    if (!output) {
        return;
    }

    const entries = Array.isArray(records) ? records : [];
    output.innerHTML = `
        <section class="on-demand-record-group">
            <h4>${escapeHtml(heading)} <span>${entries.length}</span></h4>
            ${entries.length
                ? `<div class="on-demand-record-list">${entries.map((record) => `
                    <article class="on-demand-record">
                        <time>${formatTimestamp(record.MESSAGE_TIMESTAMP)}</time>
                        <strong>${escapeHtml(record.MESSAGE_TYPE || 'MESSAGE')}${record.MESSAGE_ID ? ` · ${escapeHtml(record.MESSAGE_ID)}` : ''}</strong>
                        <p>${escapeHtml(record.MESSAGE_TEXT || 'No message text.')}</p>
                        ${record.MESSAGE_SECOND_LEVEL_TEXT ? `<p class="on-demand-record-detail">${escapeHtml(record.MESSAGE_SECOND_LEVEL_TEXT)}</p>` : ''}
                    </article>
                `).join('')}</div>`
                : `<p class="status-history-empty">${escapeHtml(emptyMessage)}</p>`}
        </section>
    `;
}
