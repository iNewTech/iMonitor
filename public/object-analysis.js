import { applyTheme, escapeHtml } from './connection/shared.js';
import { createReportView } from './object-analysis/report-view.js';
import { createAnalysisActions } from './object-analysis/actions.js';

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
        loadSourceResult: document.getElementById('load-object-source-result'),
        sourcePreview: document.getElementById('analysis-source-preview'),
        sourcePreviewTitle: document.getElementById('analysis-source-preview-title'),
        sourcePreviewMeta: document.getElementById('analysis-source-preview-meta'),
        sourcePreviewCode: document.getElementById('analysis-source-preview-code'),
        copySource: document.getElementById('copy-object-source'),
        hideSource: document.getElementById('hide-object-source'),
        run: document.getElementById('run-object-analysis'),
        compile: document.getElementById('generate-compile-plan'),
        compileResult: document.getElementById('generate-compile-plan-result'),
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
        sourceSignals: document.getElementById('analysis-source-signals'),
        businessSection: document.getElementById('analysis-business-section'),
        businessCount: document.getElementById('analysis-business-count'),
        businessSummary: document.getElementById('analysis-business-summary'),
        businessFindings: document.getElementById('analysis-business-findings'),
        flowSection: document.getElementById('analysis-flow-section'),
        flowCount: document.getElementById('analysis-flow-count'),
        programFlow: document.getElementById('analysis-program-flow'),
        callGraphCount: document.getElementById('analysis-call-graph-count'),
        callGraph: document.getElementById('analysis-call-graph'),
        conversionSection: document.getElementById('analysis-conversion-section'),
        conversionCount: document.getElementById('analysis-conversion-count'),
        conversionPlan: document.getElementById('analysis-conversion-plan'),
        compileSection: document.getElementById('analysis-compile-section'),
        compileCount: document.getElementById('analysis-compile-count'),
        compileStorage: document.getElementById('analysis-compile-storage'),
        compilePlan: document.getElementById('analysis-compile-plan'),
        compileCl: document.getElementById('analysis-compile-cl'),
        copyCompileCl: document.getElementById('copy-compile-cl'),
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
    let workspaceRevision = 0;
    let selectedFile = null;
    let latestResult = null;
    let scopeDirty = false;
    let libraryBaseline = [];
    let libraryListOrigin = { source: 'detected', fileName: null };

    const sidebarWidthStorageKey = 'imonitor.object-analysis.sidebar-width';


    const view = createReportView(elements, () => settings);
    const actions = createAnalysisActions({
        elements, view, setStatus,
        getSelection: () => selectedFile,
        getResult: () => latestResult,
        setResult: (result) => { latestResult = result; },
        isScopeDirty: () => scopeDirty
    });

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
        actions.sync();
    }

    function handleScopeEdit() {
        scopeDirty = hasScopeChanges();
        actions.invalidate();
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

    async function loadWorkspace() {
        const version = ++workspaceRevision;
        actions.invalidate();
        selectedFile = null;
        latestResult = null;
        workspace = null;
        elements.selection.hidden = true;
        elements.result.hidden = true;
        elements.tree.textContent = 'Loading sources…';
        elements.tree.setAttribute('aria-busy', 'true');
        actions.sync();
        if (elements.sourcePreview) elements.sourcePreview.hidden = true;
        setStatus(settings.source === 'ibmi' ? 'Loading the selected IBM i source library…' : 'Loading the selected local directory…');
        try {
            const loadedSettings = await window.electronAPI.getObjectAnalysisSettings();
            if (version !== workspaceRevision) return;
            settings = loadedSettings;
            libraryDraft = activeLibraries().slice();
            scopeDirty = false;
            try {
                const libraryInfo = await window.electronAPI.getObjectAnalysisLibraryList({
                    source: settings.source,
                    localDirectory: settings.localDirectory
                });
                if (version !== workspaceRevision) return;
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
                if (version !== workspaceRevision) return;
                libraryBaseline = activeLibraries().slice();
                libraryListOrigin = { source: settings.source === 'ibmi' ? 'environment' : 'detected', fileName: null };
            }
            renderScope();
            const response = await window.electronAPI.getObjectAnalysisWorkspace();
            if (version !== workspaceRevision) return;
            if (!response?.success || !response.tree) throw new Error(response?.error || 'The analysis workspace could not be loaded.');
            workspace = response;
            selectedFile = null;
            latestResult = null;
            elements.selection.hidden = true;
            elements.result.hidden = true;
            elements.empty.hidden = false;
            elements.run.disabled = true;
            actions.sync();
            renderWorkspace();
            setStatus('Select an RPG or database source to begin.', 'success');
        } catch (error) {
            if (version !== workspaceRevision) return;
            workspace = null;
            selectedFile = null;
            latestResult = null;
            elements.selection.hidden = true;
            elements.result.hidden = true;
            elements.empty.hidden = false;
            elements.run.disabled = true;
            setStatus(error instanceof Error ? error.message : String(error), 'error');
            elements.rootLabel.textContent = settings.source === 'ibmi' ? 'IBM i workspace unavailable' : 'Local workspace unavailable';
            elements.treeCount.textContent = '0 files';
            elements.tree.innerHTML = '<p class="analysis-tree-empty">Unable to load sources. Check the directory or source library, then use Refresh scan.</p>';
            actions.sync();
        } finally {
            if (version === workspaceRevision) elements.tree.removeAttribute('aria-busy');
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
        actions.invalidate();
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
        actions.sync();
        renderTree();
        return true;
    }

    elements.tree?.addEventListener('click', (event) => {
        const actionButton = event.target.closest?.('[data-analysis-action="true"]');
        const fileButton = event.target.closest?.('[data-analysis-file="true"]');
        if (!selectSourceFile(fileButton)) return;
        if (actionButton) void actions.analyze();
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
        setButtonBusy(elements.chooseDirectory, true, 'Selecting…', 'Choose directory');
        try {
            const selectedDirectory = await window.electronAPI.selectObjectAnalysisDirectory();
            if (!selectedDirectory) return;
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
