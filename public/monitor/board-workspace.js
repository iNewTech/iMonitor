/** Compact workspace chrome and per-profile view preferences; no operational writes. */
export function initBoardWorkspace({ getViewState, restoreViewState, clearAiScope, aiAssistant }) {
    const root = document;
    const get = id => root.getElementById(id);
    const widget = get('ibmeyeai-widget');
    const companion = get('board-companion-toggle');
    const density = get('board-density');
    const scrollArea = get('system-stats');
    const draft = get('ai-assistant-input');
    let storageKey = '';
    let systemName = 'System';
    let restoredScroll = null;
    const closeMenus = (except) => root.querySelectorAll('.board-menu[open], .board-model-menu[open], .ai-attach-menu[open], .hero-theme-menu[open]').forEach(menu => {
        if (menu !== except && !menu.contains(except)) menu.open = false;
    });
    root.addEventListener('click', event => {
        const menu = event.target.closest('.board-menu, .board-model-menu, .ai-attach-menu, .hero-theme-menu');
        closeMenus(menu);
        if (event.target.closest('#board-workspace-menu button')) get('board-workspace-menu').open = false;
    });
    root.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const menu = event.target.closest('details[open]');
        if (menu?.matches('.board-menu, .board-model-menu, .ai-attach-menu, .hero-theme-menu')) {
            menu.open = false;
            menu.querySelector('summary')?.focus();
            event.preventDefault();
        }
    });
    root.querySelectorAll('[data-board-target]').forEach(button => button.addEventListener('click', () => {
        const target = { jobs: '.actionboard-jobs-panel', history: '#board-history-panel', incidents: '.alerts-panel' }[button.dataset.boardTarget];
        const panel = root.querySelector(target);
        if (!panel) return;
        panel.hidden = false;
        panel.open = true;
        panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    companion?.addEventListener('click', () => {
        widget.hidden = !widget.hidden;
        companion.setAttribute('aria-pressed', String(!widget.hidden));
        companion.innerHTML = `<i class="bi bi-stars" aria-hidden="true"></i>${widget.hidden ? 'Show' : 'Hide'} floating IBMEye`;
        if (!widget.hidden) aiAssistant.openWidget?.();
    });
    density?.addEventListener('change', () => {
        document.body.dataset.density = density.value;
        save();
    });
    get('board-ai-scope')?.addEventListener('click', clearAiScope);
    get('board-collector-status')?.addEventListener('click', () => window.electronAPI.navigateToSettings());
    function renderCollector(status) {
        const target = get('board-collector-status');
        if (!target) return;
        const states = { running: 'Collecting in background', starting: 'Starting background collection…', stopped: 'Background collection stopped', degraded: 'Background collection needs attention', disabled: 'Background collection off' };
        target.textContent = status?.lastError ? 'Background collection needs attention' : states[status?.state] || 'Background collection status unavailable';
        target.title = status?.lastError || 'Manage background collection and storage in Settings';
        target.classList.toggle('is-error', Boolean(status?.lastError));
    }
    void window.electronAPI.getCollectorStatus?.().then(renderCollector).catch(() => renderCollector({ lastError: 'Unable to read collection status. Open Settings to retry.' }));
    window.electronAPI.onCollectorStatusUpdated?.(renderCollector);

    function save() {
        if (!storageKey) return;
        try { sessionStorage.setItem(storageKey, JSON.stringify({ ...getViewState(), draft: draft.value, density: density.value, scrollTop: scrollArea.scrollTop })); } catch { /* View preferences are optional. */ }
    }
    scrollArea?.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', save);
    draft.addEventListener('input', save);
    return {
        save,
        connect(connection) {
            systemName = connection.name || connection.host || 'System';
            // Never persist credentials or share view state across operators/systems.
            storageKey = `imonitor-board:${JSON.stringify([connection.name, connection.host, connection.port, connection.user])}`;
            try {
                const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
                if (saved && typeof saved === 'object') {
                    restoreViewState(saved);
                    if (typeof saved.draft === 'string') {
                        draft.value = saved.draft;
                        draft.dispatchEvent(new Event('input'));
                    }
                    density.value = saved.density === 'compact' ? 'compact' : 'comfortable';
                    document.body.dataset.density = density.value;
                    restoredScroll = Number(saved.scrollTop) || 0;
                }
            } catch { /* Ignore corrupt view preferences. */ }
        },
        afterRender(selectedJobName) {
            const scope = get('board-ai-scope');
            scope.textContent = selectedJobName ? `${selectedJobName.split('/').pop()} ×` : systemName;
            scope.title = selectedJobName ? `AI context: ${selectedJobName}. Click to return to system context.` : `AI context: ${systemName}`;
            get('ai-assistant-input').placeholder = selectedJobName ? 'Ask IBMEye about this job…' : 'Ask IBMEye about this system…';
            if (restoredScroll !== null && scrollArea.querySelector('.job-row')) {
                scrollArea.scrollTop = restoredScroll;
                restoredScroll = null;
            }
        }
    };
}
