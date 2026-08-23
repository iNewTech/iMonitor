document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-monitoring');
    const stopButton = document.getElementById('stop-monitoring');
    const disconnectButton = document.getElementById('disconnect');
    const refreshInterval = document.getElementById('refresh-interval');
    const systemStats = document.getElementById('system-stats');
    const activityLog = document.getElementById('activity-log');
    const openLogsFolderButton = document.getElementById('open-logs-folder');
    const shareActivityLogButton = document.getElementById('share-activity-log');
    const downloadActivityLogButton = document.getElementById('download-activity-log');
    const activityLogExportStatus = document.getElementById('activity-log-export-status');
    const activeAlerts = document.getElementById('active-alerts');
    const alertCount = document.getElementById('alert-count');
    const alertSettingsForm = document.getElementById('alert-settings-form');
    const desktopNotifications = document.getElementById('desktop-notifications');
    const watchHighCpu = document.getElementById('watch-high-cpu');
    const highCpuThreshold = document.getElementById('high-cpu-threshold');
    const watchMessageWait = document.getElementById('watch-message-wait');
    const watchLockWait = document.getElementById('watch-lock-wait');
    const watchFailedPolls = document.getElementById('watch-failed-polls');
    const watchDisconnects = document.getElementById('watch-disconnects');
    const jobsHistoryChart = document.getElementById('jobs-history-chart');
    const jobsHistoryValue = document.getElementById('jobs-history-value');
    const jobsHistoryNote = document.getElementById('jobs-history-note');
    const cpuHistoryChart = document.getElementById('cpu-history-chart');
    const cpuHistoryValue = document.getElementById('cpu-history-value');
    const cpuHistoryNote = document.getElementById('cpu-history-note');
    const waitHistoryChart = document.getElementById('wait-history-chart');
    const waitHistoryValue = document.getElementById('wait-history-value');
    const waitHistoryNote = document.getElementById('wait-history-note');
    const drawerOverlay = document.getElementById('job-drawer-overlay');
    const jobDrawer = document.getElementById('job-detail-drawer');
    const closeJobDrawer = document.getElementById('close-job-drawer');
    const jobDetailTitle = document.getElementById('job-detail-title');
    const jobDetailSubtitle = document.getElementById('job-detail-subtitle');
    const jobDetailEmpty = document.getElementById('job-detail-empty');
    const jobDetailContent = document.getElementById('job-detail-content');
    const detailQualifiedJob = document.getElementById('detail-qualified-job');
    const detailSubsystem = document.getElementById('detail-subsystem');
    const detailCurrentUser = document.getElementById('detail-current-user');
    const detailStatus = document.getElementById('detail-status');
    const detailCpu = document.getElementById('detail-cpu');
    const detailThreads = document.getElementById('detail-threads');
    const detailTempStorage = document.getElementById('detail-temp-storage');
    const detailDiskIo = document.getElementById('detail-disk-io');
    const detailWaitReason = document.getElementById('detail-wait-reason');
    const detailStatusHistory = document.getElementById('detail-status-history');
    const detailSqlStatus = document.getElementById('detail-sql-status');
    const detailSqlText = document.getElementById('detail-sql-text');
    const tbody = systemStats?.querySelector('tbody');
    const totalJobs = document.getElementById('total-jobs');
    const peakCpu = document.getElementById('peak-cpu');
    const runningJobs = document.getElementById('running-jobs');
    const waitingJobs = document.getElementById('waiting-jobs');
    const currentRefresh = document.getElementById('current-refresh');
    const lastUpdated = document.getElementById('last-updated');
    const connectedSystem = document.getElementById('connected-system');
    const monitoringState = document.getElementById('monitoring-state');

    let monitoring = false;
    let selectedJobName = null;
    let latestJobs = [];
    let latestAlerts = [];
    let activityLogEntries = [];
    const activityLogIds = new Set();
    let exportStatusTimer = null;
    let noteComposerAlertId = null;
    const noteDraftByAlertId = new Map();
    const expandedAlertIds = new Set();

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => (
            {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                '\'': '&#39;'
            }[char]
        ));
    }

    function formatTimestamp(value) {
        const timestamp = new Date(value);
        if (Number.isNaN(timestamp.getTime())) {
            return escapeHtml(value);
        }

        return escapeHtml(timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }));
    }

    function formatNumber(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return '0';
        }

        return parsed.toLocaleString();
    }

    function formatCpuValue(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return '0.00%';
        }

        return `${parsed.toFixed(2)}%`;
    }

    function formatMegabytes(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return '0 MB';
        }

        return `${parsed.toLocaleString()} MB`;
    }

    function getJobKey(job) {
        if (job?.JOB_NAME) {
            return job.JOB_NAME;
        }

        const jobNumber = job?.JOB_NUMBER || '------';
        const jobUser = job?.JOB_USER || 'UNKNOWN';
        const jobName = job?.JOB_NAME_SHORT || 'UNKNOWN';
        return `${jobNumber}/${jobUser}/${jobName}`;
    }

    function setMonitoringState(isMonitoring, variant = 'idle') {
        monitoring = isMonitoring;
        if (startButton) {
            startButton.disabled = isMonitoring;
            startButton.innerHTML = isMonitoring
                ? '<i class="bi bi-activity me-2"></i>Monitoring...'
                : '<i class="bi bi-play-circle-fill me-2"></i>Start Monitoring';
        }

        if (stopButton) {
            stopButton.disabled = !isMonitoring;
        }

        if (monitoringState) {
            monitoringState.classList.remove('is-live', 'is-idle', 'is-error');
            if (variant === 'live') {
                monitoringState.classList.add('is-live');
                monitoringState.textContent = 'Live';
            } else if (variant === 'error') {
                monitoringState.classList.add('is-error');
                monitoringState.textContent = 'Issue Detected';
            } else {
                monitoringState.classList.add('is-idle');
                monitoringState.textContent = 'Idle';
            }
        }
    }

    function updateRefreshLabel() {
        if (!currentRefresh || !refreshInterval) {
            return;
        }

        const selectedOption = refreshInterval.options[refreshInterval.selectedIndex];
        currentRefresh.textContent = `Refresh cadence: ${selectedOption?.textContent || '5 seconds'}`;
    }

    function updateSummary(jobs = []) {
        const topCpu = jobs.reduce((highest, job) => Math.max(highest, Number(job.CPU) || 0), 0);
        const runningCount = jobs.filter((job) => job.STATUS === 'RUN').length;
        const waitingCount = jobs.filter((job) => ['MSGW', 'LCKW', 'DEQW', 'DLYW'].includes(job.STATUS)).length;

        if (totalJobs) {
            totalJobs.textContent = String(jobs.length);
        }

        if (peakCpu) {
            peakCpu.textContent = `${topCpu.toFixed(2)}%`;
        }

        if (runningJobs) {
            runningJobs.textContent = String(runningCount);
        }

        if (waitingJobs) {
            waitingJobs.textContent = String(waitingCount);
        }
    }

    function updateLastUpdated(label) {
        if (lastUpdated) {
            lastUpdated.textContent = label;
        }
    }

    function setExportStatus(message, isError = false) {
        if (!activityLogExportStatus) {
            return;
        }

        activityLogExportStatus.hidden = false;
        activityLogExportStatus.textContent = message;
        activityLogExportStatus.style.color = isError ? 'var(--danger)' : 'var(--accent-deep)';

        if (exportStatusTimer) {
            window.clearTimeout(exportStatusTimer);
        }

        exportStatusTimer = window.setTimeout(() => {
            activityLogExportStatus.hidden = true;
        }, 6000);
    }

    function showTableMessage(message, iconClass = 'bi-inbox', textClass = 'text-muted') {
        if (!tbody) {
            return;
        }

        tbody.innerHTML = `
            <tr class="table-placeholder">
                <td colspan="6" class="text-center py-4 ${textClass}">
                    <i class="bi ${iconClass} fs-2 d-block mb-2"></i>
                    ${escapeHtml(message)}
                </td>
            </tr>`;
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'RUN':
                return 'bg-success';
            case 'MSGW':
                return 'bg-warning text-dark';
            case 'LCKW':
                return 'bg-danger';
            case 'DEQW':
            case 'DLYW':
                return 'bg-info';
            case 'END':
            case 'EOJ':
                return 'bg-secondary';
            default:
                return 'bg-secondary';
        }
    }

    function renderJobs(result) {
        if (!tbody) {
            return;
        }

        latestJobs = Array.isArray(result?.data) ? result.data : [];
        updateSummary(latestJobs);
        updateLastUpdated(`Updated ${new Date().toLocaleTimeString()}`);

        if (!latestJobs.length) {
            showTableMessage('No active jobs to display');
            closeDrawer();
            return;
        }

        tbody.innerHTML = latestJobs.map((job) => {
            const jobName = getJobKey(job);
            const isSelected = selectedJobName === jobName;

            return `
                <tr
                    class="job-row${isSelected ? ' is-selected' : ''}"
                    data-job-name="${escapeHtml(jobName)}"
                    tabindex="0"
                    role="button"
                    aria-label="Open details for ${escapeHtml(job.SUBSYSTEM_JOB || jobName)}"
                >
                    <td>${escapeHtml(job.SUBSYSTEM_JOB)}</td>
                    <td>${escapeHtml(job.CURRENT_USER)}</td>
                    <td>${escapeHtml(job.TYPE)}</td>
                    <td>${formatCpuValue(job.CPU)}</td>
                    <td>${escapeHtml(job.FUNCTION_NAME)}</td>
                    <td>
                        <span class="badge ${getStatusBadgeClass(job.STATUS)}">
                            ${escapeHtml(job.STATUS)}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        if (selectedJobName) {
            void loadJobDetails(selectedJobName);
        }
    }

    function renderActivityLog() {
        if (!activityLog) {
            return;
        }

        if (!activityLogEntries.length) {
            activityLog.innerHTML = `
                <div class="activity-log-empty">
                    <i class="bi bi-journal-text"></i>
                    <span>No background activity recorded yet.</span>
                </div>
            `;
            return;
        }

        activityLog.innerHTML = activityLogEntries.map((entry) => {
            const detailMarkup = entry.detail
                ? `<p class="activity-log-detail">${escapeHtml(entry.detail)}</p>`
                : '';
            const sqlMarkup = entry.sql
                ? `<pre class="activity-log-sql"><code>${escapeHtml(entry.sql)}</code></pre>`
                : '';

            return `
                <article class="activity-log-entry is-${escapeHtml(entry.level)}">
                    <div class="activity-log-meta">
                        <div class="activity-log-tags">
                            <span class="activity-log-badge">${escapeHtml(entry.level.toUpperCase())}</span>
                            <span class="activity-log-badge is-area">${escapeHtml(entry.area.toUpperCase())}</span>
                        </div>
                        <time class="activity-log-time">${formatTimestamp(entry.timestamp)}</time>
                    </div>
                    <h3 class="activity-log-message">${escapeHtml(entry.message)}</h3>
                    ${detailMarkup}
                    ${sqlMarkup}
                </article>
            `;
        }).join('');
    }

    function mergeActivityEntries(entries) {
        let didChange = false;

        entries.forEach((entry) => {
            if (!entry?.id || activityLogIds.has(entry.id)) {
                return;
            }

            activityLogIds.add(entry.id);
            activityLogEntries.push(entry);
            didChange = true;
        });

        if (!didChange) {
            return;
        }

        activityLogEntries.sort((left, right) => (
            new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
        ));

        if (activityLogEntries.length > 200) {
            const removedEntries = activityLogEntries.splice(200);
            removedEntries.forEach((entry) => activityLogIds.delete(entry.id));
        }

        renderActivityLog();
    }

    function buildTrendPath(values, width, height) {
        const points = [];
        const usableWidth = width - 24;
        const usableHeight = height - 24;
        const max = Math.max(...values, 1);
        const min = Math.min(...values, 0);
        const range = Math.max(max - min, 1);

        values.forEach((value, index) => {
            const x = 12 + (index / Math.max(values.length - 1, 1)) * usableWidth;
            const normalizedValue = (value - min) / range;
            const y = height - 12 - (normalizedValue * usableHeight);
            points.push({ x, y });
        });

        const line = points.map((point, index) => (
            `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
        )).join(' ');

        const area = [
            `M ${points[0].x.toFixed(2)} ${height - 12}`,
            ...points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
            `L ${points[points.length - 1].x.toFixed(2)} ${height - 12}`,
            'Z'
        ].join(' ');

        return {
            line,
            area,
            lastPoint: points[points.length - 1]
        };
    }

    function renderTrendChart(element, values, strokeClass) {
        if (!element) {
            return;
        }

        if (!values.length) {
            element.innerHTML = `
                <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" class="trend-empty">
                    No data yet
                </text>
            `;
            return;
        }

        const width = 320;
        const height = 120;
        const { line, area, lastPoint } = buildTrendPath(values, width, height);

        element.innerHTML = `
            <line x1="12" y1="${height - 12}" x2="${width - 12}" y2="${height - 12}" class="trend-axis"></line>
            <path d="${area}" class="trend-area ${strokeClass}"></path>
            <path d="${line}" class="trend-line ${strokeClass}"></path>
            <circle cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="4" class="trend-dot ${strokeClass}"></circle>
        `;
    }

    function renderHistory(history) {
        const snapshots = Array.isArray(history) ? history : [];
        const latestSnapshot = snapshots[snapshots.length - 1];

        renderTrendChart(jobsHistoryChart, snapshots.map((snapshot) => Number(snapshot.totalJobs) || 0), 'jobs');
        renderTrendChart(cpuHistoryChart, snapshots.map((snapshot) => Number(snapshot.peakCpu) || 0), 'cpu');
        renderTrendChart(waitHistoryChart, snapshots.map((snapshot) => Number(snapshot.waitingJobs) || 0), 'waits');

        if (jobsHistoryValue) {
            jobsHistoryValue.textContent = latestSnapshot
                ? `${formatNumber(latestSnapshot.totalJobs)} jobs`
                : '0 jobs';
        }

        if (jobsHistoryNote) {
            jobsHistoryNote.textContent = latestSnapshot
                ? `Recent window: ${snapshots.length} snapshots tracked in this session.`
                : 'Waiting for snapshot history.';
        }

        if (cpuHistoryValue) {
            cpuHistoryValue.textContent = latestSnapshot
                ? `${Number(latestSnapshot.peakCpu || 0).toFixed(2)}%`
                : '0.00%';
        }

        if (cpuHistoryNote) {
            cpuHistoryNote.textContent = latestSnapshot
                ? `Running jobs in the latest poll: ${formatNumber(latestSnapshot.runningJobs)}.`
                : 'No CPU history collected yet.';
        }

        if (waitHistoryValue) {
            waitHistoryValue.textContent = latestSnapshot
                ? `${formatNumber(latestSnapshot.waitingJobs)} waits`
                : '0 waits';
        }

        if (waitHistoryNote) {
            waitHistoryNote.textContent = latestSnapshot
                ? `Latest snapshot: ${formatNumber(latestSnapshot.messageWaitJobs)} MSGW and ${formatNumber(latestSnapshot.lockWaitJobs)} LCKW jobs.`
                : 'MSGW and LCKW snapshots will appear here.';
        }
    }

    function renderAlerts(alerts) {
        if (!activeAlerts) {
            return;
        }

        const nextAlerts = Array.isArray(alerts) ? alerts : [];
        latestAlerts = nextAlerts;
        if (noteComposerAlertId && !nextAlerts.some((alert) => alert?.id === noteComposerAlertId)) {
            noteComposerAlertId = null;
        }
        const activeAlertTotal = nextAlerts.filter((alert) => alert?.isActive !== false).length;

        if (alertCount) {
            const label = activeAlertTotal === 1 ? 'alert' : 'alerts';
            alertCount.textContent = `${activeAlertTotal} active ${label} | ${nextAlerts.length} tracked`;
        }

        if (!nextAlerts.length) {
            activeAlerts.innerHTML = `
                <div class="activity-log-empty">
                    <i class="bi bi-shield-check"></i>
                    <span>No active alerts.</span>
                </div>
            `;
            return;
        }

        activeAlerts.innerHTML = nextAlerts.map((alert) => {
            const workflowLabel = String(alert.workflowStatus || 'new').replace(/_/g, ' ').toUpperCase();
            const stateMarkup = alert.isActive === false
                ? `<span class="activity-log-badge">RESOLVED ${formatTimestamp(alert.resolvedAt || alert.timestamp)}</span>`
                : '<span class="activity-log-badge">ACTIVE</span>';
            const ownerMarkup = alert.owner
                ? `<p class="alert-owner">Owner: ${escapeHtml(alert.owner)}</p>`
                : '';
            const notesMarkup = Array.isArray(alert.notes) && alert.notes.length
                ? `
                    <div class="alert-notes">
                        ${alert.notes.slice(0, 2).map((note) => `
                            <div class="alert-note" data-testid="alert-note-item">
                                <strong>${formatTimestamp(note.timestamp)}</strong>
                                <span>${escapeHtml(note.text)}</span>
                            </div>
                        `).join('')}
                    </div>
                `
                : '';
            const timelineMarkup = Array.isArray(alert.timeline) && alert.timeline.length
                ? `
                    <div class="alert-timeline" data-testid="alert-timeline">
                        ${alert.timeline.slice(0, 3).map((entry) => `
                            <div class="alert-timeline-entry">
                                <strong>${escapeHtml(entry.label)}</strong>
                                <span>${formatTimestamp(entry.timestamp)}</span>
                                ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `
                : '';
            const openJobButton = alert.jobName
                ? `
                    <button class="btn btn-outline-ink btn-sm alert-open-job" data-job-name="${escapeHtml(alert.jobName)}" data-testid="alert-open-job">
                        Open Job
                    </button>
                `
                : '';
            const acknowledgeButton = alert.workflowStatus === 'new'
                ? `
                    <button class="btn btn-outline-ink btn-sm alert-acknowledge" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-acknowledge">
                        Acknowledge
                    </button>
                `
                : '';
            const startButton = alert.workflowStatus === 'acknowledged' || alert.workflowStatus === 'new'
                ? `
                    <button class="btn btn-outline-ink btn-sm alert-start" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-start">
                        Start Work
                    </button>
                `
                : '';
            const resolveButton = alert.workflowStatus !== 'resolved' && alert.workflowStatus !== 'cleared'
                ? `
                    <button class="btn btn-outline-ink btn-sm alert-resolve" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-resolve">
                        Resolve
                    </button>
                `
                : '';
            const noteButton = `
                <button class="btn btn-outline-ink btn-sm alert-note-action" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-note-toggle">
                    Add Note
                </button>
            `;
            const clearAlertButton = `
                <button class="btn btn-outline-ink btn-sm alert-clear" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-clear">
                    Clear
                </button>
            `;
            const noteComposerMarkup = noteComposerAlertId === alert.id
                ? `
                    <div class="alert-note-composer" data-testid="alert-note-composer">
                        <label class="alert-note-label" for="alert-note-${escapeHtml(alert.id)}">Operator note</label>
                        <textarea
                            id="alert-note-${escapeHtml(alert.id)}"
                            class="form-control alert-note-input"
                            data-alert-id="${escapeHtml(alert.id)}"
                            data-testid="alert-note-input"
                            rows="3"
                            placeholder="Describe what you checked, who owns it, or the next step."
                        >${escapeHtml(noteDraftByAlertId.get(alert.id) || '')}</textarea>
                        <div class="alert-note-actions">
                            <button class="btn btn-primary-strong btn-sm alert-note-save" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-note-save">
                                Save Note
                            </button>
                            <button class="btn btn-outline-ink btn-sm alert-note-cancel" data-alert-id="${escapeHtml(alert.id)}">
                                Cancel
                            </button>
                        </div>
                    </div>
                `
                : '';
            const isExpanded = expandedAlertIds.has(alert.id);
            const summaryLabel = alert.jobName || alert.message;

            return `
                <article class="alert-entry is-${escapeHtml(alert.severity)}${alert.isActive === false ? ' is-resolved' : ''}" data-testid="alert-card">
                    <button class="alert-toggle" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}">
                        <div class="alert-toggle-main">
                            <div class="activity-log-meta">
                                <div class="activity-log-tags">
                                    ${stateMarkup}
                                    <span class="activity-log-badge is-area" data-testid="alert-workflow-badge">${escapeHtml(workflowLabel)}</span>
                                    <span class="activity-log-badge">${escapeHtml(alert.severity.toUpperCase())}</span>
                                    <span class="activity-log-badge is-area">${escapeHtml(alert.kind.toUpperCase())}</span>
                                </div>
                                <time class="activity-log-time">${formatTimestamp(alert.timestamp)}</time>
                            </div>
                            <h3 class="activity-log-message">${escapeHtml(alert.title)}</h3>
                            <p class="activity-log-detail">${escapeHtml(summaryLabel)}</p>
                        </div>
                        <span class="alert-toggle-icon" aria-hidden="true">${isExpanded ? '−' : '+'}</span>
                    </button>
                    ${isExpanded ? `
                        <div class="alert-body" data-testid="alert-body">
                            <p class="activity-log-detail">${escapeHtml(alert.message)}</p>
                            ${alert.detail ? `<p class="activity-log-detail">${escapeHtml(alert.detail)}</p>` : ''}
                            ${ownerMarkup}
                            ${notesMarkup}
                            ${timelineMarkup}
                            ${noteComposerMarkup}
                            <div class="alert-actions">
                                ${acknowledgeButton}
                                ${startButton}
                                ${resolveButton}
                                ${noteButton}
                                ${openJobButton}
                                ${clearAlertButton}
                            </div>
                        </div>
                    ` : ''}
                </article>
            `;
        }).join('');
    }

    function openAlertNoteComposer(alertId) {
        noteComposerAlertId = alertId;
        if (!noteDraftByAlertId.has(alertId)) {
            noteDraftByAlertId.set(alertId, '');
        }
        renderAlerts(latestAlerts);
    }

    function closeAlertNoteComposer() {
        noteComposerAlertId = null;
        renderAlerts(latestAlerts);
    }

    function toggleAlertExpanded(alertId) {
        if (expandedAlertIds.has(alertId)) {
            expandedAlertIds.delete(alertId);
            if (noteComposerAlertId === alertId) {
                noteComposerAlertId = null;
                noteDraftByAlertId.delete(alertId);
            }
        } else {
            expandedAlertIds.add(alertId);
        }

        renderAlerts(latestAlerts);
    }

    function applyAlertSettings(settings) {
        if (!settings) {
            return;
        }

        if (desktopNotifications) {
            desktopNotifications.checked = Boolean(settings.desktopNotifications);
        }
        if (watchHighCpu) {
            watchHighCpu.checked = Boolean(settings.watchHighCpu);
        }
        if (highCpuThreshold) {
            highCpuThreshold.value = String(settings.highCpuThreshold ?? 80);
        }
        if (watchMessageWait) {
            watchMessageWait.checked = Boolean(settings.watchMessageWait);
        }
        if (watchLockWait) {
            watchLockWait.checked = Boolean(settings.watchLockWait);
        }
        if (watchFailedPolls) {
            watchFailedPolls.checked = Boolean(settings.watchFailedPolls);
        }
        if (watchDisconnects) {
            watchDisconnects.checked = Boolean(settings.watchDisconnects);
        }
    }

    function openDrawer() {
        if (!jobDrawer || !drawerOverlay) {
            return;
        }

        jobDrawer.classList.add('is-open');
        drawerOverlay.classList.add('is-open');
        jobDrawer.setAttribute('aria-hidden', 'false');
    }

    function closeDrawer() {
        if (!jobDrawer || !drawerOverlay) {
            return;
        }

        jobDrawer.classList.remove('is-open');
        drawerOverlay.classList.remove('is-open');
        jobDrawer.setAttribute('aria-hidden', 'true');
        selectedJobName = null;

        if (tbody) {
            Array.from(tbody.querySelectorAll('.job-row.is-selected')).forEach((row) => {
                row.classList.remove('is-selected');
            });
        }
    }

    function renderStatusHistory(entries) {
        if (!detailStatusHistory) {
            return;
        }

        if (!entries.length) {
            detailStatusHistory.innerHTML = `
                <div class="status-history-empty">No status changes recorded yet.</div>
            `;
            return;
        }

        detailStatusHistory.innerHTML = entries.slice().reverse().map((entry) => `
            <article class="status-history-item">
                <span class="status-history-status">${escapeHtml(entry.status)}</span>
                <span class="status-history-label">${escapeHtml(entry.label)}</span>
                <time class="status-history-time">${formatTimestamp(entry.timestamp)}</time>
            </article>
        `).join('');
    }

    function populateJobDetails(payload) {
        if (!payload?.job) {
            if (jobDetailEmpty) {
                jobDetailEmpty.hidden = false;
            }
            if (jobDetailContent) {
                jobDetailContent.hidden = true;
            }
            return;
        }

        const job = payload.job;

        if (jobDetailTitle) {
            jobDetailTitle.textContent = job.SUBSYSTEM_JOB || getJobKey(job) || 'Selected job';
        }
        if (jobDetailSubtitle) {
            jobDetailSubtitle.textContent = `${job.TYPE || 'Unknown'} job for ${job.CURRENT_USER || 'unknown user'}`;
        }
        if (detailQualifiedJob) {
            detailQualifiedJob.textContent = job.JOB_NAME || getJobKey(job);
        }
        if (detailSubsystem) {
            detailSubsystem.textContent = job.SUBSYSTEM || '-';
        }
        if (detailCurrentUser) {
            detailCurrentUser.textContent = job.CURRENT_USER || '-';
        }
        if (detailStatus) {
            detailStatus.textContent = job.STATUS || '-';
        }
        if (detailCpu) {
            detailCpu.textContent = `${formatCpuValue(job.CPU)} | ${formatNumber(job.ELAPSED_CPU_TIME)} ms`;
        }
        if (detailThreads) {
            detailThreads.textContent = formatNumber(job.THREAD_COUNT);
        }
        if (detailTempStorage) {
            detailTempStorage.textContent = formatMegabytes(job.TEMPORARY_STORAGE);
        }
        if (detailDiskIo) {
            detailDiskIo.textContent = formatNumber(job.ELAPSED_TOTAL_DISK_IO_COUNT || job.TOTAL_DISK_IO_COUNT);
        }
        if (detailWaitReason) {
            detailWaitReason.textContent = payload.waitReason || 'No wait reason available.';
        }
        if (detailSqlStatus) {
            const sqlTimestamp = job.SQL_STATEMENT_START_TIMESTAMP
                ? ` since ${new Date(job.SQL_STATEMENT_START_TIMESTAMP).toLocaleTimeString()}`
                : '';
            detailSqlStatus.textContent = job.SQL_STATEMENT_STATUS
                ? `${job.SQL_STATEMENT_STATUS}${sqlTimestamp}`
                : 'No SQL detected';
        }
        if (detailSqlText) {
            detailSqlText.textContent = job.SQL_STATEMENT_TEXT || 'No SQL statement captured for this job.';
        }

        renderStatusHistory(payload.statusHistory || []);

        if (jobDetailEmpty) {
            jobDetailEmpty.hidden = true;
        }
        if (jobDetailContent) {
            jobDetailContent.hidden = false;
        }
    }

    async function loadJobDetails(jobName) {
        if (!jobName) {
            return;
        }

        try {
            const payload = await window.electronAPI.getJobDetails(jobName);
            if (!payload) {
                closeDrawer();
                return;
            }

            selectedJobName = jobName;
            populateJobDetails(payload);
            openDrawer();

            if (tbody) {
                Array.from(tbody.querySelectorAll('.job-row')).forEach((row) => {
                    row.classList.toggle('is-selected', row.dataset.jobName === jobName);
                });
            }
        } catch (error) {
            console.error('Error loading job details:', error);
        }
    }

    async function loadInitialMonitorData() {
        try {
            const [entries, history, alerts, settings] = await Promise.all([
                window.electronAPI.getActivityLog(),
                window.electronAPI.getMonitoringHistory(),
                window.electronAPI.getActiveAlerts(),
                window.electronAPI.getAlertSettings()
            ]);

            mergeActivityEntries(Array.isArray(entries) ? entries : []);
            renderHistory(history);
            renderAlerts(alerts);
            applyAlertSettings(settings);
        } catch (error) {
            console.error('Error loading monitor data:', error);
        }
    }

    function startMonitoring() {
        const interval = Number.parseInt(refreshInterval?.value || '5000', 10);
        if (!Number.isFinite(interval)) {
            showTableMessage('Refresh interval is invalid.', 'bi-exclamation-triangle', 'text-danger');
            return;
        }

        window.electronAPI.startMonitoring(interval);
        setMonitoringState(true, 'live');
    }

    function stopMonitoring() {
        window.electronAPI.stopMonitoring();
        setMonitoringState(false, 'idle');
    }

    async function exportActivityLog(mode) {
        const button = mode === 'share'
            ? shareActivityLogButton
            : mode === 'download'
                ? downloadActivityLogButton
                : openLogsFolderButton;
        if (!button) {
            return;
        }

        const originalMarkup = button.innerHTML;
        button.disabled = true;
        button.innerHTML = mode === 'share'
            ? '<i class="bi bi-hourglass-split me-2"></i>Preparing...'
            : mode === 'download'
                ? '<i class="bi bi-hourglass-split me-2"></i>Saving...'
                : '<i class="bi bi-hourglass-split me-2"></i>Opening...';

        try {
            const result = mode === 'share'
                ? await window.electronAPI.shareActivityLog()
                : mode === 'download'
                    ? await window.electronAPI.downloadActivityLog()
                    : await window.electronAPI.openLogsFolder();

            if (result?.canceled) {
                setExportStatus('Log download cancelled.');
                return;
            }

            const location = result?.filePath || result?.directoryPath;
            if (!result?.success || !location) {
                setExportStatus(`Unable to ${mode === 'folder' ? 'open the logs folder' : `${mode} the operator log`}.`, true);
                return;
            }

            setExportStatus(
                mode === 'share'
                    ? `Share log ready: ${result.filePath}`
                    : mode === 'download'
                        ? `Log saved: ${result.filePath}`
                        : `Logs folder opened: ${result.directoryPath}`
            );
        } catch (error) {
            console.error(`Error attempting to ${mode} the operator log:`, error);
            setExportStatus(
                error?.message || (
                    mode === 'folder'
                        ? 'Unable to open the logs folder.'
                        : `Unable to ${mode} the operator log.`
                ),
                true
            );
        } finally {
            button.disabled = false;
            button.innerHTML = originalMarkup;
        }
    }

    async function ensureConnectionState() {
        try {
            const state = await window.electronAPI.getConnectionState();
            if (!state.isConnected) {
                await window.electronAPI.navigateToConnection();
                return null;
            }

            if (connectedSystem && state.currentConnection) {
                const connection = state.currentConnection;
                connectedSystem.textContent = `${connection.name} | ${connection.host}:${connection.port}`;
            }

            return state;
        } catch (error) {
            console.error('Error checking connection state:', error);
            await window.electronAPI.navigateToConnection();
            return null;
        }
    }

    async function initializeMonitoring() {
        try {
            const state = await window.electronAPI.getMonitoringState();
            if (refreshInterval && Number.isFinite(state?.interval)) {
                const matchingOption = Array.from(refreshInterval.options).find(
                    (option) => Number.parseInt(option.value, 10) === state.interval
                );

                if (matchingOption) {
                    refreshInterval.value = String(state.interval);
                }
            }

            updateRefreshLabel();

            if (state?.active) {
                setMonitoringState(true, 'live');
                return;
            }

            startMonitoring();
        } catch (error) {
            console.error('Error initializing monitoring:', error);
            startMonitoring();
        }
    }

    startButton?.addEventListener('click', () => {
        if (!monitoring) {
            startMonitoring();
        }
    });

    stopButton?.addEventListener('click', () => {
        if (monitoring) {
            stopMonitoring();
        }
    });

    shareActivityLogButton?.addEventListener('click', () => {
        void exportActivityLog('share');
    });

    downloadActivityLogButton?.addEventListener('click', () => {
        void exportActivityLog('download');
    });

    openLogsFolderButton?.addEventListener('click', () => {
        void exportActivityLog('folder');
    });

    refreshInterval?.addEventListener('change', (event) => {
        if (monitoring) {
            const nextInterval = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(nextInterval)) {
                window.electronAPI.startMonitoring(nextInterval);
            }
        }
        updateRefreshLabel();
    });

    disconnectButton?.addEventListener('click', async () => {
        disconnectButton.disabled = true;
        try {
            const result = await window.electronAPI.disconnect();
            if (!result.success) {
                console.error('Disconnect failed:', result.error);
                showTableMessage(result.error || 'Disconnect failed.', 'bi-exclamation-triangle', 'text-danger');
                disconnectButton.disabled = false;
            }
        } catch (error) {
            console.error('Error during disconnect:', error);
            showTableMessage(error.message || 'Error during disconnect.', 'bi-exclamation-triangle', 'text-danger');
            disconnectButton.disabled = false;
        }
    });

    alertSettingsForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const submitButton = alertSettingsForm.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = true;
        }

        try {
            const settings = await window.electronAPI.saveAlertSettings({
                desktopNotifications: Boolean(desktopNotifications?.checked),
                watchHighCpu: Boolean(watchHighCpu?.checked),
                highCpuThreshold: Number.parseInt(highCpuThreshold?.value || '80', 10) || 80,
                watchMessageWait: Boolean(watchMessageWait?.checked),
                watchLockWait: Boolean(watchLockWait?.checked),
                watchFailedPolls: Boolean(watchFailedPolls?.checked),
                watchDisconnects: Boolean(watchDisconnects?.checked)
            });
            applyAlertSettings(settings);
        } catch (error) {
            console.error('Error saving alert settings:', error);
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });

    tbody?.addEventListener('click', (event) => {
        const row = event.target.closest('.job-row');
        if (!row?.dataset?.jobName) {
            return;
        }

        void loadJobDetails(row.dataset.jobName);
    });

    tbody?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const row = event.target.closest('.job-row');
        if (!row?.dataset?.jobName) {
            return;
        }

        event.preventDefault();
        void loadJobDetails(row.dataset.jobName);
    });

    activeAlerts?.addEventListener('click', (event) => {
        const toggleButton = event.target.closest('.alert-toggle');
        if (toggleButton?.dataset?.alertId) {
            toggleAlertExpanded(toggleButton.dataset.alertId);
            return;
        }

        const noteSaveButton = event.target.closest('.alert-note-save');
        if (noteSaveButton?.dataset?.alertId) {
            const note = String(noteDraftByAlertId.get(noteSaveButton.dataset.alertId) || '').trim();
            if (!note) {
                return;
            }

            void window.electronAPI.updateAlertWorkflow({
                alertId: noteSaveButton.dataset.alertId,
                action: 'note',
                note,
                owner: 'Local operator'
            });
            noteDraftByAlertId.delete(noteSaveButton.dataset.alertId);
            noteComposerAlertId = null;
            return;
        }

        const noteCancelButton = event.target.closest('.alert-note-cancel');
        if (noteCancelButton?.dataset?.alertId) {
            noteDraftByAlertId.delete(noteCancelButton.dataset.alertId);
            closeAlertNoteComposer();
            return;
        }

        const workflowButton = event.target.closest('.alert-acknowledge, .alert-start, .alert-resolve, .alert-note-action');
        if (workflowButton?.dataset?.alertId) {
            const action = workflowButton.classList.contains('alert-acknowledge')
                ? 'acknowledge'
                : workflowButton.classList.contains('alert-start')
                    ? 'start'
                    : workflowButton.classList.contains('alert-resolve')
                        ? 'resolve'
                        : 'note';

            if (action === 'note') {
                openAlertNoteComposer(workflowButton.dataset.alertId);
                return;
            }

            void window.electronAPI.updateAlertWorkflow({
                alertId: workflowButton.dataset.alertId,
                action,
                owner: 'Local operator'
            });
            return;
        }

        const clearButton = event.target.closest('.alert-clear');
        if (clearButton?.dataset?.alertId) {
            void window.electronAPI.clearAlert(clearButton.dataset.alertId);
            return;
        }

        const button = event.target.closest('.alert-open-job');
        if (!button?.dataset?.jobName) {
            return;
        }

        void loadJobDetails(button.dataset.jobName);
    });

    activeAlerts?.addEventListener('input', (event) => {
        const noteInput = event.target.closest('.alert-note-input');
        if (!noteInput?.dataset?.alertId) {
            return;
        }

        noteDraftByAlertId.set(noteInput.dataset.alertId, noteInput.value);
    });

    closeJobDrawer?.addEventListener('click', () => {
        closeDrawer();
    });

    drawerOverlay?.addEventListener('click', () => {
        closeDrawer();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeDrawer();
        }
    });

    updateSummary();
    updateRefreshLabel();
    updateLastUpdated('Monitoring starts automatically after connect');
    setMonitoringState(false, 'idle');
    showTableMessage('Waiting for the first active-job snapshot');
    renderActivityLog();
    renderHistory([]);
    renderAlerts([]);

    window.electronAPI.onActivityLog((entry) => {
        mergeActivityEntries([entry]);
    });

    window.electronAPI.onStatusUpdate((data) => {
        renderJobs(data);
        setMonitoringState(true, 'live');
    });

    window.electronAPI.onMonitoringError((error) => {
        showTableMessage(error, 'bi-exclamation-triangle', 'text-danger');
        updateLastUpdated('Last update failed');
        setMonitoringState(false, 'error');
    });

    window.electronAPI.onMonitoringHistoryUpdated((history) => {
        renderHistory(history);
    });

    window.electronAPI.onAlertsUpdated((alerts) => {
        renderAlerts(alerts);
    });

    window.electronAPI.onAlertSettingsUpdated((settings) => {
        applyAlertSettings(settings);
    });

    void loadInitialMonitorData();
    void (async () => {
        const connection = await ensureConnectionState();
        if (!connection) {
            return;
        }

        await initializeMonitoring();
    })();
});
