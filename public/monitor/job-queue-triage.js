function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

const statusLabels = {
    running: 'Running', completed: 'Ready for review', partial: 'Review needed',
    failed: 'Read failed', interrupted: 'Resuming', clear: 'Clear'
};

export function initQueueTriage({ root, electronAPI }) {
    const panel = root.getElementById('job-queue-triage');
    const statusElement = root.getElementById('job-queue-triage-status');
    const list = root.getElementById('job-queue-triage-list');
    if (!panel || !statusElement || !list || !electronAPI?.getQueueTriage) {
        return { refresh: async () => {} };
    }

    let results = [];

    function render() {
        const actionable = results.filter((result) => result.status !== 'clear');
        if (!actionable.length) {
            statusElement.textContent = 'No held queues need read-only triage.';
            list.innerHTML = '<li class="job-queue-triage-empty"><i class="bi bi-check2-circle" aria-hidden="true"></i> The latest scan is clear.</li>';
            return;
        }
        statusElement.textContent = `${actionable.length} held queue${actionable.length === 1 ? '' : 's'} checked automatically. No queue action was run.`;
        list.innerHTML = actionable.map((result) => {
            const latest = result.checks?.[result.checks.length - 1];
            return `<li class="job-queue-triage-item" data-triage-status="${escapeHtml(result.status)}">
                <div><strong>${escapeHtml(result.queueLibrary)}/${escapeHtml(result.queueName)}</strong>
                    <span>${escapeHtml(statusLabels[result.status] || result.status)}</span></div>
                <p>${escapeHtml(result.expectedOutcome)}</p>
                <small>${escapeHtml(latest?.summary || 'Read-only checks are starting…')}</small>
            </li>`;
        }).join('');
    }

    async function refresh() {
        try {
            const response = await electronAPI.getQueueTriage();
            if (!response?.success) throw new Error(response?.error || 'Unable to load queue triage.');
            results = Array.isArray(response.results) ? response.results : [];
            render();
        } catch (error) {
            statusElement.textContent = error instanceof Error ? error.message : 'Unable to load queue triage.';
        }
    }

    electronAPI.onQueueTriageUpdated?.((nextResults) => {
        results = Array.isArray(nextResults) ? nextResults : [];
        render();
    });
    void refresh();
    return { refresh };
}
