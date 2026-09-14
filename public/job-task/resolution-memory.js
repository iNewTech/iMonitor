import { escapeHtml, formatTimestamp } from '../monitor/formatters.js';

// Review drafts and request ordering are local to this task window.
export function createResolutionMemory({ document, api, jobName: selectedJobName,
    getAlert, getJobName, isBlocked, runRequest, requireSuccess, errorMessage, formatWorkflowLabel, confirm }) {
    const $ = (id) => document.getElementById(id);
    const memoryList = $('task-memory-list');
    const memoryStatus = $('task-memory-status');
    const memorySave = $('task-memory-save');
    const memoryReviseForm = $('task-memory-revise-form');
    const memoryReviseTitle = $('task-memory-revise-title');
    const memoryReviseAction = $('task-memory-revise-action');
    const memoryReviseOutcome = $('task-memory-revise-outcome');
    const memoryReviseSave = $('task-memory-revise-save');
    const memoryReviseCancel = $('task-memory-revise-cancel');
    let resolutionMemoryEntries = [];
    let resolutionMemoryMatches = [];
    let resolutionMemoryRevisionId = '';
    let readRevision = 0;
    let busy = false;
    let feedback = '';

    function renderResolutionMemory() {
        if (!memoryList) return;
        const alert = getAlert();
        const jobName = getJobName() || selectedJobName;
        const entries = resolutionMemoryEntries.filter((entry) => (
            entry.incidentKind === alert?.kind
            && (!entry.jobPattern || matchesWildcard(jobName, entry.jobPattern))
        ));
        memoryList.innerHTML = entries.length ? entries.map((entry) => `
            <article class="resolution-memory-item" data-memory-id="${escapeHtml(entry.id)}">
                <div>
                    <strong>${escapeHtml(entry.title)}</strong>
                    <small>${escapeHtml(formatWorkflowLabel(entry.status))} · v${escapeHtml(String(entry.version))}${entry.reviewer ? ` · reviewer ${escapeHtml(entry.reviewer)}` : ''}</small>
                    <div class="resolution-memory-item-meta">
                        ${entry.operator ? `<span>Operator: ${escapeHtml(entry.operator)}</span>` : ''}
                        ${entry.sourceIncidentId ? `<span>Source: ${escapeHtml(entry.sourceIncidentId)}</span>` : ''}
                    </div>
                    ${renderMatch(entry)}
                    <details class="resolution-memory-item-details">
                        <summary>Evidence and review history</summary>
                        <small>${escapeHtml(entry.environment?.jobType || 'Unknown type')} · ${escapeHtml(entry.environment?.subsystem || 'Unknown subsystem')} · ${entry.evidenceRefs?.length || 0} evidence references</small>
                        <small>Outcome: ${escapeHtml(entry.verifiedOutcome || 'Not recorded')}</small>
                        <details class="resolution-memory-reviews">
                            <summary>${entry.reviewHistory?.length || 0} review event${entry.reviewHistory?.length === 1 ? '' : 's'}</summary>
                            ${(entry.reviewHistory || []).map((event) => `<small>${escapeHtml(formatWorkflowLabel(event.action))} · ${escapeHtml(event.actor)} · ${escapeHtml(formatTimestamp(event.at))}${event.note ? ` · ${escapeHtml(event.note)}` : ''}</small>`).join('') || '<small>No review events recorded.</small>'}
                        </details>
                    </details>
                </div>
                <div class="resolution-memory-item-actions">
                    ${entry.status === 'draft' ? '<button type="button" class="btn btn-primary-strong btn-sm" data-memory-action="approve">Approve</button>' : ''}
                    ${['draft', 'approved', 'rejected'].includes(entry.status) ? '<button type="button" class="btn btn-outline-ink btn-sm" data-memory-action="revise">Revise</button>' : ''}
                    ${entry.status === 'draft' ? '<button type="button" class="btn btn-outline-danger btn-sm" data-memory-action="reject">Reject</button>' : ''}
                    ${entry.status === 'approved' ? '<button type="button" class="btn btn-outline-danger btn-sm" data-memory-action="retire">Retire</button>' : ''}
                </div>
            </article>`).join('') : '<p class="stat-note mb-2">No saved procedure matches this incident yet.</p>';
        if (memoryStatus && !feedback) {
            memoryStatus.textContent = entries.length ? `${entries.length} matching entr${entries.length === 1 ? 'y' : 'ies'}` : 'No match';
            if (alert?.isActive !== false) memoryStatus.textContent = 'Available after verified recovery';
        }
        if (memorySave) memorySave.textContent = alert?.isActive === false ? 'Save resolution draft' : 'Save after verified recovery';
        if (memoryStatus && feedback) memoryStatus.textContent = feedback;
        updateControls();
    }

    function renderMatch(entry) {
        const match = entry.status === 'approved' && resolutionMemoryMatches.find((item) => item.entryId === entry.id);
        if (!match) return '';
        return `<div class="resolution-memory-item-meta">
            <span>${escapeHtml(match.confidence)} confidence</span>
            <span>${escapeHtml(match.freshness)} review</span>
            <span>${match.environmentCompatible ? 'Environment compatible' : 'Environment differs'}</span>
        </div>${match.conflict ? `<small class="text-danger">${escapeHtml(match.conflict)}</small>` : ''}`;
    }

    async function refreshResolutionMemory() {
        if (!selectedJobName || !api.getResolutionMemory || busy) return;
        const revision = ++readRevision;
        try {
            const result = await api.getResolutionMemory(selectedJobName);
            if (revision !== readRevision) return;
            requireSuccess(result, 'Unable to load resolution memory.');
            resolutionMemoryEntries = Array.isArray(result.entries) ? result.entries : [];
            resolutionMemoryMatches = Array.isArray(result.matches) ? result.matches : [];
            renderResolutionMemory();
        } catch (error) {
            if (revision === readRevision) {
                memoryStatus.textContent = errorMessage(error, 'Unable to load resolution memory.');
            }
        }
    }

    function updateControls() {
        const blocked = busy || isBlocked();
        if (memorySave) memorySave.disabled = blocked || getAlert()?.isActive !== false;
        memoryList?.querySelectorAll('[data-memory-action]').forEach((button) => { button.disabled = blocked; });
        if (memoryReviseSave) memoryReviseSave.disabled = blocked || !resolutionMemoryRevisionId;
        if (memoryReviseCancel) memoryReviseCancel.disabled = busy;
        [memoryReviseTitle, memoryReviseAction, memoryReviseOutcome].forEach((field) => {
            if (field) field.disabled = busy;
        });
    }

    function mutateMemory(message, operation, fallback, onSuccess) {
        if (busy || isBlocked()) return;
        return runRequest('memory', async () => {
            busy = true;
            readRevision += 1; // Discard reads started before this review change.
            memoryStatus.textContent = feedback = message;
            updateControls();
            try {
                requireSuccess(await operation(), fallback);
                onSuccess?.();
                feedback = '';
            } finally {
                busy = false;
                updateControls();
            }
            await refreshResolutionMemory();
        }, (error) => {
            memoryStatus.textContent = feedback = errorMessage(error, fallback);
        });
    }

    function matchesWildcard(value, pattern) {
        const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        return new RegExp(`^${escaped}$`, 'i').test(String(value));
    }

    memorySave?.addEventListener('click', () => {
        if (getAlert()?.isActive !== false) return;
        void mutateMemory('Saving draft…', () => api.saveResolutionMemoryDraft(selectedJobName), 'Unable to save resolution draft.');
    });

    function openResolutionRevision(entry) {
        feedback = '';
        resolutionMemoryRevisionId = entry.id;
        memoryReviseTitle.value = entry.title || '';
        memoryReviseAction.value = entry.successfulAction || '';
        memoryReviseOutcome.value = entry.verifiedOutcome || '';
        memoryReviseForm.hidden = false;
        memoryReviseTitle.focus();
        updateControls();
    }

    function closeResolutionRevision() {
        resolutionMemoryRevisionId = '';
        memoryReviseForm.hidden = true;
        updateControls();
    }

    memoryReviseCancel?.addEventListener('click', () => { if (!busy) closeResolutionRevision(); });
    memoryReviseSave?.addEventListener('click', () => {
        if (!resolutionMemoryRevisionId) return;
        const entryId = resolutionMemoryRevisionId;
        const revision = {
            title: memoryReviseTitle.value,
            successfulAction: memoryReviseAction.value,
            verifiedOutcome: memoryReviseOutcome.value
        };
        void mutateMemory('Saving revision…', () => api.reviseResolutionMemory(entryId, revision),
            'Unable to save the memory revision.', closeResolutionRevision);
    });

    memoryList?.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-memory-action]');
        const item = button?.closest('[data-memory-id]');
        if (!button || button.disabled || !item || busy || isBlocked()) return;
        const entryId = item.dataset.memoryId;
        const action = button.dataset.memoryAction;
        if (!entryId || !action) return;
        const entry = resolutionMemoryEntries.find((item) => item.id === entryId);
        if (!entry) return;
        if (action === 'revise') {
            openResolutionRevision(entry);
            return;
        }
        if (action === 'retire' && !confirm('Retire this approved procedure?')) return;
        if (action === 'reject' && !confirm('Reject this draft so it cannot be retrieved?')) return;
        const actions = {
            approve: { message: 'Approving…', run: () => api.approveResolutionMemory(entryId) },
            reject: { message: 'Rejecting…', run: () => api.rejectResolutionMemory(entryId) },
            retire: { message: 'Retiring…', run: () => api.retireResolutionMemory(entryId) }
        };
        if (!actions[action]) return;
        void mutateMemory(actions[action].message, actions[action].run, 'Unable to update resolution memory.');
    });

    return { render: renderResolutionMemory, refresh: refreshResolutionMemory, updateControls };
}
