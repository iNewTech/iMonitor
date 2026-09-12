import { escapeHtml, formatTimestamp } from './formatters.js';

/**
 * Pure alert views. Context contains values for this render, never DOM nodes or callbacks.
 * @typedef {Object} AlertRenderContext
 * @property {string} operatorName
 * @property {Record<string, boolean>} [features]
 * @property {number} [recoveryPolls]
 * @property {Object} [view]
 * @property {boolean} [view.expanded]
 * @property {boolean} [view.focused]
 * @property {boolean} [view.timelineExpanded]
 * @property {boolean} [view.rechecking]
 * @property {boolean} [view.noteOpen]
 * @property {string} [view.noteDraft]
 */

export function formatWorkflowLabel(status) {
    const normalized = String(status || 'new').replace(/_/g, ' ');
    switch (normalized) {
        case 'work done':
            return 'WORK DONE';
        case 'system cleared':
            return 'SYSTEM CLEARED';
        default:
            return normalized.toUpperCase();
    }
}

export function getAlertConditionLabel(alert) {
    switch (alert?.kind) {
        case 'highCpu':
            return 'High CPU';
        case 'messageWait':
            return 'MSGW';
        case 'lockWait':
            return 'LCKW';
        case 'dequeueWait':
            return 'DEQW';
        case 'delayWait':
            return 'DLYW';
        case 'failedPoll':
        case 'pollFailure':
            return 'Poll issue';
        case 'disconnect':
            return 'Disconnect';
        default:
            return alert?.severity === 'critical' ? 'Critical' : 'Needs review';
    }
}

export function getAlertOwner(alert) {
    return String(alert?.owner || '').trim();
}

export function isOwnedByCurrentOperator(alert, operatorName) {
    return Boolean(getAlertOwner(alert)) && getAlertOwner(alert) === operatorName;
}

export function isClaimedAlert(alert) {
    return String(alert?.workflowStatus || '') === 'claimed';
}

function isOwnedWorkAlert(alert, operatorName) {
    const status = String(alert?.workflowStatus || '');
    return isOwnedByCurrentOperator(alert, operatorName) && (status === 'claimed' || status === 'work_done');
}

function premiumControl(features, label, feature, className, attributes = '') {
    const available = features?.[feature] !== false;
    return `<button class="btn btn-outline-ink btn-sm ${className}${available ? '' : ' premium-locked'}" ${available ? '' : 'disabled'} ${attributes}>${available ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}${label}</button>`;
}

function premiumIntegrationControl(features, label, feature, className, attributes = '') {
    const available = features?.[feature] !== false;
    return `<button class="btn btn-outline-ink btn-sm ${className}${available ? '' : ' premium-locked'}" ${available ? '' : 'disabled'} ${attributes}>${available ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}${label} <small class="premium-inline-label"><i class="bi bi-lock-fill" aria-hidden="true"></i>Premium</small></button>`;
}

function formatEvidenceStatus(status) {
    return String(status || 'unavailable').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildIncidentEvidenceMarkup(alert) {
    const evidence = alert?.evidence;
    if (!evidence) {
        return '<p class="alert-evidence-pending" data-testid="incident-evidence-pending">Capturing trigger evidence…</p>';
    }

    const sources = [
        ['Trigger', evidence.trigger],
        ['Job', evidence.job],
        ['Job log', evidence.jobLog],
        ['Messages', evidence.messages],
        ['Queue', evidence.queue],
        ['Subsystem', evidence.subsystem]
    ];
    const details = sources
        .filter(([, snapshot]) => snapshot?.detail)
        .map(([label, snapshot]) => `<span>${escapeHtml(label)}: ${escapeHtml(snapshot.detail)}</span>`)
        .join('');

    return `
        <div class="alert-evidence-shell" data-testid="incident-evidence">
            <div class="alert-evidence-header">
                <strong>Captured evidence</strong>
                <span>${formatTimestamp(evidence.capturedAt)} · ${escapeHtml(evidence.source === 'demo' ? 'Demo' : 'IBM i')}</span>
            </div>
            <div class="alert-evidence-grid">
                ${sources.map(([label, snapshot]) => `
                    <span class="alert-evidence-item is-${escapeHtml(snapshot?.status || 'unavailable')}" title="${escapeHtml(snapshot?.detail || formatEvidenceStatus(snapshot?.status))}">
                        <strong>${escapeHtml(label)}</strong>
                        <small>${escapeHtml(formatEvidenceStatus(snapshot?.status))} · ${Number(snapshot?.recordCount || 0)} record${Number(snapshot?.recordCount || 0) === 1 ? '' : 's'}</small>
                    </span>
                `).join('')}
            </div>
            ${details ? `<div class="alert-evidence-details">${details}</div>` : ''}
        </div>
    `;
}

function buildPriorityBadge(alert) {
    const priority = alert?.correlation?.priority;
    if (!priority || !Number.isFinite(Number(priority.score))) {
        return '';
    }

    const reasons = Array.isArray(priority.reasons) ? priority.reasons.join(' ') : 'Priority based on current technical evidence.';
    return `<span class="activity-log-badge is-priority is-${escapeHtml(priority.band)}" title="${escapeHtml(reasons)}">P${escapeHtml(String(priority.score))} · ${escapeHtml(priority.band)}</span>`;
}

function buildCorrelationMarkup(alert) {
    const correlation = alert?.correlation;
    if (!correlation) {
        return '';
    }

    const priority = correlation.priority;
    const reasons = Array.isArray(priority?.reasons) ? priority.reasons.slice(0, 3).join(' ') : '';
    const signals = Array.isArray(correlation.relatedSignals) ? correlation.relatedSignals.join(' + ') : '';
    return `
        <div class="alert-correlation-summary" data-testid="incident-correlation-summary">
            <div><strong>${correlation.suggested ? 'Suggested grouping' : 'Correlated incident'}</strong>${signals ? ` <span>· ${escapeHtml(signals)}</span>` : ''}</div>
            <p>${escapeHtml(correlation.groupReason)}</p>
            ${reasons ? `<small>Priority ${escapeHtml(String(priority.score))}/100: ${escapeHtml(reasons)}</small>` : ''}
        </div>
    `;
}

/** @param {AlertRenderContext} context */
export function buildAlertMarkup(alert, { operatorName, features, recoveryPolls, view = {} }) {
    const isExpanded = Boolean(view.expanded);
    const isFocused = Boolean(view.focused);
    const workflowLabel = formatWorkflowLabel(alert.workflowStatus);
    const owner = getAlertOwner(alert);
    const ownedByCurrentOperator = isOwnedByCurrentOperator(alert, operatorName);
    const claimedByAnotherOperator = isClaimedAlert(alert) && Boolean(owner) && !ownedByCurrentOperator;
    const resolutionLabel = alert.resolutionSource === 'manual_recheck'
        ? 'RESOLVED · RECHECK'
        : 'RESOLVED · AUTO';
    const stateMarkup = alert.isActive === false
        ? `<span class="activity-log-badge">${resolutionLabel} ${formatTimestamp(alert.resolvedAt || alert.timestamp)}</span>`
        : '<span class="activity-log-badge">ACTIVE</span>';
    const recoveryMarkup = alert.kind === 'highCpu' && alert.isActive !== false && Number(alert.recoveryPollCount || 0) > 0
        ? `<p class="alert-recovery-progress"><i class="bi bi-activity me-1"></i>Recovery check ${Number(alert.recoveryPollCount)} of ${recoveryPolls} healthy polls</p>`
        : '';
    const ownerMarkup = owner
        ? `<p class="alert-owner">${isClaimedAlert(alert) ? 'Working owner' : 'Assigned to'}: ${escapeHtml(owner)}</p>`
        : '';
    const timelineEntries = Array.isArray(alert.timeline) ? alert.timeline : [];
    const isTimelineExpanded = view.timelineExpanded;
    const timelineMarkup = timelineEntries.length
        ? `
            <div class="alert-history-shell">
                <div class="alert-history-header">
                    <h4 class="alert-history-title">Incident history</h4>
                    <p class="alert-history-copy">Operator actions and alert events for this incident.</p>
                </div>
                <div class="alert-timeline" data-testid="alert-timeline">
                    ${timelineEntries.slice(0, isTimelineExpanded ? timelineEntries.length : 4).map((entry) => `
                        <div class="alert-timeline-entry">
                            <strong>${escapeHtml(entry.label)}</strong>
                            <span>${formatTimestamp(entry.timestamp)}</span>
                            ${entry.actor ? `<p>Operator: ${escapeHtml(entry.actor)}</p>` : ''}
                            ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ''}
                        </div>
                    `).join('')}
                </div>
                ${timelineEntries.length > 4 ? `
                    <button class="btn btn-outline-ink btn-sm alert-history-toggle" type="button" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-history-toggle">
                        <i class="bi bi-clock-history me-1" aria-hidden="true"></i>${isTimelineExpanded ? 'Show less history' : `Show all history (${timelineEntries.length})`}
                    </button>
                ` : ''}
            </div>
        `
        : '';
    const openJobButton = alert.jobName
        ? `
            <button class="btn btn-outline-ink btn-sm alert-open-job" data-job-name="${escapeHtml(alert.jobName)}" data-testid="alert-open-job">
                Open Job
            </button>
        `
        : '';
    const acknowledgeButton = alert.workflowStatus === 'new'
        ? `
            <button class="btn btn-outline-ink btn-sm alert-acknowledge" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-acknowledge">
                Acknowledge
            </button>
        `
        : '';
    const claimButton = alert.isActive !== false && !claimedByAnotherOperator && !isClaimedAlert(alert)
        ? `
            <button class="btn btn-outline-ink btn-sm alert-claim" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-claim">
                Start Work
            </button>
        `
        : '';
    const releaseButton = isOwnedWorkAlert(alert, operatorName)
        ? `
            <button class="btn btn-outline-ink btn-sm alert-release" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-release">
                Return To Queue
            </button>
        `
        : '';
    const workDoneButton = ownedByCurrentOperator && isClaimedAlert(alert)
        ? `
            <button class="btn btn-outline-ink btn-sm alert-work-done" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-work-done">
                Mark Work Done
            </button>
        `
        : '';
    const noteButton = `
        <button class="btn btn-outline-ink btn-sm alert-note-action" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-note-toggle"${claimedByAnotherOperator ? ` disabled title="Claimed by ${escapeHtml(owner)}"` : ''}>
            Add Note
        </button>
    `;
    const aiAvailable = features?.['ai-analysis'] !== false;
    const explainButton = premiumControl(
        features,
        `${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : ''}Explain Alert`,
        'ai-analysis',
        'alert-ai-button alert-ai-explain',
        `data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-ai-explain" title="${aiAvailable ? 'Explain this alert with IBMEye AI' : 'IBMEye AI requires Premium'}"`
    );
    const nextActionsButton = premiumControl(
        features,
        `${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : ''}Next Best Action`,
        'ai-analysis',
        'alert-ai-button alert-ai-next-actions',
        `data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-ai-next-actions" title="${aiAvailable ? 'Get the next best action with IBMEye AI' : 'IBMEye AI requires Premium'}"`
    );
    const clickUpButton = alert.clickUpTask?.id
        ? premiumIntegrationControl(
            features,
            'Open ClickUp Task',
            'clickup-integration',
            'alert-clickup-open',
            `data-task-url="${escapeHtml(alert.clickUpTask.url || '')}" data-testid="alert-clickup-open" title="${features?.['clickup-integration'] !== false ? 'Open linked ClickUp task' : 'ClickUp integration requires Premium'}"`
        )
        : '';
    const recheckButton = alert.isActive !== false
        ? `
            <button class="btn btn-outline-ink btn-sm alert-recheck" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-recheck"${view.rechecking ? ' disabled' : ''}>
                <i class="bi bi-arrow-repeat me-1"></i>${view.rechecking ? 'Checking...' : 'Recheck'}
            </button>
        `
        : '';
    const noteComposerMarkup = view.noteOpen
        ? `
            <div class="alert-note-composer" data-testid="alert-note-composer">
                <label class="alert-note-label" for="alert-note-${escapeHtml(alert.id)}">Operator note</label>
                <textarea
                    id="alert-note-${escapeHtml(alert.id)}"
                    class="form-control alert-note-input"
                    data-alert-id="${escapeHtml(alert.id)}"
                    data-testid="alert-note-input"
                    rows="3"
                    placeholder="Describe what you checked, who owns it, or the next step."
                >${escapeHtml(view.noteDraft || '')}</textarea>
                <div class="alert-note-actions">
                    <button class="btn btn-primary-strong btn-sm alert-note-save" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-note-save">
                        Save Note
                    </button>
                    <button class="btn btn-outline-ink btn-sm alert-note-cancel" data-alert-id="${escapeHtml(alert.id)}">
                        Cancel
                    </button>
                </div>
            </div>
        `
        : '';
    const summaryLabel = alert.jobName || alert.message;

    return `
        <article
            class="alert-entry is-${escapeHtml(alert.severity)}${alert.isActive === false ? ' is-resolved' : ''}${isFocused ? ' is-focused' : ''}"
            data-testid="${isFocused ? 'focus-alert-card' : 'alert-card'}"
            data-alert-id="${escapeHtml(alert.id)}"
        >
            <button class="alert-toggle" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
                <div class="alert-toggle-main">
                    <div class="activity-log-meta">
                        <div class="activity-log-tags">
                            ${stateMarkup}
                            <span class="activity-log-badge is-area" data-testid="alert-workflow-badge">${escapeHtml(workflowLabel)}</span>
                            <span class="activity-log-badge">${escapeHtml(alert.severity.toUpperCase())}</span>
                            <span class="activity-log-badge is-area">${escapeHtml(alert.kind.toUpperCase())}</span>
                            ${buildPriorityBadge(alert)}
                        </div>
                        <time class="activity-log-time">${formatTimestamp(alert.timestamp)}</time>
                    </div>
                    <h3 class="activity-log-message">${escapeHtml(alert.title)}</h3>
                    <p class="activity-log-detail">${escapeHtml(summaryLabel)}</p>
                </div>
                <span class="alert-toggle-icon" aria-hidden="true">${isExpanded ? '−' : '+'}</span>
            </button>
            ${isExpanded ? `
                <div class="alert-body" data-testid="alert-body">
                    <p class="activity-log-detail">${escapeHtml(alert.message)}</p>
                    ${alert.detail ? `<p class="activity-log-detail">${escapeHtml(alert.detail)}</p>` : ''}
                    ${recoveryMarkup}
                    ${ownerMarkup}
                    ${buildCorrelationMarkup(alert)}
                    ${buildIncidentEvidenceMarkup(alert)}
                    ${timelineMarkup}
                    ${noteComposerMarkup}
                    <div class="alert-actions">
                        ${acknowledgeButton}
                        ${claimButton}
                        ${releaseButton}
                        ${workDoneButton}
                        ${noteButton}
                        ${explainButton}
                        ${nextActionsButton}
                        ${clickUpButton}
                        ${recheckButton}
                        ${openJobButton}
                    </div>
                </div>
            ` : ''}
        </article>
    `;
}

/** @param {AlertRenderContext} context */
export function buildDetailIncidentActionsMarkup(alert, { operatorName, features }) {
    if (!alert) {
        return `
            <span class="job-task-empty-action">
                No incident is linked to this job. Use technical actions only when needed.
            </span>
        `;
    }

    const owner = getAlertOwner(alert);
    const ownedByCurrentOperator = isOwnedByCurrentOperator(alert, operatorName);
    const claimedByAnotherOperator = isClaimedAlert(alert) && Boolean(owner) && !ownedByCurrentOperator;
    const aiAvailable = features?.['ai-analysis'] !== false;
    const clickUpAvailable = features?.['clickup-integration'] !== false;
    const actionButtons = [];

    if (alert.workflowStatus === 'new') {
        actionButtons.push(`
            <button type="button" class="btn btn-outline-ink btn-sm detail-alert-action" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.id)}">
                Acknowledge
            </button>
        `);
    }

    if (alert.isActive !== false && !claimedByAnotherOperator && !isClaimedAlert(alert)) {
        actionButtons.push(`
            <button type="button" class="btn btn-primary-strong btn-sm detail-alert-action" data-alert-action="claim" data-alert-id="${escapeHtml(alert.id)}">
                Claim Work
            </button>
        `);
    }

    if (isOwnedWorkAlert(alert, operatorName)) {
        actionButtons.push(`
            <button type="button" class="btn btn-outline-ink btn-sm detail-alert-action" data-alert-action="release" data-alert-id="${escapeHtml(alert.id)}">
                Remove Claim
            </button>
        `);
    }

    if (ownedByCurrentOperator && isClaimedAlert(alert)) {
        actionButtons.push(`
            <button type="button" class="btn btn-outline-ink btn-sm detail-alert-action" data-alert-action="workDone" data-alert-id="${escapeHtml(alert.id)}">
                Mark Work Done
            </button>
        `);
    }

    actionButtons.push(`
        <button type="button" class="btn btn-outline-ink btn-sm detail-alert-ai${aiAvailable ? '' : ' premium-locked'}" data-ai-action="explain" data-alert-id="${escapeHtml(alert.id)}" ${aiAvailable ? '' : 'disabled'}>
            ${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}Explain Issue
        </button>
    `);

    actionButtons.push(`
        <button type="button" class="btn btn-outline-ink btn-sm detail-alert-ai${aiAvailable ? '' : ' premium-locked'}" data-ai-action="resolve" data-alert-id="${escapeHtml(alert.id)}" ${aiAvailable ? '' : 'disabled'}>
            ${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}How To Resolve
        </button>
    `);

    if (alert.clickUpTask?.url) {
        actionButtons.push(`
            <button type="button" class="btn btn-outline-ink btn-sm detail-clickup-open${clickUpAvailable ? '' : ' premium-locked'}" data-task-url="${escapeHtml(alert.clickUpTask.url)}" ${clickUpAvailable ? '' : 'disabled'}>
                ${clickUpAvailable ? '<i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}Open ClickUp
            </button>
        `);
    }

    const ownerMarkup = owner
        ? `<span class="job-task-owner">Owner: ${escapeHtml(owner)}</span>`
        : '<span class="job-task-owner">Unassigned</span>';
    const priorityMarkup = buildPriorityBadge(alert);
    const correlationMarkup = buildCorrelationMarkup(alert);

    return `
        <div class="job-task-action-summary">
            <span class="job-incident-chip">${escapeHtml(getAlertConditionLabel(alert))}</span>
            <span class="activity-log-badge is-area">${escapeHtml(formatWorkflowLabel(alert.workflowStatus))}</span>
            ${priorityMarkup}
            ${ownerMarkup}
        </div>
        ${correlationMarkup}
        <div class="job-task-action-row">
            ${actionButtons.join('')}
        </div>
        ${claimedByAnotherOperator ? `<p class="stat-note mb-0">Claimed by ${escapeHtml(owner)}. Ask them to release it before taking ownership.</p>` : ''}
    `;
}
