import { escapeHtml, formatCpuValue, getJobKey } from './formatters.js';
import { getAlertOwner, getAlertConditionLabel } from './alert-view.js';

const statusLabels = { RUN: 'Running', MSGW: 'Message wait', LCKW: 'Lock wait', DEQW: 'Dequeue wait', DLYW: 'Delay wait', END: 'Ended', EOJ: 'Ended' };
const alertStatuses = { messageWait: 'MSGW', lockWait: 'LCKW', dequeueWait: 'DEQW', delayWait: 'DLYW' };

/** Separate the active incident from the technical execution state. */
export function describeJobCondition(job, alert) {
    const status = String(job.STATUS || '').trim().toUpperCase();
    const active = alert?.isActive !== false ? alert : null;
    const expectedStatus = alertStatuses[active?.kind];
    if (active) {
        return {
            label: active.kind === 'highCpu' ? 'High CPU' : expectedStatus ? statusLabels[expectedStatus] : getAlertConditionLabel(active),
            detail: expectedStatus && status !== expectedStatus
                ? `Observed ${statusLabels[status] || status}; recovery not yet verified`
                : active.title || status,
            tone: active.severity === 'critical' ? 'critical' : 'warning'
        };
    }
    return {
        label: statusLabels[status] || status || 'Unknown',
        detail: status === 'MSGW' ? 'Operator reply needed · MSGW' : status === 'RUN' ? '' : status,
        tone: ['MSGW', 'LCKW', 'DEQW', 'DLYW'].includes(status) ? 'warning' : 'normal'
    };
}

/** Patch by qualified identity so polling does not replace focused rows. */
export function renderJobRows(tbody, jobs, { findAlert, selectedJobName }) {
    const scrollArea = tbody.closest('#system-stats');
    const scrollTop = scrollArea?.scrollTop;
    const focusedKey = tbody.contains(document.activeElement) ? document.activeElement.closest('tr')?.dataset.jobName : null;
    const rows = new Map(Array.from(tbody.querySelectorAll('tr.job-row'), row => [row.dataset.jobName, row]));
    tbody.querySelectorAll('.table-placeholder').forEach(row => row.remove());
    const liveKeys = new Set();
    for (const [index, job] of jobs.entries()) {
        const key = getJobKey(job);
        liveKeys.add(key);
        const alert = findAlert(key);
        const condition = describeJobCondition(job, alert);
        const owner = getAlertOwner(alert);
        const name = job.JOB_NAME_SHORT || String(key).split('/').pop();
        const priority = alert?.correlation?.priority;
        let row = rows.get(key);
        if (!row) {
            row = document.createElement('tr');
            row.dataset.jobName = key;
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.innerHTML = '<td></td><td></td><td></td><td></td>';
        }
        row.className = `job-row is-${condition.tone}${alert ? ' has-incident' : ''}${selectedJobName === key ? ' is-selected' : ''}`;
        row.setAttribute('aria-label', `Open details for ${job.SUBSYSTEM_JOB || key}: ${condition.label}${owner ? `, owned by ${owner}` : ''}`);
        row.setAttribute('aria-pressed', String(selectedJobName === key));
        const cells = [
            `<div class="job-cell-primary"><strong>${escapeHtml(name)}</strong><small title="${escapeHtml(key)}">${escapeHtml(job.SUBSYSTEM_JOB || job.SUBSYSTEM || '')}${job.FUNCTION_NAME ? ` · ${escapeHtml(job.FUNCTION_NAME)}` : ''}</small></div>`,
            `<div class="job-condition" data-state="${escapeHtml(job.STATUS || '')}" title="${escapeHtml(priority ? `Priority ${priority.score}/100. ${priority.reasons?.join(' ') || ''}` : '')}"><span>${escapeHtml(condition.label)}</span><small>${escapeHtml(condition.detail)}</small></div>`,
            `<span class="job-cpu-value">${formatCpuValue(job.CPU)}</span>`,
            owner ? `<span class="job-owner-chip" title="Worked by ${escapeHtml(owner)}">${escapeHtml(owner)}</span>` : `<span class="board-muted">${alert ? 'Unassigned' : '—'}</span>`
        ];
        cells.forEach((html, i) => { if (row.cells[i].innerHTML !== html) row.cells[i].innerHTML = html; });
        if (tbody.children[index] !== row) tbody.insertBefore(row, tbody.children[index] || null);
    }
    rows.forEach((row, key) => { if (!liveKeys.has(key)) row.remove(); });
    if (focusedKey) {
        const focusedRow = rows.get(focusedKey);
        if (focusedRow?.isConnected && document.activeElement !== focusedRow) focusedRow.focus({ preventScroll: true });
        else if (!focusedRow?.isConnected) document.getElementById('jobs-search-input')?.focus({ preventScroll: true });
    }
    if (scrollArea && typeof scrollTop === 'number') scrollArea.scrollTop = scrollTop;
}
