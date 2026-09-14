/** Owns the compact Storage health panel and its maintenance actions. */
export function initObservabilitySettings({ root }) {
    const field = (name) => root.querySelector(`#settings-aiab-${name}`);
    const summary = field('health-summary');
    const status = field('observability-status');
    const retention = field('retention');
    const buttons = ['save-retention', 'reindex', 'export', 'purge'].map(field).filter(Boolean);
    let busy = false;

    const setText = (name, value) => { const element = field(name); if (element) element.textContent = value; };
    const setStatus = (message, error = false) => {
        if (!status) return;
        status.textContent = message;
        status.dataset.tone = error ? 'error' : 'normal';
    };
    const requireSuccess = (result) => {
        if (!result?.success) throw new Error(result?.error || 'The operation could not be completed.');
        return result;
    };
    const retentionDays = () => {
        const days = Number(retention?.value);
        if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Enter a retention period between 1 and 3650 days.');
        return days;
    };
    const formatBytes = (value = 0) => value < 1024 ? `${value} B`
        : value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;

    async function loadHealth() {
        const health = requireSuccess(await window.electronAPI.getAiabObservability());
        const { knowledge = {}, model = {}, mcp = {}, snapshot = {}, settings = {} } = health;
        const local = knowledge.local || {};
        const reasons = [...(snapshot.degradedReasons || []), ...(mcp.reasons || [])];
        if (knowledge.health?.state && knowledge.health.state !== 'ready') reasons.push(knowledge.health.message);
        if (model.state === 'unavailable') reasons.push(model.message);
        const warnings = reasons.filter(Boolean);
        setText('health-summary', warnings.length ? 'Needs attention' : 'Healthy');
        setText('record-count', String(local.recordCount ?? 0));
        setText('index-size', formatBytes(local.byteCount));
        setText('pending', String(local.pendingIndexing ?? 0));
        setText('model-health', model.state === 'ready' ? `${model.provider} · ready` : model.state || 'Unknown');
        setText('mcp-health', `${mcp.ready ?? 0}/${mcp.enabled ?? 0} ready`);
        const lastUpdate = local.lastReindexedAt || snapshot.newestAt;
        setText('last-update', lastUpdate ? new Date(lastUpdate).toLocaleString() : 'None yet');
        if (retention) retention.value = String(settings.retentionDays || 30);
        setStatus(warnings.length ? warnings.slice(0, 2).join(' · ') : `Telemetry events: ${snapshot.eventCount || 0}. Prompts and secrets are not stored.`);
    }

    async function refresh() {
        setStatus('Loading AI + ActionBoard health...');
        try {
            await loadHealth();
        } catch (error) {
            setStatus(error.message || 'Health is unavailable.', true);
            if (summary) summary.textContent = 'Unavailable';
        }
    }

    // Maintenance actions share one busy state so repeated clicks cannot overlap dialogs or writes.
    async function runAction(message, action, reload = false) {
        if (busy) return;
        busy = true;
        buttons.forEach((button) => { button.disabled = true; });
        setStatus(message);
        try {
            const completed = await action();
            if (reload) await loadHealth();
            setStatus(completed);
        } catch (error) {
            setStatus(error.message || 'The operation could not be completed.', true);
        } finally {
            busy = false;
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    field('save-retention')?.addEventListener('click', () => runAction('Saving retention...', async () => {
        requireSuccess(await window.electronAPI.saveAiabObservabilitySettings({ retentionDays: retentionDays() }));
        return 'Telemetry retention saved.';
    }, true));

    field('reindex')?.addEventListener('click', () => runAction('Rebuilding the scoped index...', async () => {
        requireSuccess(await window.electronAPI.reindexKnowledge());
        return 'Scoped index rebuilt.';
    }, true));

    field('export')?.addEventListener('click', () => runAction('Exporting scoped evidence...', async () => {
        const knowledge = await window.electronAPI.exportKnowledge();
        if (knowledge?.canceled) return 'Export canceled.';
        requireSuccess(knowledge);
        const telemetry = await window.electronAPI.exportAiabObservability();
        if (telemetry?.canceled) return 'Knowledge exported. Telemetry export canceled.';
        requireSuccess(telemetry);
        return 'Scoped evidence and redacted telemetry exported.';
    }));

    field('purge')?.addEventListener('click', () => runAction('Preparing purge...', async () => {
        const days = retentionDays();
        if (!window.confirm(`Purge scoped evidence and telemetry older than ${days} days? This cannot be undone.`)) return 'Purge canceled.';
        const before = new Date(Date.now() - days * 86400000).toISOString();
        // Finish each write before starting the next; report failures without losing the controls.
        const knowledge = requireSuccess(await window.electronAPI.purgeKnowledge({ before, confirmed: true }));
        const partial = `Purged ${knowledge.deletedCount || 0} knowledge records.`;
        const expectedContext = knowledge.expectedContext;
        if (!expectedContext || !['customerScope', 'systemScope', 'operatorId'].every((key) => (
            typeof expectedContext[key] === 'string' && expectedContext[key].trim()
        )) || !['local-owner', 'delegated'].includes(expectedContext.identity)) {
            throw new Error(`${partial} Telemetry purge was not started because the confirmed context is unavailable. Refresh and retry.`);
        }
        let telemetry;
        try {
            telemetry = requireSuccess(await window.electronAPI.purgeAiabObservability({ before, confirmed: true, expectedContext }));
        } catch (error) {
            throw new Error(`${partial} Telemetry purge failed: ${error.message || 'The operation could not be completed.'}`);
        }
        const completed = `Purged ${knowledge.deletedCount || 0} knowledge records and ${telemetry.deletedCount || 0} telemetry events.`;
        try {
            await loadHealth();
        } catch (error) {
            throw new Error(`${completed} Health refresh failed: ${error.message || 'Health is unavailable.'}`);
        }
        return completed;
    }));

    return { refresh };
}
