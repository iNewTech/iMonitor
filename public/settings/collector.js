/** Owns the compact background collection and retention controls. */
export function initCollectorSettings({ root }) {
    const form = root.querySelector('#settings-collector-form');
    const enabled = root.querySelector('#settings-collector-enabled');
    const startup = root.querySelector('#settings-collector-startup');
    const connection = root.querySelector('#settings-collector-connection');
    const interval = root.querySelector('#settings-collector-interval');
    const retention = root.querySelector('#settings-collector-retention');
    const storage = root.querySelector('#settings-collector-storage');
    const status = root.querySelector('#settings-collector-status');
    const summaryStatus = root.querySelector('#settings-collector-summary-status');
    const inventory = root.querySelector('#settings-collector-inventory');
    const refreshButton = root.querySelector('#settings-collector-refresh');
    const purgeButton = root.querySelector('#settings-collector-purge');
    let settings;

    const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    };

    const formatBytes = (bytes) => bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

    function render(nextStatus) {
        settings = nextStatus?.settings || settings;
        if (!settings) return;
        if (enabled) enabled.checked = settings.enabled;
        if (startup) startup.checked = settings.startWithSystem;
        if (connection) connection.value = settings.connectionId;
        if (interval) interval.value = String(Math.round(settings.intervalMs / 1000));
        if (retention) retention.value = String(settings.retentionDays);
        if (storage) storage.value = String(settings.maxStorageMb);
        const state = nextStatus?.state || (settings.enabled ? 'stopped' : 'disabled');
        if (summaryStatus) summaryStatus.textContent = state === 'running' ? 'Running' : state === 'degraded' ? 'Needs attention' : settings.enabled ? 'Ready' : 'Off';
        setStatus(state === 'running'
            ? `Collecting read-only monitoring data. Last write: ${nextStatus?.health?.lastSuccessfulWriteAt || 'waiting for first poll'}.`
            : nextStatus?.lastError || 'Background collection is ready to configure.');
    }

    async function refresh() {
        try {
            const [nextSettings, nextStatus, nextInventory] = await Promise.all([
                window.electronAPI.getCollectorSettings(),
                window.electronAPI.getCollectorStatus(),
                window.electronAPI.getCollectionInventory()
            ]);
            settings = nextSettings;
            render({ ...nextStatus, settings: nextSettings });
            if (inventory) inventory.textContent = `${nextInventory.recordCount} records · ${formatBytes(nextInventory.byteCount)}`;
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to load collector settings.', true);
        }
    }

    async function loadConnections() {
        if (!connection) return;
        const selected = settings?.connectionId || connection.value;
        const connections = await window.electronAPI.loadConnections();
        connection.innerHTML = '<option value="">Choose a saved profile</option>';
        (Array.isArray(connections) ? connections : []).forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.name} · ${item.user}@${item.host}`;
            connection.append(option);
        });
        connection.value = selected;
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        setStatus('Saving collector settings...');
        try {
            const nextStatus = await window.electronAPI.saveCollectorSettings({
                enabled: Boolean(enabled?.checked),
                startWithSystem: Boolean(startup?.checked),
                connectionId: connection?.value || '',
                intervalMs: Math.max(1, Number(interval?.value || 5)) * 1000,
                retentionDays: Number(retention?.value || 30),
                maxStorageMb: Number(storage?.value || 1024)
            });
            render(nextStatus);
            setStatus(nextStatus.lastError || (nextStatus.state === 'running'
                ? 'Collecting read-only monitoring data.'
                : 'Collector settings saved.'));
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save collector settings.', true);
        } finally {
            if (button) button.disabled = false;
        }
    });

    refreshButton?.addEventListener('click', () => refresh());
    purgeButton?.addEventListener('click', async () => {
        const preview = await window.electronAPI.previewCollectionPurge();
        if (!preview.matchingRecordCount) {
            setStatus('There are no collected records to purge.');
            return;
        }
        const confirmed = window.confirm(`Remove ${preview.matchingRecordCount} collected records (${formatBytes(preview.matchingByteCount)})? This cannot be undone.`);
        if (!confirmed) return;
        const result = await window.electronAPI.purgeCollection(true);
        if (!result.success) {
            setStatus(result.error || 'Unable to purge collection.', true);
            return;
        }
        setStatus(`Purged ${result.summary?.matchingRecordCount || 0} records.`);
        await refresh();
    });

    window.electronAPI.onCollectorStatusUpdated((nextStatus) => render(nextStatus));

    return { refresh: async () => { await refresh(); await loadConnections(); } };
}
