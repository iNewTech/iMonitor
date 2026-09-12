import { escapeHtml, formatTimestamp, formatCpuValue, formatNumber, formatMegabytes, createActionRequestId } from './monitor/formatters.js';
import {
    renderJobLog,
    renderJobMessages,
    renderOperatorActions,
    renderStatusHistory
} from './monitor/job-details.js';
import {
    buildAlertExplanationPrompt,
    buildAlertNextActionsPrompt,
    buildSelectedJobHealthPrompt
} from './monitor/ibmeyeai/action-prompts.js';
import { renderAiReportMarkdown } from './monitor/ibmeyeai/render.js';

const params = new URLSearchParams(window.location.search);
const selectedJobName = params.get('jobName') || '';

let latestPayload = null;
let latestAlerts = [];
let currentOperatorName = 'local-operator';
const pending = new Set();
let refreshPromise = null;
let stateRevision = 0;
let alertsRevision = 0;
let stateFresh = false;
let actionFeedback = '';


const $ = (id) => document.getElementById(id);
const title = $('task-title');
const subtitle = $('task-subtitle');
const syncState = $('task-sync-state');
const empty = $('task-empty');
const content = $('task-content');
const issueTitle = $('task-issue-title');
const issueState = $('task-issue-state');
const issueSummary = $('task-issue-summary');
const issueHistory = $('task-issue-history');
const incidentHistory = $('task-incident-history');
const workflowNote = $('task-workflow-note');
const qualifiedJob = $('task-qualified-job');
const subsystem = $('task-subsystem');
const user = $('task-user');
const status = $('task-status');
const cpu = $('task-cpu');
const threads = $('task-threads');
const waitReason = $('task-wait-reason');
const tempStorage = $('task-temp-storage');
const diskIo = $('task-disk-io');
const incidentActions = $('task-incident-actions');
const jobActions = $('task-job-actions');
const actionNote = $('task-action-note');
const statusHistory = $('task-status-history');
const aiOutput = $('task-ai-output');
const aiStatus = $('task-ai-status');
const aiContent = $('task-ai-content');
const detailsOutput = $('task-details-output');
const handoffFields = {
    recipient: $('task-handoff-recipient'),
    responseTarget: $('task-handoff-response-target'),
    reason: $('task-handoff-reason'),
    pendingChecks: $('task-handoff-pending-checks')
};
let handoffDraftKey = '';

function getJobKey(job) {
    return String(job?.JOB_NAME || job?.SUBSYSTEM_JOB || '').trim();
}

function formatWorkflowLabel(statusValue) {
    const statusText = String(statusValue || 'new');
    if (statusText === 'work_done') {
        return 'Work done';
    }
    return statusText.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAlertOwner(alert) {
    return String(alert?.owner || '').trim();
}

function isClaimedAlert(alert) {
    return String(alert?.workflowStatus || '') === 'claimed';
}

function isOwnedByCurrentOperator(alert) {
    return Boolean(getAlertOwner(alert)) && getAlertOwner(alert) === currentOperatorName;
}

function isOwnedWorkAlert(alert) {
    const workflowStatus = String(alert?.workflowStatus || '');
    return isOwnedByCurrentOperator(alert) && (workflowStatus === 'claimed' || workflowStatus === 'work_done');
}

function getAlertConditionLabel(alert) {
    const kind = String(alert?.kind || '');
    if (kind === 'highCpu') return 'High CPU';
    if (kind === 'messageWait') return 'MSGW';
    if (kind === 'lockWait') return 'LCKW';
    if (kind === 'delayWait') return 'DLYW';
    if (kind === 'dequeueWait') return 'DEQW';
    if (kind === 'pollFailure') return 'Poll issue';
    return kind || 'Issue';
}

function getAlertPriorityScore(alert) {
    const score = Number(alert?.correlation?.priority?.score);
    return Number.isFinite(score) ? score : alert?.severity === 'critical' ? 65 : 35;
}

function findLinkedAlert() {
    return latestAlerts
        .filter((alert) => alert?.jobName === selectedJobName && alert?.isActive !== false)
        .sort((left, right) => getAlertPriorityScore(right) - getAlertPriorityScore(left))[0]
        || latestAlerts.find((alert) => alert?.jobName === selectedJobName)
        || null;
}

function buildPriorityMarkup(alert) {
    const priority = alert?.correlation?.priority;
    if (!priority || !Number.isFinite(Number(priority.score))) return '';
    const reasons = Array.isArray(priority.reasons) ? priority.reasons.join(' ') : 'Priority based on current technical evidence.';
    return `<span class="activity-log-badge is-priority is-${escapeHtml(priority.band)}" title="${escapeHtml(reasons)}">P${escapeHtml(String(priority.score))} · ${escapeHtml(priority.band)}</span>`;
}

function buildCorrelationMarkup(alert) {
    const correlation = alert?.correlation;
    if (!correlation) return '';
    const signals = Array.isArray(correlation.relatedSignals) ? correlation.relatedSignals.join(' + ') : '';
    const reasons = Array.isArray(correlation.priority?.reasons)
        ? correlation.priority.reasons.slice(0, 3).join(' ')
        : '';
    return `
        <div class="alert-correlation-summary" data-testid="incident-correlation-summary">
            <div><strong>${correlation.suggested ? 'Suggested grouping' : 'Correlated incident'}</strong>${signals ? ` <span>· ${escapeHtml(signals)}</span>` : ''}</div>
            <p>${escapeHtml(correlation.groupReason)}</p>
            ${reasons ? `<small>Priority ${escapeHtml(String(correlation.priority.score))}/100: ${escapeHtml(reasons)}</small>` : ''}
        </div>
    `;
}

function toLocalDateTimeValue(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function toIsoDateTimeValue(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function renderIncidentEvidence(alert) {
    const target = $('task-incident-evidence');
    if (!target) return;

    const evidence = alert?.evidence;
    if (!evidence) {
        target.innerHTML = '<p class="stat-note mb-0">Capturing trigger evidence…</p>';
        return;
    }

    const sources = [
        ['Trigger', evidence.trigger],
        ['Job log', evidence.jobLog],
        ['Messages', evidence.messages],
        ['Queue', evidence.queue],
        ['Subsystem', evidence.subsystem]
    ];
    target.innerHTML = `
        <div class="alert-evidence-shell" data-testid="task-evidence-captured">
            <div class="alert-evidence-header">
                <strong>Trigger evidence</strong>
                <span>${formatTimestamp(evidence.capturedAt)} · ${escapeHtml(evidence.source === 'demo' ? 'Demo' : 'IBM i')}</span>
            </div>
            <div class="alert-evidence-grid">
                ${sources.map(([label, snapshot]) => `
                    <span class="alert-evidence-item is-${escapeHtml(snapshot?.status || 'unavailable')}">
                        <strong>${escapeHtml(label)}</strong>
                        <small>${escapeHtml(String(snapshot?.status || 'unavailable').replace(/-/g, ' '))} · ${Number(snapshot?.recordCount || 0)}</small>
                    </span>
                `).join('')}
            </div>
        </div>
    `;
}

function setTab(tabName) {
    document.querySelectorAll('[data-task-tab]').forEach((button) => {
        const selected = button.dataset.taskTab === tabName;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-task-panel]').forEach((panel) => {
        const selected = panel.dataset.taskPanel === tabName;
        panel.classList.toggle('is-active', selected);
        panel.hidden = !selected;
    });
}

function renderIncidentActions(alert) {
    if (!incidentActions) {
        return;
    }
    if (!alert) {
        incidentActions.innerHTML = '<span class="job-task-empty-action">No linked incident for this job.</span>';
        return;
    }

    const owner = getAlertOwner(alert);
    const ownedByCurrentOperator = isOwnedByCurrentOperator(alert);
    const claimedByAnotherOperator = isClaimedAlert(alert) && owner && !ownedByCurrentOperator;
    const buttons = [];

    if (alert.workflowStatus === 'new') {
        buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-alert-action" data-action="acknowledge">Acknowledge</button>`);
    }
    if (alert.isActive !== false && !claimedByAnotherOperator && !isClaimedAlert(alert)) {
        buttons.push(`<button type="button" class="btn btn-primary-strong btn-sm task-alert-action" data-action="claim">Claim Work</button>`);
    }
    if (isOwnedWorkAlert(alert)) {
        buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-alert-action" data-action="release">Remove Claim</button>`);
    }
    if (ownedByCurrentOperator && isClaimedAlert(alert)) {
        buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-alert-action" data-action="workDone">Mark Work Done</button>`);
    }
    buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-alert-ai" data-ai-action="explain"><img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">Explain Issue</button>`);
    buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-alert-ai" data-ai-action="resolve"><img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">How To Resolve</button>`);
    if (alert.clickUpTask?.url) {
        buttons.push(`<button type="button" class="btn btn-outline-ink btn-sm task-clickup-open" data-task-url="${escapeHtml(alert.clickUpTask.url)}"><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>Open ClickUp</button>`);
    }

    incidentActions.innerHTML = `
        <div class="job-task-action-summary">
            <span class="job-incident-chip">${escapeHtml(getAlertConditionLabel(alert))}</span>
            <span class="activity-log-badge is-area">${escapeHtml(formatWorkflowLabel(alert.workflowStatus))}</span>
            ${buildPriorityMarkup(alert)}
            <span class="job-task-owner">${owner ? `Owner: ${escapeHtml(owner)}` : 'Unassigned'}</span>
        </div>
        ${buildCorrelationMarkup(alert)}
        <div class="job-task-action-row">${buttons.join('')}</div>
        ${claimedByAnotherOperator ? `<p class="stat-note mb-0">Claimed by ${escapeHtml(owner)}.</p>` : ''}
    `;
}

function fallbackResponseSnapshot(job, alert) {
    const jobLabel = String(job?.JOB_NAME || job?.SUBSYSTEM_JOB || selectedJobName);
    const evidence = [
        ['Trigger', alert?.evidence?.trigger],
        ['Job log', alert?.evidence?.jobLog],
        ['Messages', alert?.evidence?.messages],
        ['Queue', alert?.evidence?.queue],
        ['Subsystem', alert?.evidence?.subsystem]
    ].map(([label, snapshot]) => ({
        label,
        status: snapshot?.status || 'unavailable',
        recordCount: Number(snapshot?.recordCount || 0)
    }));
    return {
        jobName: jobLabel,
        incidentKey: alert?.incidentId || alert?.id || `job:${jobLabel}`,
        incidentTitle: alert?.title || 'No linked incident',
        step: alert?.workflowStatus === 'claimed' ? 'investigate' : alert?.workflowStatus === 'work_done' ? 'resolve' : 'respond',
        impactLabel: alert?.severity === 'critical' || ['MSGW', 'LCKW', 'DEQW'].includes(job?.STATUS) ? 'Critical' : alert ? 'High' : 'Normal',
        impactSummary: alert?.message || 'No linked incident for this job.',
        owner: alert?.owner || 'Unassigned',
        status: alert?.workflowStatus || 'clear',
        nextCheck: 'Confirm the current job state on the next poll.',
        evidence,
        completedChecks: ['No operator checks recorded yet.'],
        unsuccessfulAttempts: ['No unsuccessful attempts recorded.'],
        unresolvedQuestions: ['Is there an operator-impacting condition outside the current alert rules?'],
        escalationReason: 'Escalation is optional; continue monitoring this job until an incident is linked.',
        businessImpact: {
            mapped: false,
            deadlineState: 'not_configured',
            scheduleState: 'not_configured',
            summary: 'Business impact is unknown until a customer mapping matches this job.'
        }
    };
}

function renderResponseWorkspace(response) {
    const snapshot = response || fallbackResponseSnapshot(latestPayload?.job, findLinkedAlert());
    const alert = findLinkedAlert();
    const handoff = snapshot.handoff || alert?.handoff;
    const activeStep = snapshot.step || 'respond';
    ['respond', 'investigate', 'resolve'].forEach((step) => {
        const element = $(`task-response-step-${step}`);
        if (!element) return;
        const stepIndex = ['respond', 'investigate', 'resolve'].indexOf(step);
        const activeIndex = ['respond', 'investigate', 'resolve'].indexOf(activeStep);
        element.classList.toggle('is-active', step === activeStep);
        element.classList.toggle('is-complete', stepIndex < activeIndex);
        element.setAttribute('aria-current', step === activeStep ? 'step' : 'false');
    });
    $('task-response-impact').textContent = snapshot.impactLabel || 'Normal';
    $('task-response-impact').className = `response-impact is-${String(snapshot.impactLabel || 'normal').toLowerCase()}`;
    $('task-response-impact-summary').textContent = snapshot.impactSummary || '-';
    $('task-response-owner').textContent = snapshot.owner || 'Unassigned';
    $('task-response-status').textContent = formatWorkflowLabel(snapshot.status || 'clear');
    const businessImpact = snapshot.businessImpact;
    $('task-response-business').textContent = businessImpact?.serviceName || 'Unknown impact';
    $('task-response-business-summary').textContent = businessImpact?.summary || 'No customer mapping matched.';
    $('task-response-next-check').textContent = snapshot.nextCheck || '-';
    $('task-response-evidence').innerHTML = (snapshot.evidence || []).map((item) => (
        `<span class="response-evidence-item is-${escapeHtml(item.status || 'unavailable')}"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(String(item.status || 'unavailable').replace(/-/g, ' '))} · ${Number(item.recordCount || 0)}</small></span>`
    )).join('');
    const routing = snapshot.routing;
    const sla = routing?.sla;
    const slaLabel = sla?.state === 'overdue' ? 'Overdue' : sla?.state === 'at_risk' ? 'At risk' : 'On track';
    $('task-routing-summary').textContent = routing
        ? routing.recommendedOperator
            ? `Suggested owner: ${routing.recommendedOperator.displayName} · ${slaLabel} (${sla.minutesRemaining} min left). Claim still requires acceptance.`
            : `No eligible operator · ${slaLabel}. ${routing.escalationReasons?.[0] || 'Review routing and hand off manually.'}`
        : 'Routing recommendation unavailable.';

    const nextKey = `${snapshot.incidentKey}:${snapshot.status}:${handoff?.id || 'none'}:${handoff?.status || 'none'}`;
    if (nextKey !== handoffDraftKey) {
        handoffDraftKey = nextKey;
        handoffFields.recipient.value = handoff?.toOperator || '';
        handoffFields.responseTarget.value = toLocalDateTimeValue(handoff?.responseTargetAt);
        handoffFields.reason.value = handoff?.reason || '';
        handoffFields.pendingChecks.value = (handoff?.pendingChecks || []).join('\n');
    }
    $('task-handoff-state').textContent = handoff
        ? handoff.status === 'pending' ? `Pending · ${handoff.toOperator}` : `${formatWorkflowLabel(handoff.status)} · ${handoff.toOperator}`
        : 'No handoff';
}

function getHandoffDraft() {
    const value = (field) => field?.value.trim() || 'None recorded.';
    return {
        recipient: value(handoffFields.recipient),
        responseTargetAt: toIsoDateTimeValue(handoffFields.responseTarget.value),
        reason: value(handoffFields.reason),
        pendingChecks: handoffFields.pendingChecks.value.split('\n').map((line) => line.trim()).filter(Boolean)
    };
}

// The alert store supplies newest events first, including cleared incidents.
function renderIncidentHistory() {
    const alerts = latestAlerts.filter((alert) => alert?.jobName === selectedJobName);
    incidentHistory.innerHTML = alerts.length ? alerts.map((alert) => {
        const entries = Array.isArray(alert.timeline) ? alert.timeline : [];
        return `<section class="on-demand-record-group">
            <h3 class="h6 mb-2 text-break">${escapeHtml(alert.title || 'Incident')} · ${escapeHtml(formatWorkflowLabel(alert.workflowStatus))}</h3>
            ${entries.length ? `<ol class="alert-timeline list-unstyled mb-0">${entries.map((entry) => `
                <li class="alert-timeline-entry text-break">
                    <strong>${escapeHtml(entry.label || formatWorkflowLabel(entry.action))}</strong>
                    <time title="${escapeHtml(entry.timestamp)}">${formatTimestamp(entry.timestamp)}</time>
                    ${entry.actor ? `<p class="mb-0">Operator: ${escapeHtml(entry.actor)}</p>` : ''}
                    ${entry.detail ? `<p class="mb-0">${escapeHtml(entry.detail)}</p>` : ''}
                </li>`).join('')}</ol>` : '<p class="stat-note mb-0">No incident events recorded.</p>'}
        </section>`;
    }).join('') : '<p class="stat-note mb-0">No incident history for this job.</p>';
}

function renderTask() {
    const job = latestPayload?.job;
    const alert = findLinkedAlert();
    if (!job) {
        if (empty) {
            empty.hidden = false;
            empty.textContent = 'This job is no longer available. Refresh to check again.';
        }
        if (content) content.hidden = true;
        return;
    }

    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    if (title) title.textContent = job.SUBSYSTEM_JOB || getJobKey(job) || selectedJobName;
    if (subtitle) subtitle.textContent = `${job.TYPE || 'Unknown'} job for ${job.CURRENT_USER || 'unknown user'}`;
    if (qualifiedJob) qualifiedJob.textContent = job.JOB_NAME || selectedJobName;
    if (subsystem) subsystem.textContent = job.SUBSYSTEM || '-';
    if (user) user.textContent = job.CURRENT_USER || job.JOB_USER || '-';
    if (status) status.textContent = job.STATUS || '-';
    if (cpu) cpu.textContent = `${formatCpuValue(job.CPU)} | ${formatNumber(job.ELAPSED_CPU_TIME)} ms`;
    if (threads) threads.textContent = formatNumber(job.THREAD_COUNT);
    if (tempStorage) tempStorage.textContent = formatMegabytes(job.TEMPORARY_STORAGE);
    if (diskIo) diskIo.textContent = formatNumber(job.ELAPSED_TOTAL_DISK_IO_COUNT ?? job.TOTAL_DISK_IO_COUNT);
    if (waitReason) waitReason.textContent = latestPayload.waitReason || 'No wait reason available.';

    if (issueTitle) issueTitle.textContent = alert?.title || 'No linked incident';
    if (issueState) {
        issueState.textContent = alert
            ? `${String(alert.severity || 'warning').toUpperCase()} | ${formatWorkflowLabel(alert.workflowStatus)}`
            : 'Clear';
    }
    if (issueSummary) issueSummary.textContent = alert?.message || 'This job has no active incident linked.';
    if (issueHistory) {
        const timelineCount = Array.isArray(alert?.timeline) ? alert.timeline.length : 0;
        issueHistory.textContent = alert
            ? `${timelineCount} incident event${timelineCount === 1 ? '' : 's'} · See History for details.`
            : 'No incident history.';
    }
    renderIncidentEvidence(alert);

    renderResponseWorkspace(latestPayload.response);
    renderIncidentActions(alert);
    renderOperatorActions(jobActions, null, latestPayload.actions);
    if (!actionFeedback) {
        const blocked = (latestPayload.actions || []).filter((action) => !action.enabled && action.reason);
        actionNote.textContent = blocked.length
            ? blocked.map((action) => `${action.label}: ${action.reason}`).join(' | ')
            : 'Operations apply to this job. Changes require confirmation.';
    }
    renderIncidentHistory();
    renderStatusHistory(statusHistory, latestPayload.statusHistory || []);
    updateControls();
}

function errorMessage(error, fallback) {
    return error?.message || (typeof error === 'string' && error) || fallback;
}

function requireSuccess(result, fallback) {
    if (result?.success !== true) throw new Error(result?.error || fallback);
    return result;
}

function updateControls() {
    const mutationBlocked = pending.has('mutation') || !stateFresh || !latestPayload?.job;
    const alert = findLinkedAlert();
    const handoff = alert?.handoff;
    incidentActions.querySelectorAll('.task-alert-action').forEach((button) => {
        button.disabled = mutationBlocked;
    });
    jobActions.querySelectorAll('.job-action-button').forEach((button) => {
        const available = latestPayload?.actions?.find((action) => action.kind === button.dataset.actionKind);
        button.disabled = mutationBlocked || !available?.enabled;
    });
    document.querySelectorAll('.task-alert-ai, #task-ai-summary, #task-ai-resolve').forEach((button) => {
        button.disabled = pending.has('ai') || !stateFresh || !latestPayload?.job || !selectedJobName;
    });
    $('task-request-handoff').disabled = mutationBlocked
        || !alert
        || Boolean(alert.owner && !isOwnedByCurrentOperator(alert))
        || handoff?.status === 'pending';
    $('task-accept-handoff').disabled = mutationBlocked
        || handoff?.status !== 'pending'
        || handoff.toOperator?.toLowerCase() !== currentOperatorName.toLowerCase();
    document.querySelectorAll('#task-load-log, #task-load-messages, #task-load-graph').forEach((button) => {
        button.disabled = pending.has('details') || !selectedJobName;
    });
    incidentActions.querySelectorAll('.task-clickup-open').forEach((button) => {
        button.disabled = pending.has('external');
    });
    $('task-refresh').disabled = Boolean(refreshPromise) || pending.has('mutation') || !selectedJobName;
    aiOutput.setAttribute('aria-busy', String(pending.has('ai')));
    detailsOutput.setAttribute('aria-busy', String(pending.has('details')));
}

// Each group owns its output; refreshed buttons must retain the pending state.
async function runRequest(group, operation, onError) {
    if (pending.has(group)) return;
    pending.add(group);
    updateControls();
    try {
        await operation();
    } catch (error) {
        onError(error);
    } finally {
        pending.delete(group);
        updateControls();
    }
}

function loadTask() {
    if (refreshPromise) return refreshPromise;
    if (!selectedJobName) {
        empty.textContent = 'No job was selected.';
        syncState.textContent = 'No selection';
        updateControls();
        return Promise.resolve();
    }
    const revision = stateRevision;
    const alertVersion = alertsRevision;
    syncState.textContent = 'Syncing';
    // Settle the whole batch before allowing another refresh, even on rejection.
    refreshPromise = (async () => {
        const results = await Promise.allSettled([
            window.electronAPI.getJobDetails(selectedJobName),
            window.electronAPI.getActiveAlerts(),
            window.electronAPI.getAppFlags()
        ]);
        if (revision !== stateRevision) return;
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
        const [payload, alerts, flags] = results.map((result) => result.value);
        latestPayload = payload;
        // A pushed alert update is newer than the refresh's alert snapshot.
        if (alertVersion === alertsRevision) latestAlerts = Array.isArray(alerts) ? alerts : [];
        currentOperatorName = String(flags?.operatorName || '').trim() || 'local-operator';
        stateFresh = true;
        renderTask();
        syncState.innerHTML = `Updated ${formatTimestamp(new Date())}`;
    })().catch((error) => {
        if (revision !== stateRevision) return;
        stateFresh = false;
        syncState.textContent = 'Offline · Retry with Refresh';
        if (!latestPayload?.job) empty.textContent = errorMessage(error, 'Unable to load this job.');
    }).finally(() => {
        refreshPromise = null;
        updateControls();
    });
    updateControls();
    return refreshPromise;
}

// Invalidate pre-action evidence, then wait for it before fetching current state.
async function mutateTask(operation) {
    stateRevision += 1;
    try {
        await operation();
    } finally {
        await refreshPromise;
        await loadTask();
    }
}

function runWorkflow(action) {
    const alert = findLinkedAlert();
    if (!alert || !stateFresh) return;
    return runRequest('mutation', () => mutateTask(async () => {
        workflowNote.textContent = 'Updating incident…';
        requireSuccess(await window.electronAPI.updateAlertWorkflow({
            alertId: alert.id,
            action,
            owner: currentOperatorName,
            executionId: createActionRequestId('incident'),
            expectedUpdatedAt: alert.workflowUpdatedAt
        }), 'Incident update failed. Refresh and try again.');
        // The main workflow handler already creates/synchronizes linked tasks.
        workflowNote.textContent = 'Incident updated.';
    }), (error) => {
        workflowNote.textContent = errorMessage(error, 'Incident update failed.');
    });
}

function requestHandoff() {
    const alert = findLinkedAlert();
    if (!alert || !stateFresh) return;
    const draft = getHandoffDraft();
    if (!draft.recipient || draft.recipient === 'None recorded.') {
        $('task-handoff-routing-status').textContent = 'Choose a recipient first.';
        handoffFields.recipient.focus();
        return;
    }
    return runRequest('mutation', () => mutateTask(async () => {
        $('task-handoff-routing-status').textContent = 'Sending handoff…';
        const result = requireSuccess(await window.electronAPI.createIncidentHandoff({
            alertId: alert.id,
            toOperator: draft.recipient,
            reason: draft.reason === 'None recorded.' ? undefined : draft.reason,
            pendingChecks: draft.pendingChecks,
            responseTargetAt: draft.responseTargetAt,
            executionId: createActionRequestId('handoff'),
            expectedUpdatedAt: alert.workflowUpdatedAt
        }), 'Unable to send handoff. Refresh and try again.');
        $('task-handoff-routing-status').textContent = `Handoff sent to ${result.handoff?.toOperator || draft.recipient}.`;
    }), (error) => {
        $('task-handoff-routing-status').textContent = errorMessage(error, 'Unable to send handoff.');
    });
}

function acceptHandoff() {
    const alert = findLinkedAlert();
    if (!alert?.handoff || !stateFresh) return;
    return runRequest('mutation', () => mutateTask(async () => {
        $('task-handoff-routing-status').textContent = 'Accepting handoff…';
        requireSuccess(await window.electronAPI.acceptIncidentHandoff({
            alertId: alert.id,
            executionId: createActionRequestId('handoff-accept'),
            expectedUpdatedAt: alert.workflowUpdatedAt
        }), 'Unable to accept handoff. Refresh and try again.');
        $('task-handoff-routing-status').textContent = 'Handoff accepted. You are now the owner.';
    }), (error) => {
        $('task-handoff-routing-status').textContent = errorMessage(error, 'Unable to accept handoff.');
    });
}

function askAi(kind) {
    if (!stateFresh || !latestPayload?.job || !selectedJobName) return;
    setTab('ai');
    $('task-tab-ai').focus();
    return runRequest('ai', async () => {
        const alert = findLinkedAlert();
        aiOutput.hidden = false;
        aiStatus.textContent = 'Thinking';
        aiContent.innerHTML = '<p class="ai-report-pending">Preparing analysis...</p>';
        const message = kind === 'summary'
            ? buildSelectedJobHealthPrompt(selectedJobName)
            : alert
                ? (kind === 'explain' ? buildAlertExplanationPrompt(alert) : buildAlertNextActionsPrompt(alert))
                : `Explain how to resolve the current IBM i job condition for ${selectedJobName}.`;
        const result = requireSuccess(await window.electronAPI.askAiAssistant({
            message,
            selectedJobName,
            scope: 'job'
        }), 'AI analysis failed.');
        aiStatus.textContent = 'Ready';
        aiContent.innerHTML = renderAiReportMarkdown(result.reply || 'No response returned.');
    }, (error) => {
        aiStatus.textContent = 'Unavailable';
        aiContent.innerHTML = `<p class="ai-report-error">${escapeHtml(errorMessage(error, 'AI analysis failed.'))}</p>`;
    });
}

function loadDetails(kind) {
    return runRequest('details', async () => {
        detailsOutput.textContent = kind === 'log'
            ? 'Loading job log…'
            : kind === 'messages' ? 'Loading message context…' : 'Building observed relationships…';
        if (kind === 'graph') {
            const result = requireSuccess(await window.electronAPI.getJobResourceGraph(selectedJobName), 'Unable to build job relationships.');
            renderResourceGraph(detailsOutput, result.graph);
            return;
        }
        const result = requireSuccess(await (kind === 'log'
            ? window.electronAPI.getJobLog(selectedJobName)
            : window.electronAPI.getJobMessages(selectedJobName)), 'Unable to load job evidence.');
        const render = kind === 'log' ? renderJobLog : renderJobMessages;
        render(detailsOutput, result.records || []);
    }, (error) => {
        detailsOutput.textContent = errorMessage(error, 'Unable to load job evidence.');
    });
}

function renderResourceGraph(output, graph) {
    if (!graph) {
        output.textContent = 'No relationship graph returned.';
        return;
    }
    const nodeLabels = new Map((graph.nodes || []).map((node) => [node.id, node.label]));
    const edgeRows = (graph.edges || []).map((edge) => `
        <li class="resource-graph-edge">
            <strong>${escapeHtml(nodeLabels.get(edge.from) || edge.from)}</strong>
            <span aria-hidden="true">→</span>
            <strong>${escapeHtml(nodeLabels.get(edge.to) || edge.to)}</strong>
            <small>${escapeHtml(edge.relationship.replace(/-/g, ' '))} · ${escapeHtml(edge.confidence)}</small>
        </li>`).join('');
    const notes = (graph.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join('');
    output.innerHTML = `<section class="resource-graph" data-testid="task-resource-graph">
        <div class="resource-graph-header"><strong>Observed resource relationships</strong><span>${graph.stale ? 'Stale · refresh before acting' : 'Current snapshot'}</span></div>
        ${edgeRows ? `<ol class="resource-graph-flow" aria-label="Observed relationship flow">${edgeRows}</ol>` : '<p class="stat-note mb-0">No observed links were returned.</p>'}
        ${notes ? `<ul class="resource-graph-notes">${notes}</ul>` : ''}
        <details class="resource-graph-table"><summary>Accessible relationship details</summary><table class="table table-sm mb-0"><thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Evidence</th></tr></thead><tbody>
            ${(graph.edges || []).map((edge) => `<tr><td>${escapeHtml(nodeLabels.get(edge.from) || edge.from)}</td><td>${escapeHtml(edge.relationship.replace(/-/g, ' '))}</td><td>${escapeHtml(nodeLabels.get(edge.to) || edge.to)}</td><td>${escapeHtml(edge.evidence?.[0]?.label || 'Observed')}</td></tr>`).join('') || '<tr><td colspan="4">No relationships found.</td></tr>'}
        </tbody></table></details>
    </section>`;
}

const tabs = Array.from(document.querySelectorAll('[data-task-tab]'));
tabs.forEach((button, index) => {
    button.addEventListener('click', () => setTab(button.dataset.taskTab));
    button.addEventListener('keydown', (event) => {
        const targets = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
            Home: 0, End: tabs.length - 1 };
        if (!(event.key in targets)) return;
        event.preventDefault();
        const target = tabs[targets[event.key]];
        setTab(target.dataset.taskTab);
        target.focus();
    });
});

incidentActions.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.action) void runWorkflow(button.dataset.action);
    else if (button.dataset.aiAction) void askAi(button.dataset.aiAction);
    else if (button.dataset.taskUrl) {
        void runRequest('external', async () => {
            requireSuccess(await window.electronAPI.openExternalUrl(button.dataset.taskUrl), 'Unable to open linked task.');
            workflowNote.textContent = 'Opened linked task.';
        }, (error) => { workflowNote.textContent = errorMessage(error, 'Unable to open linked task.'); });
    }
});

jobActions.addEventListener('click', (event) => {
    const button = event.target.closest('.job-action-button');
    if (!button || button.disabled || pending.has('mutation') || !stateFresh) return;
    const actionKind = button.dataset.actionKind;
    if (['holdJob', 'releaseJob', 'endJob', 'replyMessage'].includes(actionKind)
        && !window.confirm(`${button.textContent.trim()} for ${selectedJobName}?`)) return;
    void runRequest('mutation', () => mutateTask(async () => {
        actionNote.textContent = actionFeedback = 'Running operation…';
        const result = requireSuccess(await window.electronAPI.runJobAction({
            kind: actionKind,
            jobName: selectedJobName,
            confirmed: true,
            executionId: createActionRequestId('job')
        }), 'Action failed.');
        actionNote.textContent = actionFeedback = result.message || 'Action completed.';
    }), (error) => {
        actionNote.textContent = actionFeedback = errorMessage(error, 'Action failed.');
    });
});

$('task-ai-summary').addEventListener('click', () => void askAi('summary'));
$('task-ai-resolve').addEventListener('click', () => void askAi('resolve'));
$('task-request-handoff').addEventListener('click', () => void requestHandoff());
$('task-accept-handoff').addEventListener('click', () => void acceptHandoff());
$('task-load-log').addEventListener('click', () => void loadDetails('log'));
$('task-load-messages').addEventListener('click', () => void loadDetails('messages'));
$('task-load-graph').addEventListener('click', () => void loadDetails('graph'));
$('task-refresh').addEventListener('click', () => void loadTask());

window.electronAPI.onAlertsUpdated((alerts) => {
    alertsRevision += 1;
    latestAlerts = Array.isArray(alerts) ? alerts : [];
    renderTask();
});

void loadTask();
const refreshTimer = window.setInterval(() => {
    if (!pending.has('mutation')) void loadTask();
}, 7000);
window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer));
