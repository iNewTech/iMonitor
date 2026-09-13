/** Owns the compact knowledge-index choice and protected provider settings. */
export function initKnowledgeIndexSettings({ root }) {
    const panel = root.querySelector('#settings-knowledge-index-panel');
    const dialog = root.querySelector('#settings-knowledge-index-dialog');
    const form = root.querySelector('#settings-knowledge-index-form');
    const manageButton = root.querySelector('#settings-knowledge-index-manage');
    const closeButton = root.querySelector('#settings-knowledge-index-close');
    const cancelButton = root.querySelector('#settings-knowledge-index-cancel');
    const testButton = root.querySelector('#settings-knowledge-index-test');
    const backendInput = root.querySelector('#settings-knowledge-index-backend');
    const endpointInput = root.querySelector('#settings-knowledge-index-endpoint');
    const collectionInput = root.querySelector('#settings-knowledge-index-collection');
    const apiKeyInput = root.querySelector('#settings-knowledge-index-api-key');
    const secretNote = root.querySelector('#settings-knowledge-index-secret-note');
    const summaryStatus = root.querySelector('#settings-knowledge-index-summary-status');
    const summaryName = root.querySelector('#settings-knowledge-index-name');
    const summaryCopy = root.querySelector('#settings-knowledge-index-copy');
    const health = root.querySelector('#settings-knowledge-index-health');
    const status = root.querySelector('#settings-knowledge-index-status');
    const dialogStatus = root.querySelector('#settings-knowledge-index-dialog-status');
    let snapshot = null;

    function setStatus(element, message, isError = false) {
        if (!element) return;
        element.textContent = message;
        element.dataset.tone = isError ? 'error' : 'normal';
    }

    function activeCatalogEntry() {
        return snapshot?.catalog?.find((entry) => entry.backend === snapshot.settings?.backend);
    }

    function renderBackendOptions() {
        if (!backendInput) return;
        backendInput.innerHTML = '';
        (snapshot?.catalog || []).forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.backend;
            option.textContent = entry.available ? entry.label : `${entry.label} · not installed`;
            option.disabled = !entry.available;
            backendInput.append(option);
        });
        backendInput.value = snapshot?.settings?.backend || 'local';
    }

    function render() {
        if (!snapshot?.settings) return;
        const entry = activeCatalogEntry();
        const currentHealth = snapshot.health;
        renderBackendOptions();
        if (endpointInput) endpointInput.value = snapshot.settings.endpoint || '';
        if (collectionInput) collectionInput.value = snapshot.settings.collection || '';
        if (apiKeyInput) apiKeyInput.value = '';
        if (secretNote) secretNote.textContent = snapshot.settings.apiKeyConfigured
            ? 'A key is configured. Leave this blank to keep it. Secrets stay in protected main-process storage.'
            : 'No key is currently configured. Secrets stay in protected main-process storage.';
        if (summaryName) summaryName.textContent = entry?.label || 'Local lexical index';
        if (summaryCopy) summaryCopy.textContent = entry?.description || 'Private on this machine and available offline for exact IBM i identifiers.';
        if (summaryStatus) summaryStatus.textContent = currentHealth?.state === 'ready' ? 'Ready' : currentHealth?.state || 'Checking';
        if (health) health.textContent = currentHealth?.message || 'Checking knowledge index.';
        updateFormState();
    }

    function updateFormState() {
        const isLocal = backendInput?.value === 'local';
        [endpointInput, apiKeyInput].forEach((input) => {
            if (input) input.disabled = isLocal;
        });
        if (collectionInput) collectionInput.disabled = false;
        if (testButton) testButton.disabled = !isLocal;
    }

    function openDialog() {
        if (!(dialog instanceof HTMLDialogElement)) return;
        render();
        setStatus(dialogStatus, '');
        if (!dialog.open) dialog.showModal();
    }

    function closeDialog() {
        if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
    }

    async function refresh() {
        setStatus(status, 'Loading knowledge storage...');
        try {
            snapshot = await window.electronAPI.getKnowledgeIndexSettings();
            if (!snapshot?.success) throw new Error(snapshot?.error || 'Unable to load knowledge storage.');
            render();
            setStatus(status, snapshot.health?.message || 'Knowledge storage is ready.');
        } catch (error) {
            setStatus(status, error instanceof Error ? error.message : 'Unable to load knowledge storage.', true);
        }
    }

    backendInput?.addEventListener('change', () => {
        updateFormState();
        if (backendInput.value !== 'local') {
            setStatus(dialogStatus, 'This adapter is not installed yet. Local lexical retrieval remains active.', true);
        } else {
            setStatus(dialogStatus, '');
        }
    });
    manageButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDialog();
    });
    closeButton?.addEventListener('click', closeDialog);
    cancelButton?.addEventListener('click', closeDialog);
    dialog?.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog();
    });
    testButton?.addEventListener('click', async () => {
        testButton.disabled = true;
        setStatus(dialogStatus, 'Testing local retrieval...');
        try {
            const result = await window.electronAPI.testKnowledgeIndexConnection();
            setStatus(dialogStatus, result.success ? result.health?.message || 'Connection is ready.' : result.error || 'Connection test failed.', !result.success);
        } catch (error) {
            setStatus(dialogStatus, error instanceof Error ? error.message : 'Connection test failed.', true);
        } finally {
            updateFormState();
        }
    });
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const saveButton = form.querySelector('button[type="submit"]');
        if (saveButton) saveButton.disabled = true;
        setStatus(dialogStatus, 'Saving knowledge storage...');
        try {
            const result = await window.electronAPI.saveKnowledgeIndexSettings({
                backend: backendInput?.value || 'local',
                endpoint: endpointInput?.value || '',
                collection: collectionInput?.value || '',
                apiKey: apiKeyInput?.value || ''
            });
            if (!result.success) {
                setStatus(dialogStatus, result.error || 'Knowledge storage could not be saved.', true);
                return;
            }
            snapshot = result;
            render();
            setStatus(status, 'Knowledge storage saved.');
            closeDialog();
        } catch (error) {
            setStatus(dialogStatus, error instanceof Error ? error.message : 'Knowledge storage could not be saved.', true);
        } finally {
            if (saveButton) saveButton.disabled = false;
            updateFormState();
        }
    });

    return { refresh };
}
