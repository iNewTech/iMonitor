import { applyTheme, escapeHtml } from './connection/shared.js';
import { renderAiReportMarkdown } from './monitor/ibmeyeai/render.js';

document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        connectionStatus: document.getElementById('analysis-connection-status'),
        rootLabel: document.getElementById('analysis-root-label'),
        search: document.getElementById('analysis-search'),
        sourceButtons: Array.from(document.querySelectorAll('[data-analysis-source]')),
        workspaceLayout: document.querySelector('.analysis-workspace'),
        sidebarResizer: document.getElementById('analysis-sidebar-resizer'),
        localSource: document.getElementById('analysis-local-source'),
        ibmiSource: document.getElementById('analysis-ibmi-source'),
        localDirectory: document.getElementById('analysis-local-directory'),
        chooseDirectory: document.getElementById('analysis-choose-directory'),
        sourceLibraryInput: document.getElementById('analysis-source-library-input'),
        loadSourceLibrary: document.getElementById('analysis-load-source-library'),
        libraryLabel: document.getElementById('analysis-library-label'),
        libraryInput: document.getElementById('analysis-library-input'),
        libraryOrder: document.getElementById('analysis-library-order'),
        addLibraryInput: document.getElementById('analysis-add-library-input'),
        addLibrary: document.getElementById('analysis-add-library'),
        refreshLibraryList: document.getElementById('analysis-refresh-library-list'),
        libraryDropdownLabel: document.getElementById('analysis-library-dropdown-label'),
        libraryListStatus: document.getElementById('analysis-library-list-status'),
        librarySourceStatus: document.getElementById('analysis-library-source-status'),
        libraryListStatusDetail: document.getElementById('analysis-library-list-status-detail'),
        loadLibraries: document.getElementById('analysis-load-libraries'),
        saveLibraries: document.getElementById('analysis-save-libraries'),
        scopeBadge: document.getElementById('analysis-scope-badge'),
        scopeCount: document.getElementById('analysis-scope-count'),
        libraryChips: document.getElementById('analysis-library-chips'),
        scopeState: document.getElementById('analysis-scope-state'),
        scopeHelp: document.getElementById('analysis-scope-help'),
        depth: document.getElementById('analysis-depth'),
        maxNodes: document.getElementById('analysis-max-nodes'),
        tree: document.getElementById('analysis-tree'),
        treeHeading: document.querySelector('.analysis-tree-heading span:first-child'),
        treeCount: document.getElementById('analysis-tree-count'),
        status: document.getElementById('analysis-status'),
        empty: document.getElementById('analysis-empty'),
        selection: document.getElementById('analysis-selection'),
        selectionType: document.getElementById('analysis-selection-type'),
        selectionTitle: document.getElementById('analysis-selection-title'),
        selectionPath: document.getElementById('analysis-selection-path'),
        selectionScope: document.getElementById('analysis-selection-scope'),
        loadSource: document.getElementById('load-object-source'),
        sourcePreview: document.getElementById('analysis-source-preview'),
        sourcePreviewTitle: document.getElementById('analysis-source-preview-title'),
        sourcePreviewMeta: document.getElementById('analysis-source-preview-meta'),
        sourcePreviewCode: document.getElementById('analysis-source-preview-code'),
        copySource: document.getElementById('copy-object-source'),
        hideSource: document.getElementById('hide-object-source'),
        run: document.getElementById('run-object-analysis'),
        result: document.getElementById('analysis-result'),
        resultTitle: document.getElementById('analysis-result-title'),
        resultSubtitle: document.getElementById('analysis-result-subtitle'),
        resultScope: document.getElementById('analysis-result-scope'),
        evidenceStatus: document.getElementById('analysis-evidence-status'),
        reportStorage: document.getElementById('analysis-report-storage'),
        readiness: document.getElementById('analysis-readiness'),
        readinessScore: document.getElementById('analysis-readiness-score'),
        dependencies: document.getElementById('analysis-dependencies'),
        impacted: document.getElementById('analysis-impacted'),
        unresolved: document.getElementById('analysis-unresolved'),
        blockers: document.getElementById('analysis-blockers'),
        warnings: document.getElementById('analysis-warnings'),
        confirmed: document.getElementById('analysis-confirmed'),
        edgeCount: document.getElementById('analysis-edge-count'),
        dependencyBody: document.getElementById('analysis-dependency-body'),
        dependencyTree: document.getElementById('analysis-dependency-tree'),
        sourceSignals: document.getElementById('analysis-source-signals'),
        businessSection: document.getElementById('analysis-business-section'),
        businessCount: document.getElementById('analysis-business-count'),
        businessSummary: document.getElementById('analysis-business-summary'),
        businessFindings: document.getElementById('analysis-business-findings'),
        flowSection: document.getElementById('analysis-flow-section'),
        flowCount: document.getElementById('analysis-flow-count'),
        programFlow: document.getElementById('analysis-program-flow'),
        conversionSection: document.getElementById('analysis-conversion-section'),
        conversionCount: document.getElementById('analysis-conversion-count'),
        conversionPlan: document.getElementById('analysis-conversion-plan'),
        aiButton: document.getElementById('analyze-business-logic'),
        aiSection: document.getElementById('analysis-ai-section'),
        aiMeta: document.getElementById('analysis-ai-meta'),
        aiContent: document.getElementById('analysis-ai-content'),
        approve: document.getElementById('approve-object-analysis'),
        download: document.getElementById('download-analysis-report'),
        back: document.getElementById('analysis-back'),
        refresh: document.getElementById('analysis-refresh')
    };

    let settings = {
        source: 'local',
        localDirectory: '',
        libraryList: [],
        libraries: [],
        sourceLibrary: null,
        dependencyDepth: 2,
        maxNodes: 100,
        cacheSourceLocally: false
    };
    let libraryDraft = [];
    let workspace = null;
    let selectedFile = null;
    let latestResult = null;
    let scopeDirty = false;
    let libraryBaseline = [];
    let libraryListOrigin = { source: 'detected', fileName: null };

    const sidebarWidthStorageKey = 'imonitor.object-analysis.sidebar-width';

    function setSidebarWidth(value, persist = true) {
        if (!elements.workspaceLayout) return;
        const bounds = elements.workspaceLayout.getBoundingClientRect();
        const minimum = 250;
        const maximum = Math.max(minimum, Math.min(520, bounds.width * 0.5));
        const width = Math.round(Math.max(minimum, Math.min(maximum, Number(value) || 330)));
        elements.workspaceLayout.style.setProperty('--analysis-sidebar-width', `${width}px`);
        if (elements.sidebarResizer) {
            elements.sidebarResizer.setAttribute('aria-valuemin', String(minimum));
            elements.sidebarResizer.setAttribute('aria-valuemax', String(Math.round(maximum)));
            elements.sidebarResizer.setAttribute('aria-valuenow', String(width));
        }
        if (persist) window.localStorage.setItem(sidebarWidthStorageKey, String(width));
    }

    function setupResizableSidebar() {
        const savedWidth = Number(window.localStorage.getItem(sidebarWidthStorageKey));
        setSidebarWidth(savedWidth || 330, false);
        if (!elements.sidebarResizer || !elements.workspaceLayout) return;
        let dragging = false;
        let pointerId = null;
        const updateFromPointer = (clientX) => {
            const bounds = elements.workspaceLayout.getBoundingClientRect();
            setSidebarWidth(clientX - bounds.left, true);
        };
        elements.sidebarResizer.addEventListener('pointerdown', (event) => {
            dragging = true;
            pointerId = event.pointerId;
            elements.sidebarResizer.setPointerCapture?.(pointerId);
            document.body.classList.add('is-resizing-analysis-sidebar');
            updateFromPointer(event.clientX);
            event.preventDefault();
        });
        elements.sidebarResizer.addEventListener('pointermove', (event) => {
            if (dragging && event.pointerId === pointerId) updateFromPointer(event.clientX);
        });
        const stopDragging = () => {
            dragging = false;
            pointerId = null;
            document.body.classList.remove('is-resizing-analysis-sidebar');
        };
        elements.sidebarResizer.addEventListener('pointerup', stopDragging);
        elements.sidebarResizer.addEventListener('pointercancel', stopDragging);
        elements.sidebarResizer.addEventListener('keydown', (event) => {
            const current = Number(elements.sidebarResizer.getAttribute('aria-valuenow')) || 330;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setSidebarWidth(current + (event.key === 'ArrowRight' ? 16 : -16));
            }
        });
    }

    function setStatus(message, tone = 'info') {
        if (!elements.status) return;
        elements.status.hidden = !message;
        elements.status.textContent = message || '';
        elements.status.dataset.tone = tone;
    }

    function setButtonBusy(button, busy, busyLabel, idleLabel) {
        if (!button) return;
        button.disabled = busy;
        if (idleLabel) {
            if (!button.dataset.iconHtml) button.dataset.iconHtml = button.querySelector('i')?.outerHTML || '';
            button.innerHTML = `${button.dataset.iconHtml}${busy ? busyLabel : idleLabel}`;
        }
    }

    function parseLibraries(value) {
        return Array.from(new Set(String(value || '')
            .split(',')
            .map((library) => library.trim().toUpperCase())
            .filter(Boolean)));
    }

    function activeLibraries() {
        const list = Array.isArray(settings.libraryList) && settings.libraryList.length ? settings.libraryList : settings.libraries;
        return Array.isArray(list) ? list : [];
    }

    function libraryCountLabel(count) {
        return `${count} librar${count === 1 ? 'y' : 'ies'}`;
    }

    function hasScopeChanges() {
        const active = activeLibraries();
        const sameLibraries = libraryDraft.length === active.length && libraryDraft.every((library, index) => library === active[index]);
        return !sameLibraries
            || Number(elements.depth?.value) !== Number(settings.dependencyDepth)
            || Number(elements.maxNodes?.value) !== Number(settings.maxNodes);
    }

    function sameLibraries(left, right) {
        return left.length === right.length && left.every((library, index) => library === right[index]);
    }

    function renderLibrarySourceStatus() {
        if (!elements.librarySourceStatus) return;
        const active = activeLibraries();
        const fileName = libraryListOrigin.fileName || 'setup.json';
        if (libraryListOrigin.source === 'setup-file') {
            elements.librarySourceStatus.textContent = sameLibraries(active, libraryBaseline)
                ? `Loaded from ${fileName}. Changes apply to this session only until you save permanently.`
                : `Using the session list. ${fileName} is unchanged until you save permanently.`;
            return;
        }
        if (libraryListOrigin.source === 'environment') {
            elements.librarySourceStatus.textContent = sameLibraries(active, libraryBaseline)
                ? 'Loaded from the IBM i environment. Changes apply to this session only.'
                : 'Using the session list. The IBM i environment library list has not been changed.';
            return;
        }
        elements.librarySourceStatus.textContent = sameLibraries(active, libraryBaseline)
            ? 'No setup file found. Detected libraries are active; save permanently to create setup.json.'
            : 'Using the session list. Save permanently to create or update setup.json.';
    }

    function renderLibraryEditor(syncText = true) {
        if (elements.libraryOrder) {
            elements.libraryOrder.innerHTML = libraryDraft.length
                ? libraryDraft.map((library, index) => `
                    <li class="analysis-library-order-item">
                        <span class="analysis-library-sequence">${index + 1}</span>
                        <strong>${escapeHtml(library)}</strong>
                        <span class="analysis-library-order-actions">
                            <button type="button" class="btn btn-icon-sm" data-library-move="up" data-library-index="${index}" aria-label="Move ${escapeHtml(library)} up" ${index === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up" aria-hidden="true"></i></button>
                            <button type="button" class="btn btn-icon-sm" data-library-move="down" data-library-index="${index}" aria-label="Move ${escapeHtml(library)} down" ${index === libraryDraft.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down" aria-hidden="true"></i></button>
                            <button type="button" class="btn btn-icon-sm is-danger" data-library-remove="true" data-library-index="${index}" aria-label="Remove ${escapeHtml(library)}"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
                        </span>
                    </li>
                `).join('')
                : '<li class="analysis-library-order-empty">Add at least one library to define the object search scope.</li>';
        }
        if (syncText && elements.libraryInput && document.activeElement !== elements.libraryInput) elements.libraryInput.value = libraryDraft.join(', ');
        const label = libraryDraft.length ? `${libraryCountLabel(libraryDraft.length)} · ${libraryDraft[0]} first` : 'No libraries selected';
        if (elements.libraryDropdownLabel) elements.libraryDropdownLabel.textContent = label;
        if (elements.libraryListStatus) elements.libraryListStatus.textContent = libraryCountLabel(libraryDraft.length);
    }

    function renderScopeSummary() {
        const libraries = activeLibraries();
        if (elements.scopeBadge) {
            elements.scopeBadge.textContent = scopeDirty ? 'Changes not applied' : `${libraryCountLabel(libraries.length)} active`;
            elements.scopeBadge.classList.toggle('is-dirty', scopeDirty);
        }
        renderLibrarySourceStatus();
        if (elements.run && selectedFile) elements.run.disabled = scopeDirty;
    }

    function handleScopeEdit() {
        scopeDirty = hasScopeChanges();
        if (scopeDirty && latestResult) {
            latestResult = null;
            elements.result.hidden = true;
            elements.empty.hidden = Boolean(selectedFile);
            elements.selection.hidden = !selectedFile;
        }
        renderScopeSummary();
        if (elements.libraryListStatusDetail) elements.libraryListStatusDetail.textContent = scopeDirty
            ? 'Draft changes are ready. Apply for this session, or save permanently.'
            : 'The active list is ready for this session. The setup file is unchanged.';
    }

    function fileIcon(node) {
        if (node.kind === 'database') return 'bi-table';
        if (node.language === 'RPGLE') return 'bi-file-earmark-code';
        return 'bi-file-earmark-text';
    }

    function nodeMatches(node, query) {
        if (!query) return true;
        return `${node.name} ${node.relativePath} ${node.library || ''}`.toLowerCase().includes(query);
    }

    function renderTreeNode(node, query, depth = 0) {
        const children = Array.isArray(node.children) ? node.children.map((child) => renderTreeNode(child, query, depth + 1)).filter(Boolean) : [];
        if (node.kind === 'directory' ? !children.length && !nodeMatches(node, query) : !nodeMatches(node, query)) return '';
        if (node.kind === 'directory') {
            return `<details class="analysis-tree-folder"${depth < 4 || query ? ' open' : ''}><summary><span class="analysis-tree-folder-label"><i class="bi bi-folder2-open" aria-hidden="true"></i>${escapeHtml(node.name)}</span><span class="analysis-tree-count">${children.length}</span></summary><div class="analysis-tree-children">${children.join('')}</div></details>`;
        }
        const analyzable = node.analyzable === true;
        const analysisAction = analyzable
            ? '<button type="button" class="analysis-tree-analyze-button" data-analysis-action="true" title="Analyze this source" aria-label="Analyze this source"><i class="bi bi-graph-up-arrow" aria-hidden="true"></i></button>'
            : '';
        return `<div class="analysis-tree-file${selectedFile?.relativePath === node.relativePath && selectedFile?.library === node.library ? ' is-selected' : ''}${analyzable ? '' : ' is-muted'}" data-analysis-file="true" data-library="${escapeHtml(node.library || '')}" data-path="${escapeHtml(node.relativePath)}" data-analyzable="${analyzable ? 'true' : 'false'}" role="button" tabindex="${analyzable ? '0' : '-1'}" aria-disabled="${analyzable ? 'false' : 'true'}"><i class="bi ${fileIcon(node)}" aria-hidden="true"></i><span class="analysis-tree-file-copy"><strong>${escapeHtml(node.name)}</strong><small>${escapeHtml(node.language || 'File')}</small></span>${analysisAction}</div>`;
    }

    function renderTree() {
        if (!elements.tree || !workspace?.tree) return;
        const query = String(elements.search?.value || '').trim().toLowerCase();
        elements.tree.innerHTML = (workspace.tree.children || []).map((node) => renderTreeNode(node, query)).filter(Boolean).join('') || '<p class="analysis-tree-empty">No matching source files.</p>';
    }

    function renderScope() {
        elements.sourceButtons.forEach((button) => {
            const active = button.dataset.analysisSource === settings.source;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        elements.localSource.hidden = settings.source !== 'local';
        elements.ibmiSource.hidden = settings.source !== 'ibmi';
        if (elements.saveLibraries) elements.saveLibraries.hidden = settings.source === 'ibmi';
        elements.localDirectory.textContent = settings.localDirectory || 'Demo master library';
        if (elements.sourceLibraryInput && document.activeElement !== elements.sourceLibraryInput) elements.sourceLibraryInput.value = settings.sourceLibrary || activeLibraries()[0] || '';
        if (elements.libraryLabel) elements.libraryLabel.textContent = 'Object search library list';
        if (elements.scopeHelp) elements.scopeHelp.textContent = settings.source === 'ibmi'
            ? 'Order matters: the first matching object is used for unqualified references.'
            : 'Order matters: local object lookups follow this same list.';
        if (elements.depth) elements.depth.value = String(settings.dependencyDepth);
        if (elements.maxNodes) elements.maxNodes.value = String(settings.maxNodes);
        renderLibraryEditor();
        renderScopeSummary();
    }

    function renderWorkspace() {
        if (!workspace) return;
        elements.rootLabel.textContent = `${workspace.rootLabel} · ${workspace.masterLibrary}`;
        elements.treeCount.textContent = `${workspace.sourceFileCount + workspace.databaseFileCount} files`;
        elements.connectionStatus.textContent = settings.source === 'local' ? 'Local directory' : 'IBM i source library';
        if (elements.treeHeading) elements.treeHeading.textContent = settings.source === 'ibmi' ? `Source members · ${settings.sourceLibrary || activeLibraries()[0] || 'Choose a library'}` : 'Loaded source tree';
        renderScope();
        renderTree();
    }

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

    function renderDependencyTree(result, nodeById) {
        if (!elements.dependencyTree) return;
        const childrenById = new Map();
        result.edges.forEach((edge) => {
            const children = childrenById.get(edge.from) || [];
            children.push({ edge, node: nodeById.get(edge.to) });
            childrenById.set(edge.from, children);
        });
        const renderNode = (node, path = []) => {
            if (!node) return '';
            const children = childrenById.get(node.id) || [];
            const cycle = path.includes(node.id);
            const childMarkup = !cycle && children.length
                ? `<ul>${children.map(({ edge, node: child }) => `<li class="analysis-dependency-tree-branch"><span class="analysis-dependency-tree-relationship">${escapeHtml(edge.relationship)}</span>${renderNode(child, [...path, node.id])}</li>`).join('')}</ul>`
                : '';
            const tone = dependencyTone(node.type, node.status);
            return `<div class="analysis-dependency-tree-node${node.status === 'unresolved' ? ' is-unresolved' : ''}" data-category="${tone}"><div class="analysis-dependency-tree-label"><span class="analysis-inline-badge" data-category="${tone}">${escapeHtml(node.type)}</span><strong>${escapeHtml(`${node.library}/${node.name}`)}</strong>${cycle ? '<small>cycle</small>' : ''}</div>${childMarkup}</div>`;
        };
        elements.dependencyTree.innerHTML = result.edges.length
            ? `<div class="analysis-dependency-tree-intro">${escapeHtml(`${result.root.library}/${result.root.name}`)} is the starting object. Expand each branch to follow its dependencies.</div><div class="analysis-dependency-tree-root">${renderNode(result.root)}</div>`
            : '<p class="analysis-table-empty">No dependency path was found in the selected scope.</p>';
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
            section.open = !section.id || ['analysis-business-section', 'analysis-flow-section', 'analysis-conversion-section'].includes(section.id);
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

    function renderReportStorage(result) {
        if (!elements.reportStorage) return;
        const artifact = result.reportArtifact;
        const approved = result.approval?.status === 'approved' && artifact?.mode !== 'error';
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
        latestResult = result;
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
        renderConversionPlan(result);
        elements.readiness.textContent = result.readiness.label;
        elements.readiness.dataset.status = result.readiness.status;
        elements.readinessScore.textContent = `${result.readiness.score}/100 confidence score`;
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
        renderDependencyTree(result, nodeById);
    }

    async function loadWorkspace() {
        setStatus(settings.source === 'ibmi' ? 'Loading the selected IBM i source library…' : 'Loading the selected local directory…');
        try {
            settings = await window.electronAPI.getObjectAnalysisSettings();
            libraryDraft = activeLibraries().slice();
            scopeDirty = false;
            try {
                const libraryInfo = await window.electronAPI.getObjectAnalysisLibraryList({
                    source: settings.source,
                    localDirectory: settings.localDirectory
                });
                if (libraryInfo?.success && Array.isArray(libraryInfo.libraries)) {
                    libraryBaseline = parseLibraries(libraryInfo.libraries.join(','));
                    libraryListOrigin = {
                        source: libraryInfo.source || (settings.source === 'ibmi' ? 'environment' : 'detected'),
                        fileName: libraryInfo.fileName || null
                    };
                } else {
                    libraryBaseline = activeLibraries().slice();
                }
            } catch {
                libraryBaseline = activeLibraries().slice();
                libraryListOrigin = { source: settings.source === 'ibmi' ? 'environment' : 'detected', fileName: null };
            }
            renderScope();
            const response = await window.electronAPI.getObjectAnalysisWorkspace();
            if (!response?.success || !response.tree) throw new Error(response?.error || 'The analysis workspace could not be loaded.');
            workspace = response;
            selectedFile = null;
            latestResult = null;
            elements.selection.hidden = true;
            elements.result.hidden = true;
            elements.empty.hidden = false;
            elements.run.disabled = true;
            renderWorkspace();
            setStatus('Select an RPG or database source to begin.', 'success');
        } catch (error) {
            workspace = null;
            selectedFile = null;
            latestResult = null;
            elements.selection.hidden = true;
            elements.result.hidden = true;
            elements.empty.hidden = false;
            elements.run.disabled = true;
            setStatus(error instanceof Error ? error.message : String(error), 'error');
            elements.rootLabel.textContent = settings.source === 'ibmi' ? 'IBM i workspace unavailable' : 'Local workspace unavailable';
            elements.tree.innerHTML = '<p class="analysis-tree-empty">Choose a source and load a valid scope to continue.</p>';
        }
    }

    async function refreshEnvironmentLibraries(apply = false, options = {}) {
        const response = await window.electronAPI.getObjectAnalysisLibraryList({ source: options.source || settings.source, localDirectory: options.localDirectory ?? settings.localDirectory });
        if (!response?.success || !Array.isArray(response.libraries) || !response.libraries.length) throw new Error(response?.error || 'No libraries were found in this environment.');
        libraryDraft = parseLibraries(response.libraries.join(','));
        renderLibraryEditor();
        handleScopeEdit();
        if (apply) {
            settings = await window.electronAPI.saveObjectAnalysisSettings({
                libraryList: libraryDraft,
                libraries: libraryDraft,
                sourceLibrary: settings.source === 'ibmi'
                    ? (settings.sourceLibrary && libraryDraft.includes(settings.sourceLibrary) ? settings.sourceLibrary : libraryDraft[0])
                    : null
            });
            scopeDirty = false;
        }
        return libraryDraft;
    }

    elements.search?.addEventListener('input', renderTree);

    function selectSourceFile(fileButton) {
        if (!fileButton || fileButton.dataset.analyzable !== 'true') return false;
        selectedFile = { library: fileButton.dataset.library, relativePath: fileButton.dataset.path, name: fileButton.querySelector('strong')?.textContent || fileButton.dataset.path, language: fileButton.querySelector('small')?.textContent || 'Source' };
        elements.selection.hidden = false;
        elements.empty.hidden = true;
        elements.result.hidden = true;
        elements.selectionType.textContent = selectedFile.language;
        elements.selectionTitle.textContent = selectedFile.name;
        elements.selectionPath.textContent = `${selectedFile.library} · ${selectedFile.relativePath}`;
        elements.selectionScope.textContent = `Object scope: ${activeLibraries().join(', ') || 'No libraries applied'}${settings.source === 'ibmi' ? ` · source library: ${settings.sourceLibrary || selectedFile.library}` : ''}`;
        latestResult = null;
        if (elements.sourcePreview) elements.sourcePreview.hidden = true;
        if (elements.sourcePreviewCode) elements.sourcePreviewCode.textContent = '';
        if (elements.sourcePreviewTitle) elements.sourcePreviewTitle.textContent = '';
        if (elements.sourcePreviewMeta) elements.sourcePreviewMeta.textContent = '';
        if (elements.loadSource) elements.loadSource.disabled = false;
        elements.run.disabled = scopeDirty;
        renderTree();
        return true;
    }

    async function loadSelectedSource() {
        if (!selectedFile) return;
        setButtonBusy(elements.loadSource, true, 'Loading…', 'Load source');
        setStatus(`Loading ${selectedFile.name}…`);
        try {
            const response = await window.electronAPI.loadObjectAnalysisSource({
                library: selectedFile.library,
                relativePath: selectedFile.relativePath
            });
            if (!response?.success || typeof response.content !== 'string') {
                throw new Error(response?.error || 'The source file could not be loaded.');
            }
            if (elements.sourcePreviewTitle) elements.sourcePreviewTitle.textContent = selectedFile.name;
            if (elements.sourcePreviewMeta) {
                elements.sourcePreviewMeta.textContent = `${selectedFile.library} · ${selectedFile.relativePath} · ${response.lineCount || response.content.split(/\r?\n/).length} lines`;
            }
            if (elements.sourcePreviewCode) elements.sourcePreviewCode.textContent = response.content;
            if (elements.sourcePreview) elements.sourcePreview.hidden = false;
            setStatus(`${selectedFile.name} loaded. Review the source, then run the complete analysis.`, 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.loadSource, false, '', 'Load source');
        }
    }

    async function analyzeSelectedFile() {
        if (!selectedFile) return;
        if (scopeDirty) {
            setStatus('Apply the library list before analyzing this object.', 'error');
            return;
        }
        setButtonBusy(elements.run, true, 'Analyzing…', 'Analyze object');
        setStatus(`Tracing ${selectedFile.name} across the selected libraries…`);
        try {
            const response = await window.electronAPI.analyzeObject({ library: selectedFile.library, relativePath: selectedFile.relativePath });
            if (!response?.success || !response.result) throw new Error(response?.error || 'The object could not be analyzed.');
            renderResult(response.result);
            setStatus('Analysis complete. Confirm the review notes before conversion.', 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.run, false, '', 'Analyze object');
        }
    }

    elements.tree?.addEventListener('click', (event) => {
        const actionButton = event.target.closest?.('[data-analysis-action="true"]');
        const fileButton = event.target.closest?.('[data-analysis-file="true"]');
        if (!selectSourceFile(fileButton)) return;
        if (actionButton) void analyzeSelectedFile();
    });

    elements.tree?.addEventListener('keydown', (event) => {
        if (event.target.closest?.('[data-analysis-action="true"]')) return;
        const fileButton = event.target.closest?.('[data-analysis-file="true"]');
        if ((event.key === 'Enter' || event.key === ' ') && selectSourceFile(fileButton)) {
            event.preventDefault();
        }
    });

    elements.libraryOrder?.addEventListener('click', (event) => {
        const moveButton = event.target.closest?.('[data-library-move]');
        const removeButton = event.target.closest?.('[data-library-remove]');
        const index = Number((moveButton || removeButton)?.dataset.libraryIndex);
        if (!Number.isInteger(index) || index < 0 || index >= libraryDraft.length) return;
        if (moveButton) {
            const target = moveButton.dataset.libraryMove === 'up' ? index - 1 : index + 1;
            if (target >= 0 && target < libraryDraft.length) [libraryDraft[index], libraryDraft[target]] = [libraryDraft[target], libraryDraft[index]];
        } else if (removeButton) libraryDraft.splice(index, 1);
        renderLibraryEditor();
        handleScopeEdit();
    });

    elements.addLibrary?.addEventListener('click', () => {
        const additions = parseLibraries(elements.addLibraryInput?.value);
        const newLibraries = additions.filter((library) => !libraryDraft.includes(library));
        if (!newLibraries.length) {
            setStatus('Enter a new library name to add. Existing libraries are kept only once.', 'error');
            return;
        }
        libraryDraft.push(...newLibraries);
        elements.addLibraryInput.value = '';
        renderLibraryEditor();
        handleScopeEdit();
        setStatus(`${newLibraries.join(', ')} added to the draft list. Apply the list when ready.`);
    });

    elements.addLibraryInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            elements.addLibrary?.click();
        }
    });

    elements.libraryInput?.addEventListener('input', () => {
        libraryDraft = parseLibraries(elements.libraryInput.value);
        renderLibraryEditor(false);
        handleScopeEdit();
    });
    [elements.depth, elements.maxNodes].forEach((control) => control?.addEventListener('change', handleScopeEdit));
    elements.libraryInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            elements.loadLibraries?.click();
        }
    });

    elements.sourceButtons.forEach((button) => button.addEventListener('click', async () => {
        const source = button.dataset.analysisSource;
        if (source !== 'local' && source !== 'ibmi') return;
        try {
            settings = await window.electronAPI.saveObjectAnalysisSettings({
                source,
                sourceLibrary: source === 'ibmi' ? settings.sourceLibrary : null
            });
            libraryDraft = activeLibraries().slice();
            renderScope();
            if (source === 'ibmi') await refreshEnvironmentLibraries(true, { source: 'ibmi' });
            await loadWorkspace();
        } catch (error) {
            renderScope();
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
    }));

    elements.chooseDirectory?.addEventListener('click', async () => {
        const selectedDirectory = await window.electronAPI.selectObjectAnalysisDirectory();
        if (!selectedDirectory) return;
        setButtonBusy(elements.chooseDirectory, true, 'Selecting…', 'Choose directory');
        try {
            settings = await window.electronAPI.saveObjectAnalysisSettings({ source: 'local', localDirectory: selectedDirectory, sourceLibrary: null });
            libraryDraft = activeLibraries().slice();
            await refreshEnvironmentLibraries(true, { source: 'local', localDirectory: selectedDirectory });
            await loadWorkspace();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.chooseDirectory, false, '', 'Choose directory');
        }
    });

    elements.loadSourceLibrary?.addEventListener('click', async () => {
        const sourceLibrary = parseLibraries(elements.sourceLibraryInput?.value)[0];
        if (!sourceLibrary) {
            setStatus('Enter one IBM i source library name.', 'error');
            elements.sourceLibraryInput?.focus();
            return;
        }
        setButtonBusy(elements.loadSourceLibrary, true, 'Loading…', 'Load source');
        try {
            settings = await window.electronAPI.saveObjectAnalysisSettings({ source: 'ibmi', sourceLibrary });
            await loadWorkspace();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.loadSourceLibrary, false, '', 'Load source');
        }
    });

    elements.refreshLibraryList?.addEventListener('click', async () => {
        setButtonBusy(elements.refreshLibraryList, true, 'Refreshing…', 'Refresh from environment');
        try {
            await refreshEnvironmentLibraries(false);
            setStatus('Environment libraries loaded into the draft list. Review the order, then apply it.', 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.refreshLibraryList, false, '', 'Refresh from environment');
        }
    });

    elements.loadLibraries?.addEventListener('click', async () => {
        if (!libraryDraft.length) {
            setStatus('Add at least one library to the object search list.', 'error');
            return;
        }
        setButtonBusy(elements.loadLibraries, true, 'Applying…', 'Apply for this session');
        try {
            settings = await window.electronAPI.saveObjectAnalysisSettings({ libraryList: libraryDraft, libraries: libraryDraft, dependencyDepth: Number(elements.depth?.value), maxNodes: Number(elements.maxNodes?.value) });
            scopeDirty = false;
            await loadWorkspace();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.loadLibraries, false, '', 'Apply for this session');
        }
    });

    elements.saveLibraries?.addEventListener('click', async () => {
        if (!libraryDraft.length) {
            setStatus('Add at least one library before saving the setup file.', 'error');
            return;
        }
        setButtonBusy(elements.saveLibraries, true, 'Saving…', 'Save permanently');
        try {
            const response = await window.electronAPI.saveObjectAnalysisLibraryList(libraryDraft);
            if (!response?.success || !response.settings) throw new Error(response?.error || 'The setup file could not be saved.');
            settings = response.settings;
            libraryDraft = activeLibraries().slice();
            libraryBaseline = libraryDraft.slice();
            libraryListOrigin = { source: 'setup-file', fileName: response.fileName || 'setup.json' };
            scopeDirty = false;
            await loadWorkspace();
            setStatus(`Saved ${response.fileName || 'setup.json'}. This is now the default library list for this directory.`, 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.saveLibraries, false, '', 'Save permanently');
        }
    });

    elements.loadSource?.addEventListener('click', () => void loadSelectedSource());
    elements.copySource?.addEventListener('click', async () => {
        const source = elements.sourcePreviewCode?.textContent || '';
        if (!source) return;
        try {
            await navigator.clipboard.writeText(source);
            setStatus('Source copied to the clipboard.', 'success');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'The source could not be copied.', 'error');
        }
    });
    elements.hideSource?.addEventListener('click', () => {
        if (elements.sourcePreview) elements.sourcePreview.hidden = true;
    });
    elements.run?.addEventListener('click', () => void analyzeSelectedFile());

    elements.approve?.addEventListener('click', async () => {
        if (!latestResult || !selectedFile || latestResult.approval?.status === 'approved') return;
        setButtonBusy(elements.approve, true, 'Saving…', 'Approve & map report');
        setStatus(`Approving and mapping ${latestResult.root.library}/${latestResult.root.name}…`);
        try {
            const response = await window.electronAPI.approveObjectAnalysis({
                library: selectedFile.library,
                relativePath: selectedFile.relativePath
            }, latestResult);
            if (!response?.success || !response.result) throw new Error(response?.error || 'The approved report could not be saved.');
            latestResult = response.result;
            renderReportStorage(latestResult);
            setStatus(`Approved report saved and mapped to ${latestResult.reportArtifact?.key}.`, 'success');
        } catch (error) {
            if (latestResult) latestResult.approval = { status: 'draft' };
            renderReportStorage(latestResult || {});
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            if (latestResult?.approval?.status !== 'approved') setButtonBusy(elements.approve, false, '', 'Approve & map report');
        }
    });

    elements.aiButton?.addEventListener('click', async () => {
        if (!latestResult || !selectedFile) return;
        setButtonBusy(elements.aiButton, true, 'Preparing…', 'Explain with IBMEye AI');
        if (elements.aiSection) {
            elements.aiSection.hidden = false;
            elements.aiSection.open = true;
        }
        if (elements.aiMeta) elements.aiMeta.textContent = 'Working…';
        if (elements.aiContent) elements.aiContent.innerHTML = '<p class="ai-report-pending"><i class="bi bi-hourglass-split me-2"></i>Reading the source and confirmed dependency evidence…</p>';
        try {
            const response = await window.electronAPI.analyzeObjectWithAi({
                library: selectedFile.library,
                relativePath: selectedFile.relativePath
            }, latestResult);
            if (!response?.success || !response.reply) throw new Error(response?.error || 'IBMEye AI could not complete the business analysis.');
            latestResult = response.result || latestResult;
            latestResult.aiReport ||= {
                content: response.reply,
                providerLabel: response.availability?.providerLabel || 'IBMEye AI',
                model: response.availability?.selectedModel || 'configured model',
                generatedAt: new Date().toISOString()
            };
            renderAiReport(latestResult.aiReport);
            renderReportStorage(latestResult);
            setStatus('Business logic report added. Download the combined report when ready.', 'success');
        } catch (error) {
            if (elements.aiMeta) elements.aiMeta.textContent = 'Analysis unavailable';
            if (elements.aiContent) elements.aiContent.innerHTML = `<p class="ai-report-error">${escapeHtml(error?.message || 'Unable to complete the business analysis.')}</p>`;
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setButtonBusy(elements.aiButton, false, '', 'Explain with IBMEye AI');
        }
    });

    elements.download?.addEventListener('click', async () => {
        if (!latestResult) return;
        elements.download.disabled = true;
        try {
            const response = await window.electronAPI.saveObjectAnalysisReport(latestResult);
            setStatus(response.success ? `Report saved to ${response.filePath}.` : (response.error || 'Report was not saved.'), response.success ? 'success' : 'error');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            elements.download.disabled = false;
        }
    });

    elements.refresh?.addEventListener('click', () => void loadWorkspace());
    elements.back?.addEventListener('click', async () => {
        try {
            const connection = await window.electronAPI.getConnectionState();
            if (connection?.isConnected) await window.electronAPI.navigateToMonitor();
            else await window.electronAPI.navigateToConnection();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
    });

    setupResizableSidebar();

    try {
        const theme = await window.electronAPI.getThemeSettings();
        applyTheme(theme.themeId);
    } catch {
        applyTheme('operator-light');
    }
    await loadWorkspace();
});
