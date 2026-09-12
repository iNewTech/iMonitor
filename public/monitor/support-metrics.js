const DAY_MS = 24 * 60 * 60 * 1000;

/** Owns the compact support-outcomes panel on the ActionBoard. */
export function initSupportMetrics({ root = document, electronAPI = window.electronAPI } = {}) {
    const panel = root.getElementById('support-outcomes-panel');
    const fromInput = root.getElementById('support-metrics-from');
    const toInput = root.getElementById('support-metrics-to');
    const refreshButton = root.getElementById('support-metrics-refresh');
    const exportButton = root.getElementById('support-metrics-export');
    const status = root.getElementById('support-metrics-status');
    const windowLabel = root.getElementById('support-metrics-window');
    const sampleLabel = root.getElementById('support-metrics-sample');
    const cards = root.getElementById('support-metrics-cards');
    const stages = root.getElementById('support-metrics-stages');
    const baseline = root.getElementById('support-metrics-baseline');
    let latestReport = null;
    let loaded = false;

    if (!panel || !fromInput || !toInput || !electronAPI?.getSupportMetrics) {
        return { refresh: async () => undefined };
    }

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * DAY_MS);
    fromInput.value = toDateInputValue(weekAgo);
    toInput.value = toDateInputValue(today);

    function requestWindow() {
        const from = localDateInputToIso(fromInput.value, false);
        const to = localDateInputToIso(toInput.value, true);
        return { from, to, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }

    async function refresh() {
        const range = requestWindow();
        if (!range.from || !range.to) {
            setStatus('Choose a valid date range.', true);
            return;
        }

        setBusy(true);
        setStatus('Measuring recorded support outcomes…');
        try {
            const response = await electronAPI.getSupportMetrics(range);
            if (!response?.success || !response.report) {
                throw new Error(response?.error || 'Support outcomes could not be loaded.');
            }
            latestReport = response.report;
            loaded = true;
            renderReport(latestReport);
            setStatus('Measured from recorded incident timelines and AI requests.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Support outcomes could not be loaded.', true);
        } finally {
            setBusy(false);
        }
    }

    function renderReport(report) {
        const summary = report.summary;
        if (windowLabel) windowLabel.textContent = `${formatDate(report.window.from)} – ${formatDate(report.window.to)}`;
        if (sampleLabel) sampleLabel.textContent = `${summary.incidentCount} incident${summary.incidentCount === 1 ? '' : 's'}`;
        if (cards) {
            cards.innerHTML = [
                metricCard('Incidents', summary.incidentCount, 'recorded in window'),
                metricCard('Resolved', summary.resolvedCount, `${summary.unknownOutcomeCount} unknown outcome${summary.unknownOutcomeCount === 1 ? '' : 's'}`),
                metricCard('Reopened', summary.reopenedCount, 'recurrence signals'),
                metricCard('AI availability', formatPercent(report.aiAvailability.availabilityPercent), `${report.aiAvailability.sampleSize} request checks`),
                metricCard('Verified recovery', report.stages.verifiedRecovery.averageMinutes === null ? '—' : `${report.stages.verifiedRecovery.averageMinutes}m`, `${report.stages.verifiedRecovery.measured}/${report.stages.verifiedRecovery.sampleSize} measured`),
                metricCard('Autonomous recovery', '0', 'future scope; operator action remains explicit')
            ].join('');
        }
        if (stages) {
            stages.innerHTML = [
                stageCard('Triage', report.stages.triage),
                stageCard('Acknowledgement', report.stages.acknowledgement),
                stageCard('Investigation', report.stages.investigation),
                stageCard('Verified recovery', report.stages.verifiedRecovery),
                stageCard('Escalation', report.stages.escalation),
                stageCard('Recurrence', report.stages.recurrence)
            ].join('');
        }
        if (baseline) {
            const comparison = report.baseline?.comparison;
            baseline.textContent = comparison
                ? `Compared with the previous equal window: ${signed(comparison.incidentCountDelta)} incidents, ${signed(comparison.resolvedCountDelta)} resolved, ${formatDelta(comparison.recoveryMinutesDelta, 'm')} verified recovery.`
                : 'No baseline comparison available.';
        }
    }

    function metricCard(label, value, note) {
        return `<article class="support-metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></article>`;
    }

    function stageCard(label, stage) {
        const average = stage.averageMinutes === null ? '—' : `${stage.averageMinutes}m`;
        return `<article class="support-stage-card"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(average)} average</span><small>${stage.measured}/${stage.sampleSize} measured · ${stage.unknown} unknown</small></article>`;
    }

    function setBusy(busy) {
        [refreshButton, exportButton].forEach((button) => {
            if (button) button.disabled = busy;
        });
    }

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('text-danger', isError);
    }

    refreshButton?.addEventListener('click', () => void refresh());
    fromInput.addEventListener('change', () => { if (loaded) void refresh(); });
    toInput.addEventListener('change', () => { if (loaded) void refresh(); });
    panel.addEventListener('toggle', () => {
        if (panel.open && !loaded) void refresh();
    });
    exportButton?.addEventListener('click', async () => {
        setBusy(true);
        setStatus('Preparing the customer-scoped report…');
        try {
            const response = await electronAPI.exportSupportMetrics(requestWindow());
            if (response?.canceled) {
                setStatus('Export cancelled.');
            } else if (!response?.success) {
                throw new Error(response?.error || 'Support outcomes could not be exported.');
            } else {
                setStatus('Customer-scoped report saved.');
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Support outcomes could not be exported.', true);
        } finally {
            setBusy(false);
        }
    });

    return { refresh };
}

function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function localDateInputToIso(value, endOfDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return null;
    if (endOfDay) date.setDate(date.getDate() + 1);
    return date.toISOString();
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

function formatPercent(value) {
    return value === null ? '—' : `${value}%`;
}

function formatDelta(value, suffix) {
    return value === null ? '—' : `${signed(value)}${suffix}`;
}

function signed(value) {
    return value > 0 ? `+${value}` : String(value);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
