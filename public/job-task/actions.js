import { escapeHtml, createActionRequestId } from '../monitor/formatters.js';
import { renderOperatorActions } from '../monitor/job-details.js';

// One action workspace per task window; request coordination stays with the page.
export function createTaskActions({ document, api, jobName: selectedJobName,
    getPayload, isBlocked, runRequest, mutateTask, requireSuccess, errorMessage, confirm }) {
    const $ = (id) => document.getElementById(id);
    const jobActions = $('task-job-actions');
    const actionNote = $('task-action-note');
    const mcpActionSection = $('task-mcp-actions');
    const mcpActionList = $('task-mcp-action-list');
    const mcpActionState = $('task-mcp-action-state');
    const mcpActionInputWrap = $('task-mcp-action-input-wrap');
    const mcpActionInput = $('task-mcp-action-input');
    const mcpActionPreviewOutput = $('task-mcp-action-preview');
    const mcpActionRun = $('task-mcp-action-run');
    const mcpActionCancel = $('task-mcp-action-cancel');
    const mcpActionNote = $('task-mcp-action-note');
    const actionPlannerSection = $('task-action-planner');
    const actionPlannerPrimary = $('task-action-planner-title');
    const actionPlannerReason = $('task-action-planner-reason');
    const actionPlannerMeta = $('task-action-planner-meta');
    const actionPlannerList = $('task-action-planner-list');
    const runbookSection = $('task-runbook-section');
    const runbookStatus = $('task-runbook-status');
    const runbookSummary = $('task-runbook-summary');
    const runbookSteps = $('task-runbook-steps');
    const runbookStart = $('task-runbook-start');
    const runbookStepButton = $('task-runbook-step');
    const runbookNote = $('task-runbook-note');
    const runbookReply = $('task-runbook-reply');
    let actionFeedback = '';
    let runbookData = { definition: null, execution: null };
    let mcpActionCatalog = [];
    let mcpActionSelection = null;
    let mcpActionPreview = null;
    let aiActionPlanner = null;
    let previewRevision = 0;

    function renderRunbook() {
        if (!runbookSection || !runbookSteps) return;
        const definition = runbookData.definition;
        const execution = runbookData.execution;
        runbookSection.hidden = !definition;
        if (!definition) return;
        const statusLabel = String(execution?.status || 'not started').replace(/[-_]/g, ' ');
        runbookStatus.textContent = statusLabel.replace(/\b\w/g, (letter) => letter.toUpperCase());
        runbookSummary.textContent = execution
            ? `${definition.title} · ${execution.operator} · ${execution.steps.filter((step) => step.status === 'succeeded').length}/${definition.steps.length} checkpoints complete.`
            : `${definition.title}. Start the runbook to record each checkpoint before the protected action is offered.`;
        runbookSteps.innerHTML = definition.steps.map((step, index) => {
            const record = execution?.steps?.[index];
            const current = Boolean(execution && execution.currentStepIndex === index && ['running', 'paused'].includes(execution.status));
            const state = record?.status || 'pending';
            return `<li class="runbook-step is-${escapeHtml(state)}${current ? ' is-current' : ''}">
                <div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.kind)} · ${escapeHtml(state)}</small></div>
                <p>${escapeHtml(step.expectedOutcome)}</p>
                ${record?.output ? `<small class="runbook-step-output">${escapeHtml(record.output)}</small>` : ''}
            </li>`;
        }).join('');
        const currentStep = execution ? definition.steps[execution.currentStepIndex] : null;
        runbookReply.hidden = currentStep?.action !== 'replyMessage';
        runbookStepButton.textContent = execution?.status === 'paused' ? 'Retry checkpoint' : 'Run current checkpoint';
        if (execution?.outcome) {
            runbookNote.textContent = `${execution.outcome.summary} ${execution.outcome.evidence.join(' ')}`;
        } else if (execution?.status === 'succeeded') {
            runbookNote.textContent = 'Runbook completed and recovery was verified.';
        } else {
            runbookNote.textContent = currentStep?.stopCondition || '';
        }
    }

    // Return data to the page's refresh batch; only a current batch may apply it.
    async function readRunbook(payload) {
        const empty = { definition: null, execution: null };
        if (!payload?.runbook || typeof api.getVerifiedRunbook !== 'function') return empty;
        try {
            const result = await api.getVerifiedRunbook(selectedJobName);
            return result?.success ? { definition: result.definition, execution: result.execution } : empty;
        } catch {
            return empty;
        }
    }

    function renderMcpActions() {
        if (!mcpActionSection || !mcpActionList) return;
        mcpActionSection.hidden = !mcpActionCatalog.length;
        mcpActionList.innerHTML = mcpActionCatalog.map((action) => `
            <button type="button" class="btn btn-outline-ink btn-sm task-mcp-action-button"
                data-mcp-capability="${escapeHtml(action.capabilityId)}" data-mcp-tool="${escapeHtml(action.tool)}"
                ${action.available ? '' : 'disabled'} title="${escapeHtml(action.reason || action.effect)}">
                ${escapeHtml(action.label)}<small>${escapeHtml(action.available ? `${action.riskClass} risk · preview` : action.reason || 'Unavailable')}</small>
            </button>`).join('');
        if (mcpActionState) mcpActionState.textContent = mcpActionPreview?.state ? String(mcpActionPreview.state).replace(/-/g, ' ') : 'Preview required';
        if (mcpActionInputWrap) mcpActionInputWrap.hidden = mcpActionSelection?.tool !== 'end-job' && mcpActionSelection?.tool !== 'reply-message';
        if (mcpActionPreviewOutput) {
            mcpActionPreviewOutput.hidden = !mcpActionPreview;
            if (mcpActionPreview) {
                mcpActionPreviewOutput.innerHTML = `
                    <strong>${escapeHtml(mcpActionPreview.effect || 'Controlled action')}</strong>
                    <span>${escapeHtml(mcpActionPreview.riskClass || 'unknown')} risk · ${escapeHtml(mcpActionPreview.scope?.operatorId || 'operator')} · ${escapeHtml(mcpActionPreview.scope?.systemScope || 'system')}</span>
                    <small>Evidence: ${escapeHtml(mcpActionPreview.evidence?.summary || 'current job evidence')} · Verify: ${escapeHtml(mcpActionPreview.verificationRule || 'next monitoring poll')}</small>`;
            }
        }
        if (mcpActionCancel) mcpActionCancel.hidden = !mcpActionSelection;
        updateControls();
    }

    function mergedActionPlanner() {
        const base = aiActionPlanner || getPayload()?.actionPlanner;
        const proposals = [];
        const seen = new Set();
        const add = (proposal) => {
            if (!proposal?.id || seen.has(proposal.id)) return;
            seen.add(proposal.id);
            proposals.push(proposal);
        };
        (base?.proposals || []).forEach(add);
        mcpActionCatalog.map((action) => action.proposal).filter(Boolean).forEach(add);
        if (!base && !proposals.length) return null;
        return {
            ...(base || {}),
            jobName: base?.jobName || selectedJobName,
            primary: base?.primary || null,
            proposals,
            escalationReasons: base?.escalationReasons || []
        };
    }

    function renderActionPlanner() {
        if (!actionPlannerSection || !actionPlannerPrimary || !actionPlannerReason || !actionPlannerList) return;
        const planner = mergedActionPlanner();
        const proposals = planner?.proposals || [];
        actionPlannerSection.hidden = !planner || (!planner.primary && !proposals.length);
        if (actionPlannerSection.hidden) return;

        const primary = planner.primary;
        actionPlannerPrimary.textContent = primary?.label || 'Review evidence';
        actionPlannerReason.textContent = primary?.reason || 'Review the available evidence before choosing an operation.';
        if (actionPlannerMeta) {
            actionPlannerMeta.textContent = `${proposals.length} proposal${proposals.length === 1 ? '' : 's'} · ${planner.jobName || selectedJobName}`;
        }
        actionPlannerList.innerHTML = proposals.length
            ? proposals.map((proposal) => {
                const state = String(proposal.state || 'advisory').replace(/[-_]/g, ' ');
                const sources = Array.isArray(proposal.sources) ? proposal.sources.join(' · ') : '';
                const required = Array.isArray(proposal.requiredPermissions) ? proposal.requiredPermissions.join(', ') : 'review';
                return `<article class="task-action-planner-row">
                    <div class="task-action-planner-row-heading"><strong>${escapeHtml(proposal.label || 'Review proposal')}</strong><span>${escapeHtml(state)} · ${escapeHtml(proposal.riskClass || 'unknown')} risk</span></div>
                    <small>${escapeHtml(proposal.effect || proposal.rationale || '')}</small>
                    <small>Sources: ${escapeHtml(sources || 'operator')} · Requires: ${escapeHtml(required)}</small>
                    <small>Verify: ${escapeHtml(proposal.verificationRule || 'Confirm the next monitoring state.')}</small>
                </article>`;
            }).join('')
            : '<p class="stat-note mb-0">No action proposal is available for this job.</p>';
    }

    function invalidatePreview() {
        previewRevision += 1;
        mcpActionPreview = null;
    }

    function applySnapshot(catalog, runbook) {
        mcpActionCatalog = catalog?.success && Array.isArray(catalog.actions) ? catalog.actions : [];
        runbookData = runbook;
        invalidatePreview();
        mcpActionSelection = null;
        aiActionPlanner = null;
    }

    function previewMcpAction(capabilityId, tool) {
        const action = mcpActionCatalog.find((item) => item.capabilityId === capabilityId && item.tool === tool);
        if (isBlocked() || !action?.available || typeof api.previewMcpAction !== 'function') return;
        invalidatePreview();
        mcpActionSelection = action;
        renderMcpActions();
        const revision = previewRevision;
        let input = {};
        if (mcpActionInput?.value.trim()) {
            try {
                input = JSON.parse(mcpActionInput.value);
            } catch {
                if (mcpActionNote) mcpActionNote.textContent = 'Action input must be valid JSON.';
                return;
            }
        }
        return runRequest('mcp-action', async () => {
            if (mcpActionNote) mcpActionNote.textContent = 'Checking current evidence and permissions…';
            const result = requireSuccess(await api.previewMcpAction({ capabilityId, tool, jobName: selectedJobName, input, timeoutMs: 5000 }), 'Unable to create the action preview.');
            if (revision !== previewRevision) return;
            mcpActionPreview = result.preview;
            if (mcpActionNote) mcpActionNote.textContent = 'Review the effect, risk, scope, and evidence before approving.';
            renderMcpActions();
        }, (error) => {
            if (revision !== previewRevision) return;
            mcpActionPreview = null;
            if (mcpActionNote) mcpActionNote.textContent = errorMessage(error, 'Unable to create the action preview.');
            renderMcpActions();
        });
    }

    function runMcpAction() {
        const preview = mcpActionPreview;
        if (isBlocked() || preview?.state !== 'awaiting-approval' || typeof api.runMcpAction !== 'function') return;
        if (!confirm(`${preview.effect} This will run for ${selectedJobName}. Continue?`)) return;
        return runRequest('mcp-action', () => mutateTask(async () => {
            if (mcpActionNote) mcpActionNote.textContent = 'Running through the controlled gateway…';
            const result = await api.runMcpAction({ previewId: preview.previewId, approved: true });
            mcpActionPreview = result?.preview || null;
            renderMcpActions();
            if (!result?.success) throw new Error(result?.error || 'The action needs verification.');
            if (mcpActionNote) mcpActionNote.textContent = result.verification?.summary || 'Action recovered and verified.';
        }), (error) => {
            if (mcpActionNote) mcpActionNote.textContent = errorMessage(error, 'The action needs verification.');
            renderMcpActions();
        });
    }

    function startRunbook() {
        if (isBlocked() || !runbookData.definition || ['ready', 'running', 'paused'].includes(runbookData.execution?.status)) return;
        return runRequest('runbook', () => mutateTask(async () => {
            runbookNote.textContent = 'Starting runbook…';
            const result = requireSuccess(await api.startVerifiedRunbook({ jobName: selectedJobName }), 'Unable to start runbook.');
            runbookData = { definition: result.definition || runbookData.definition, execution: result.execution || null };
            renderRunbook();
        }), (error) => {
            runbookNote.textContent = errorMessage(error, 'Unable to start runbook.');
        });
    }

    function runCurrentRunbookStep() {
        const definition = runbookData.definition;
        const execution = runbookData.execution;
        const step = definition && execution ? definition.steps[execution.currentStepIndex] : null;
        if (!step || isBlocked() || !['running', 'paused'].includes(execution.status)) return;
        if (step.confirmationRequired && !confirm(`${step.title} for ${selectedJobName}?`)) return;
        return runRequest('runbook', () => mutateTask(async () => {
            runbookNote.textContent = 'Running checkpoint…';
            const result = requireSuccess(await api.runVerifiedRunbookStep({
                jobName: selectedJobName,
                executionId: execution.id,
                replyText: $('task-runbook-reply-text')?.value,
                messageKey: $('task-runbook-message-key')?.value,
                messageQueue: $('task-runbook-message-queue')?.value,
                confirmed: step.confirmationRequired
            }), 'Unable to run checkpoint.');
            runbookData = { definition: result.definition || definition, execution: result.execution || execution };
            runbookNote.textContent = result.message || 'Checkpoint completed.';
        }), (error) => {
            runbookNote.textContent = errorMessage(error, 'Unable to run checkpoint.');
        });
    }

    jobActions.addEventListener('click', (event) => {
        const button = event.target.closest('.job-action-button');
        if (!button || button.disabled || isBlocked()) return;
        const actionKind = button.dataset.actionKind;
        if (['holdJob', 'releaseJob', 'endJob', 'replyMessage'].includes(actionKind)
            && !confirm(`${button.textContent.trim()} for ${selectedJobName}?`)) return;
        void runRequest('mutation', () => mutateTask(async () => {
            actionNote.textContent = actionFeedback = 'Running operation…';
            const result = requireSuccess(await api.runJobAction({
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

    mcpActionList?.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-mcp-tool]');
        if (!button || button.disabled) return;
        void previewMcpAction(button.dataset.mcpCapability || '', button.dataset.mcpTool || '');
    });
    mcpActionRun?.addEventListener('click', () => void runMcpAction());
    mcpActionCancel?.addEventListener('click', () => {
        mcpActionSelection = null;
        invalidatePreview();
        if (mcpActionInput) mcpActionInput.value = '';
        if (mcpActionNote) mcpActionNote.textContent = '';
        renderMcpActions();
    });

    mcpActionInput?.addEventListener('input', () => {
        invalidatePreview();
        if (mcpActionNote) mcpActionNote.textContent = 'Input changed. Preview the action again before approving.';
        renderMcpActions();
    });

    runbookStart?.addEventListener('click', () => void startRunbook());
    runbookStepButton?.addEventListener('click', () => void runCurrentRunbookStep());

    function updateControls() {
        const blocked = isBlocked();
        jobActions.querySelectorAll('.job-action-button').forEach((button) => {
            const action = getPayload()?.actions?.find((item) => item.kind === button.dataset.actionKind);
            button.disabled = blocked || !action?.enabled;
        });
        mcpActionList?.querySelectorAll('[data-mcp-tool]').forEach((button) => {
            const action = mcpActionCatalog.find((item) => item.capabilityId === button.dataset.mcpCapability && item.tool === button.dataset.mcpTool);
            button.disabled = blocked || !action?.available;
        });
        if (mcpActionRun) mcpActionRun.disabled = blocked || mcpActionPreview?.state !== 'awaiting-approval';
        const { definition, execution } = runbookData;
        if (runbookStart) runbookStart.disabled = blocked || !definition || ['ready', 'running', 'paused'].includes(execution?.status);
        if (runbookStepButton) runbookStepButton.disabled = blocked || !['running', 'paused'].includes(execution?.status)
            || !definition?.steps[execution?.currentStepIndex];
    }

    function render() {
        renderRunbook();
        renderActionPlanner();
        renderOperatorActions(jobActions, null, getPayload()?.actions);
        renderMcpActions();
        if (!actionFeedback) {
            const blocked = (getPayload()?.actions || []).filter((action) => !action.enabled && action.reason);
            actionNote.textContent = blocked.length
                ? blocked.map((action) => `${action.label}: ${action.reason}`).join(' | ')
                : 'Operations apply to this job. Changes require confirmation.';
        }
        updateControls();
    }

    return {
        render, updateControls, readRunbook, applySnapshot, invalidatePreview,
        setAiPlanner(planner) {
            if (planner) aiActionPlanner = planner;
            renderActionPlanner();
        }
    };
}
