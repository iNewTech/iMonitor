/** Owns compact AI + ActionBoard health and retention controls. */
export function initObservabilitySettings({ root }) {
    const summary = root.querySelector('#settings-aiab-health-summary');
    const recordCount = root.querySelector('#settings-aiab-record-count');
    const indexSize = root.querySelector('#settings-aiab-index-size');
    const pending = root.querySelector('#settings-aiab-pending');
    const modelHealth = root.querySelector('#settings-aiab-model-health');
    const mcpHealth = root.querySelector('#settings-aiab-mcp-health');
    const lastUpdate = root.querySelector('#settings-aiab-last-update');
    const status = root.querySelector('#settings-aiab-observability-status');
    const retention = root.querySelector('#settings-aiab-retention');
    let snapshot;

    const formatBytes = (value) => {
        const bytes = Number(value) || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };
    const formatDate = (value) => value ? new Date(value).toLocaleString() : 'None yet';
    const setStatus = (message, error = false) => {
        if (!status) return;
        status.textContent = message;
        status.dataset.tone = error ? 'error' : 'normal';
    };

    function render() {
        const local = snapshot?.knowledge?.local || {};
        const index = snapshot?.knowledge || {};
        const model = snapshot?.model || {};
        const mcp = snapshot?.mcp || {};
        const reasons = [
            ...(Array.isArray(index.health?.state) ? [] : index.health?.state && index.health.state !== 'ready' ? [index.health.message] : []),
            ...(Array.isArray(mcp.reasons) ? mcp.reasons : []),
            ...(model.state && model.state !== 'ready' ? [model.message] : [])
        ].filter(Boolean);
        if (summary) summary.textContent = reasons.length ? 'Needs attention' : 'Healthy';
        if (recordCount) recordCount.textContent = String(local.recordCount ?? 0);
        if (indexSize) indexSize.textContent = formatBytes(local.byteCount);
        if (pending) pending.textContent = String(local.pendingIndexing ?? 0);
        if (modelHealth) modelHealth.textContent = model.state === 'ready' ? `${model.provider} · ready` : model.state || 'Unknown';
        if (mcpHealth) mcpHealth.textContent = `${mcp.ready ?? 0}/${mcp.enabled ?? 0} ready`;
        if (lastUpdate) lastUpdate.textContent = formatDate(local.lastReindexedAt || snapshot?.snapshot?.newestAt);
        if (retention) retention.value = String(snapshot?.settings?.retentionDays || 30);
        setStatus(reasons.length ? reasons.slice(0, 2).join(' · ') : `Telemetry events: ${snapshot?.snapshot?.eventCount || 0}. Prompts and secrets are not stored.`);
    }

    async function refresh() {
        setStatus('Loading AI + ActionBoard health...');
        try {
            snapshot = await window.electronAPI.getAiabObservability();
            if (!snapshot?.success) throw new Error(snapshot?.error || 'Health is unavailable.');
            render();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Health is unavailable.', true);
            if (summary) summary.textContent = 'Unavailable';
        }
    }

    root.querySelector('#settings-aiab-save-retention')?.addEventListener('click', async () => {
        const button = root.querySelector('#settings-aiab-save-retention');
        if (button) button.disabled = true;
        try {
            const result = await window.electronAPI.saveAiabObservabilitySettings({ retentionDays: Number(retention?.value || 30) });
            if (!result.success) throw new Error(result.error || 'Retention could not be saved.');
            setStatus('Telemetry retention saved.');
            await refresh();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Retention could not be saved.', true);
        } finally {
            if (button) button.disabled = false;
        }
    });

    root.querySelector('#settings-aiab-reindex')?.addEventListener('click', async () => {
        setStatus('Rebuilding the scoped index...');
        const result = await window.electronAPI.reindexKnowledge();
        if (!result.success) setStatus(result.error || 'Index rebuild failed.', true);
        else { setStatus('Scoped index rebuilt.'); await refresh(); }
    });

    root.querySelector('#settings-aiab-export')?.addEventListener('click', async () => {
        const knowledge = await window.electronAPI.exportKnowledge();
        if (!knowledge.success) {
            setStatus(knowledge.error || 'Knowledge export failed.', true);
            return;
        }
        const telemetry = await window.electronAPI.exportAiabObservability();
        if (!telemetry.success) setStatus(telemetry.error || 'Telemetry export failed.', true);
        else setStatus('Scoped evidence and redacted telemetry exported.');
    });

    root.querySelector('#settings-aiab-purge')?.addEventListener('click', async () => {
        const days = Math.max(1, Number(retention?.value || 30));
        const before = new Date(Date.now() - days * 86400000).toISOString();
        if (!window.confirm(`Purge scoped evidence and telemetry older than ${days} days? This cannot be undone.`)) return;
        const [knowledge, telemetry] = await Promise.all([
            window.electronAPI.purgeKnowledge({ before, confirmed: true }),
            window.electronAPI.purgeAiabObservability({ before, confirmed: true })
        ]);
        if (!knowledge.success || !telemetry.success) setStatus(knowledge.error || telemetry.error || 'Purge failed.', true);
        else { setStatus(`Purged ${knowledge.deletedCount || 0} knowledge records and ${telemetry.deletedCount || 0} telemetry events.`); await refresh(); }
    });

    return { refresh };
}
