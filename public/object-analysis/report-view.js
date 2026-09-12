import { escapeHtml } from '../connection/shared.js';
import { renderAiReportMarkdown } from '../monitor/ibmeyeai/render.js';
import { renderCallGraph } from './call-graph.js';

/** Renders reports only; requests and selection state belong to the page controller. */
export function createReportView(elements, getSettings) {
    function renderList(element, items, emptyText) {
        if (!element) return;
        element.innerHTML = items.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : `<li class="is-empty">${escapeHtml(emptyText)}</li>`;
    }

    function dependencyCategory(type) {
        switch (type) {
            case '*PGM': return 'Programs';
            case '*SRVPGM': return 'Service programs';
            case '*MODULE': return 'Modules';
            case '*FILE': return 'Files';
            case '*DTAQ': return 'Data queues';
            case '*DTAARA': return 'Data areas';
            case '*ENVVAR': return 'Environment variables';
            case '*JOBD':
            case '*JOBQ':
            case '*SBS': return 'Jobs & subsystems';
            case '*CMD':
            case '*COPY': return 'Commands & copybooks';
            default: return 'Other';
        }
    }

    function renderDependencyRows(result, nodeById) {
        const groups = new Map();
        result.edges.forEach((edge) => {
            const to = nodeById.get(edge.to);
            const category = dependencyCategory(to?.type || '*UNKNOWN');
            const edges = groups.get(category) || [];
            edges.push(edge);
            groups.set(category, edges);
        });
        const order = ['Programs', 'Service programs', 'Modules', 'Files', 'Data queues', 'Data areas', 'Environment variables', 'Jobs & subsystems', 'Commands & copybooks', 'Other'];
        return order.map((category) => {
            const edges = groups.get(category);
            if (!edges?.length) return '';
            const heading = `<tr class="analysis-table-group-row"><th colspan="5">${escapeHtml(category)} <span>${edges.length}</span></th></tr>`;
            const rows = edges.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                const tone = dependencyTone(to?.type || '*UNKNOWN', to?.status);
                return `<tr data-category="${tone}"><td><strong>${escapeHtml(`${to?.library || ''}/${to?.name || edge.to}`)}</strong>${edge.detail ? `<small>${escapeHtml(edge.detail)}</small>` : ''}</td><td><span class="analysis-inline-badge" data-category="${tone}">${escapeHtml(to?.type || 'UNKNOWN')}</span></td><td>${escapeHtml(edge.relationship)}${edge.line ? `<small>line ${edge.line}</small>` : ''}<small>from ${escapeHtml(`${from?.library || ''}/${from?.name || edge.from}`)}</small></td><td>${escapeHtml(edge.evidence)}</td><td><span class="analysis-confidence" data-confidence="${escapeHtml(edge.confidence)}">${escapeHtml(edge.confidence)}</span></td></tr>`;
            }).join('');
            return heading + rows;
        }).join('');
    }

    function renderSystemEvidence(result) {
        if (!elements.evidenceStatus) return;
        const evidence = result.systemEvidence;
        if (!evidence || evidence.source === 'local-source') {
            elements.evidenceStatus.textContent = 'Evidence: local source and catalog only · no IBM i commands run';
            return;
        }
        const collected = evidence.commands.filter((command) => command.status === 'collected').length;
        const failed = evidence.commands.filter((command) => command.status === 'failed').length;
        elements.evidenceStatus.textContent = `Evidence: IBM i commands · ${collected} collected${failed ? ` · ${failed} unavailable` : ''}`;
    }

    function resetResultDetails() {
        const sections = Array.from(elements.result?.querySelectorAll('.analysis-section') || []);
        sections.forEach((section) => {
            section.open = !section.id || ['analysis-business-section', 'analysis-flow-section', 'analysis-call-graph-section', 'analysis-conversion-section', 'analysis-compile-section'].includes(section.id);
        });
    }

    function renderAiReport(report) {
        if (!elements.aiSection || !elements.aiContent || !elements.aiMeta) return;
        if (!report?.content) {
            elements.aiSection.hidden = true;
            elements.aiContent.innerHTML = '';
            elements.aiMeta.textContent = 'Not run';
            return;
        }
        elements.aiSection.hidden = false;
        elements.aiSection.open = true;
        elements.aiMeta.textContent = `${report.providerLabel} · ${report.model}`;
        elements.aiContent.innerHTML = renderAiReportMarkdown(report.content);
    }

    function dependencyTone(type, status) {
        if (status === 'unresolved') return 'unresolved';
        if (type === '*PGM') return 'program';
        if (type === '*SRVPGM' || type === '*MODULE') return 'service';
        if (type === '*FILE') return 'data';
        return 'runtime';
    }

    function renderBusinessLogic(result) {
        const logic = result.businessLogic;
        const findings = Array.isArray(logic?.findings) ? logic.findings : [];
        if (elements.businessCount) elements.businessCount.textContent = `${findings.length} finding${findings.length === 1 ? '' : 's'}`;
        if (elements.businessSummary) elements.businessSummary.textContent = logic?.summary || 'No deterministic business logic was detected. Review the source and IBM i evidence manually.';
        if (!elements.businessFindings) return;
        elements.businessFindings.innerHTML = findings.length
            ? findings.map((finding) => `
                <article class="analysis-business-finding" data-category="${escapeHtml(finding.category)}">
                    <div class="analysis-finding-heading">
                        <span class="analysis-rule-category">${escapeHtml(finding.category)}</span>
                        <span class="analysis-confidence" data-confidence="${escapeHtml(finding.confidence)}">${escapeHtml(finding.confidence)}</span>
                    </div>
                    <strong>${escapeHtml(finding.title)}</strong>
                    <p>${escapeHtml(finding.detail)}</p>
                    <small>${escapeHtml(finding.evidence)} evidence${finding.line ? ` · line ${finding.line}` : ''}</small>
                </article>
            `).join('')
            : '<p class="analysis-table-empty">No business-rule patterns were found in this source.</p>';
    }

    function renderProgramFlow(result) {
        const steps = Array.isArray(result.programFlow) ? result.programFlow : [];
        if (elements.flowCount) elements.flowCount.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
        if (!elements.programFlow) return;
        elements.programFlow.innerHTML = steps.length
            ? steps.map((step) => `
                <article class="analysis-flow-step" data-kind="${escapeHtml(step.kind)}">
                    <span class="analysis-flow-sequence">${step.sequence}</span>
                    <span class="analysis-flow-marker"><i class="bi bi-arrow-down" aria-hidden="true"></i></span>
                    <div class="analysis-flow-copy">
                        <div><span>${escapeHtml(step.kind)}</span>${step.line ? `<small>line ${step.line}</small>` : ''}</div>
                        <strong>${escapeHtml(step.title)}</strong>
                        <p>${escapeHtml(step.detail)}</p>
                    </div>
                </article>
            `).join('')
            : '<p class="analysis-table-empty">No ordered execution steps were detected.</p>';
    }


    function renderConversionPlan(result) {
        const plan = Array.isArray(result.conversionPlan) ? result.conversionPlan : [];
        if (elements.conversionCount) elements.conversionCount.textContent = `${plan.length} action${plan.length === 1 ? '' : 's'}`;
        if (!elements.conversionPlan) return;
        elements.conversionPlan.innerHTML = plan.length
            ? plan.map((item) => `
                <article class="analysis-plan-item" data-priority="${escapeHtml(item.priority)}">
                    <span class="analysis-plan-order">${item.order}</span>
                    <div class="analysis-plan-copy">
                        <div><span class="analysis-plan-phase">${escapeHtml(item.phase)}</span><span class="analysis-plan-priority">${escapeHtml(item.priority)}</span></div>
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.action)}</p>
                        <small>${escapeHtml(item.reason)}</small>
                    </div>
                </article>
            `).join('')
            : '<p class="analysis-table-empty">No conversion actions were generated.</p>';
    }

    function renderCompilePlan(result) {
        const plan = result?.compilePlan;
        const steps = Array.isArray(plan?.steps) ? plan.steps : [];
        if (elements.compileCount) elements.compileCount.textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
        if (!elements.compileSection || !elements.compilePlan || !elements.compileCl) return;
        elements.compileSection.hidden = !plan;
        if (!plan) {
            elements.compilePlan.innerHTML = '';
            elements.compileCl.textContent = '';
            if (elements.compileStorage) elements.compileStorage.textContent = '';
            if (elements.copyCompileCl) elements.copyCompileCl.disabled = true;
            return;
        }
        const artifact = plan.artifact;
        if (elements.compileStorage) {
            elements.compileStorage.dataset.status = artifact?.mode || 'draft';
            elements.compileStorage.textContent = artifact?.mode === 'error'
                ? `${artifact.message}${artifact.error ? ` ${artifact.error}` : ''}`
                : artifact
                    ? `Saved build files: ${artifact.relativePath || 'build JSON'} · ${artifact.clPath || 'CL script'}`
                    : 'Compile plan generated in memory.';
        }
        elements.compilePlan.innerHTML = steps.length
            ? steps.map((step) => `
                <article class="analysis-compile-step" data-status="${escapeHtml(step.status)}">
                    <span class="analysis-plan-order">${step.sequence}</span>
                    <div class="analysis-plan-copy">
                        <div><span class="analysis-plan-phase">${escapeHtml(step.phase)}</span><span class="analysis-plan-priority">${escapeHtml(step.status)}</span></div>
                        <strong>${escapeHtml(`${step.object.library}/${step.object.name} ${step.object.type}`)}</strong>
                        <p>${escapeHtml(step.command)}</p>
                        <small>${escapeHtml(step.reason)}</small>
                    </div>
                </article>
            `).join('')
            : '<p class="analysis-table-empty">No compile steps were generated.</p>';
        elements.compileCl.textContent = plan.clCommands || '';
        if (elements.copyCompileCl) elements.copyCompileCl.disabled = !elements.compileCl.textContent;
    }

    function renderReportStorage(result) {
        if (!elements.reportStorage) return;
        const artifact = result.reportArtifact;
        const approved = result.approval?.status === 'approved' && Boolean(artifact) && artifact.mode !== 'error';
        if (elements.approve) {
            elements.approve.disabled = approved;
            elements.approve.innerHTML = approved
                ? '<i class="bi bi-check2-circle me-2"></i>Approved & mapped'
                : '<i class="bi bi-check2-circle me-2"></i>Approve & map report';
        }
        if (elements.download) elements.download.disabled = !approved;
        if (!artifact) {
            elements.reportStorage.textContent = 'Draft analysis · Review the findings, then approve to save and map this report.';
            elements.reportStorage.dataset.status = 'draft';
            return;
        }
        elements.reportStorage.textContent = artifact.mode === 'error'
            ? `${artifact.message}${artifact.error ? ` ${artifact.error}` : ''}`
            : `Approved by ${result.approval?.approvedBy || 'operator'} · Mapped report: ${artifact.key} · ${artifact.relativePath}`;
        elements.reportStorage.dataset.status = artifact.mode;
        elements.reportStorage.title = artifact.message;
    }

    function renderResult(result) {
        const settings = getSettings();
        const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
        elements.empty.hidden = true;
        elements.result.hidden = false;
        elements.resultTitle.textContent = `${result.root.library}/${result.root.name}`;
        elements.resultSubtitle.textContent = `${result.root.type} · ${result.root.description || result.root.sourcePath || 'Source object'} · scanned ${new Date(result.generatedAt).toLocaleTimeString()}`;
        if (elements.resultScope) {
            const sourceLibrary = result.scope?.sourceLibrary || settings.sourceLibrary;
            elements.resultScope.textContent = `Object scope: ${result.scope?.libraries?.join(', ') || 'No libraries recorded'} · source: ${sourceLibrary || 'selected member'} · depth ${result.scope?.depth ?? settings.dependencyDepth}`;
        }
        renderSystemEvidence(result);
        renderReportStorage(result);
        resetResultDetails();
        renderAiReport(result.aiReport);
        renderBusinessLogic(result);
        renderProgramFlow(result);
        renderCallGraph(elements.callGraph, elements.callGraphCount, result);
        renderConversionPlan(result);
        renderCompilePlan(result);
        elements.readiness.textContent = result.readiness.label;
        elements.readiness.dataset.status = result.readiness.status;
        elements.readinessScore.textContent = `${result.readiness.score}/100 readiness score`;
        elements.dependencies.textContent = String(result.directDependencies);
        elements.impacted.textContent = String(result.impactedObjects);
        elements.unresolved.textContent = String(result.unresolvedReferences.length);
        elements.edgeCount.textContent = `${result.edges.length} relationship${result.edges.length === 1 ? '' : 's'}`;
        renderList(elements.blockers, result.readiness.blockers, 'No blockers found.');
        renderList(elements.warnings, result.readiness.warnings, 'No additional review notes.');
        renderList(elements.confirmed, result.readiness.confirmed, 'No confirmed signals yet.');
        renderList(elements.sourceSignals, result.sourceSignals, 'No source signals detected.');
        elements.dependencyBody.innerHTML = result.edges.length
            ? renderDependencyRows(result, nodeById)
            : '<tr><td colspan="5" class="analysis-table-empty">No relationships were found in the selected scope.</td></tr>';
    }

    return { renderResult, renderCompilePlan, renderReportStorage, renderAiReport };
}
