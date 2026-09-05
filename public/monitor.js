import { renderHistory as renderHistoryView } from './monitor/history.js';
import { initAiAssistant } from './monitor/ai-assistant.js';
import {
    buildAlertExplanationPrompt,
    buildAlertNextActionsPrompt,
    buildSelectedJobHealthPrompt,
    buildWaitAnalysisPrompt
} from './monitor/ibmeyeai/action-prompts.js';
import { renderAiReportMarkdown } from './monitor/ibmeyeai/render.js';
import { filterJobs as filterVisibleJobs, getSubsystemOptions } from './monitor/jobs-filter.js';
import { initSupportPanel } from './shared/support.js';
import { initJobQueues } from './monitor/job-queues.js';
import {
    renderOperatorActions as renderOperatorActionsView,
    renderJobLog as renderJobLogView,
    renderJobMessages as renderJobMessagesView,
    renderRootCauseGuidance as renderRootCauseGuidanceView,
    renderStatusHistory as renderStatusHistoryView
} from './monitor/job-details.js';

document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-monitoring');
    const stopButton = document.getElementById('stop-monitoring');
    const disconnectButton = document.getElementById('disconnect');
    const openObjectAnalysisButton = document.getElementById('open-object-analysis');
    const openSettingsButton = document.getElementById('open-settings');
    const openAiSettingsButton = document.getElementById('open-ai-settings');
    const refreshInterval = document.getElementById('refresh-interval');
    const systemStats = document.getElementById('system-stats');
    const appStatusBar = document.getElementById('app-status-bar');
    const appStatusIndicator = document.getElementById('app-status-indicator');
    const appStatusMessage = document.getElementById('app-status-message');
    const appStatusDetail = document.getElementById('app-status-detail');
    const activeAlerts = document.getElementById('active-alerts');
    const alertCount = document.getElementById('alert-count');
    const alertSearchInput = document.getElementById('alert-search-input');
    const alertAttentionSummary = document.getElementById('alert-attention-summary');
    const alertQuickFilterButtons = Array.from(document.querySelectorAll('[data-alert-filter]'));
    const focusNextAlertButton = document.getElementById('focus-next-alert');
    const actionboardFocusTitle = document.getElementById('actionboard-focus-title');
    const actionboardFocusCopy = document.getElementById('actionboard-focus-copy');
    const actionboardAttentionCount = document.getElementById('actionboard-attention-count');
    const actionboardWorkingCount = document.getElementById('actionboard-working-count');
    const actionboardQueueCount = document.getElementById('actionboard-queue-count');
    const actionboardQueueWaitingCount = document.getElementById('actionboard-queue-waiting-count');
    const actionboardActiveJobCount = document.getElementById('actionboard-active-job-count');
    const actionboardWaitingJobCount = document.getElementById('actionboard-waiting-job-count');
    const heroFocusNextButton = document.getElementById('hero-focus-next');
    const actionboardQuickLinks = Array.from(document.querySelectorAll('[data-actionboard-target]'));
    const alertsPanel = document.querySelector('.alerts-panel');
    const jobQueuesPanel = document.getElementById('job-queues-panel');
    const aiPanel = document.querySelector('.ai-assistant-panel');
    const activeJobsPanel = document.querySelector('.operations-grid > details');
    const focusAlertShell = document.getElementById('focus-alert-shell');
    const focusAlertCard = document.getElementById('focus-alert-card');
    const releaseFocusAlertButton = document.getElementById('release-focus-alert');
    const alertSettingsForm = document.getElementById('alert-settings-form');
    const desktopNotifications = document.getElementById('desktop-notifications');
    const watchHighCpu = document.getElementById('watch-high-cpu');
    const highCpuThreshold = document.getElementById('high-cpu-threshold');
    const highCpuRecoveryPolls = document.getElementById('high-cpu-recovery-polls');
    const watchMessageWait = document.getElementById('watch-message-wait');
    const watchLockWait = document.getElementById('watch-lock-wait');
    const watchDelayWait = document.getElementById('watch-delay-wait');
    const watchDequeueWait = document.getElementById('watch-dequeue-wait');
    const watchFailedPolls = document.getElementById('watch-failed-polls');
    const watchDisconnects = document.getElementById('watch-disconnects');
    const emailNotificationsEnabled = document.getElementById('email-notifications-enabled');
    const emailSmtpHost = document.getElementById('email-smtp-host');
    const emailSmtpPort = document.getElementById('email-smtp-port');
    const emailSmtpSecure = document.getElementById('email-smtp-secure');
    const emailUsername = document.getElementById('email-username');
    const emailPassword = document.getElementById('email-password');
    const emailFromAddress = document.getElementById('email-from-address');
    const emailToAddresses = document.getElementById('email-to-addresses');
    const sendTestEmailButton = document.getElementById('send-test-email');
    const emailSettingsStatus = document.getElementById('email-settings-status');
    const jobsHistoryChart = document.getElementById('jobs-history-chart');
    const jobsHistoryValue = document.getElementById('jobs-history-value');
    const jobsHistoryRange = document.getElementById('jobs-history-range');
    const jobsHistoryLatest = document.getElementById('jobs-history-latest');
    const jobsHistoryNote = document.getElementById('jobs-history-note');
    const cpuHistoryChart = document.getElementById('cpu-history-chart');
    const cpuHistoryValue = document.getElementById('cpu-history-value');
    const cpuHistoryRange = document.getElementById('cpu-history-range');
    const cpuHistoryRunning = document.getElementById('cpu-history-running');
    const cpuHistoryNote = document.getElementById('cpu-history-note');
    const waitHistoryChart = document.getElementById('wait-history-chart');
    const waitHistoryValue = document.getElementById('wait-history-value');
    const waitHistoryMsgw = document.getElementById('wait-history-msgw');
    const waitHistoryLckw = document.getElementById('wait-history-lckw');
    const waitHistoryNote = document.getElementById('wait-history-note');
    const activityLatestPoll = document.getElementById('activity-latest-poll');
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
    const detailWaitAiButton = document.getElementById('detail-wait-ai');
    const detailWaitAiReport = document.getElementById('detail-wait-ai-report');
    const detailWaitAiStatus = document.getElementById('detail-wait-ai-status');
    const detailWaitAiContent = document.getElementById('detail-wait-ai-content');
    const detailGuidanceHeadline = document.getElementById('detail-guidance-headline');
    const detailGuidanceSeverity = document.getElementById('detail-guidance-severity');
    const detailGuidanceImpact = document.getElementById('detail-guidance-impact');
    const detailGuidanceCause = document.getElementById('detail-guidance-cause');
    const detailGuidanceSteps = document.getElementById('detail-guidance-steps');
    const detailGuidanceTechnical = document.getElementById('detail-guidance-technical');
    const detailOperatorActions = document.getElementById('detail-operator-actions');
    const detailOperatorActionNote = document.getElementById('detail-operator-action-note');
    const detailAiHealth = document.getElementById('detail-ai-health');
    const detailStatusHistory = document.getElementById('detail-status-history');
    const loadJobLogButton = document.getElementById('load-job-log');
    const loadJobMessagesButton = document.getElementById('load-job-messages');
    const jobOnDemandStatus = document.getElementById('job-on-demand-status');
    const jobLogOutput = document.getElementById('job-log-output');
    const jobMessagesOutput = document.getElementById('job-messages-output');
    const tbody = systemStats?.querySelector('tbody');
    const jobsSubsystemFilter = document.getElementById('jobs-subsystem-filter');
    const jobsSearchInput = document.getElementById('jobs-search-input');
    const jobsVisibleCount = document.getElementById('jobs-visible-count');
    const jobsQuickFilterButtons = Array.from(document.querySelectorAll('[data-job-filter]'));
    const totalJobs = document.getElementById('total-jobs');
    const peakCpu = document.getElementById('peak-cpu');
    const runningJobs = document.getElementById('running-jobs');
    const waitingJobs = document.getElementById('waiting-jobs');
    const currentRefresh = document.getElementById('current-refresh');
    const jobsLastPoll = document.getElementById('jobs-last-poll');
    const lastUpdated = document.getElementById('last-updated');
    const connectedSystem = document.getElementById('connected-system');
    const monitoringState = document.getElementById('monitoring-state');
    const themeSelector = document.getElementById('theme-selector');
    const themeMenu = document.querySelector('.hero-theme-menu');
    const themeMenuOptions = document.getElementById('theme-menu-options');
    const themeDescription = document.getElementById('theme-description');

    // Keep the operator flow in priority order: incidents, queued work, then AI.
    // Anchor the queue immediately before AI so its position is deterministic
    // even though the source markup keeps the operations sections together.
    if (jobQueuesPanel) {
        if (aiPanel) {
            aiPanel.before(jobQueuesPanel);
        } else {
            alertsPanel?.after(jobQueuesPanel);
        }
    }

    let monitoring = false;
    let selectedJobName = null;
    let latestJobs = [];
    let latestAlerts = [];
    let noteComposerAlertId = null;
    const noteDraftByAlertId = new Map();
    const expandedAlertIds = new Set();
    const expandedTimelineAlertIds = new Set();
    let focusedAlertId = null;
    let alertSearchQuery = '';
    let alertFilter = 'all';
    const pendingRecheckAlertIds = new Set();
    let availableThemes = [];
    let currentOperatorName = 'local-operator';
    let entitlements = { plan: 'premium', features: {} };
    let jobFilters = {
        subsystem: 'ALL',
        query: '',
        status: 'ALL'
    };
    const aiAssistant = initAiAssistant({
        root: document,
        getSelectedJobName: () => selectedJobName
    });
    const jobQueues = initJobQueues({ root: document, electronAPI: window.electronAPI });

    document.addEventListener('jobqueues:summary', (event) => {
        const detail = event.detail || {};
        if (actionboardQueueCount) {
            actionboardQueueCount.textContent = String(detail.queues || 0);
        }
        if (actionboardQueueWaitingCount) {
            actionboardQueueWaitingCount.textContent = String(detail.waiting || 0);
        }
    });

    void initSupportPanel({
        versionLabel: document.getElementById('app-version-label'),
        contactButton: document.getElementById('support-contact-only'),
        diagnosticsButton: document.getElementById('support-send-diagnostics'),
        statusElement: document.getElementById('support-status'),
        menuElement: document.getElementById('support-menu')
    });

    function setEmailSettingsStatus(message, isError = false) {
        if (!emailSettingsStatus) {
            return;
        }

        emailSettingsStatus.hidden = false;
        emailSettingsStatus.textContent = message;
        emailSettingsStatus.style.color = isError ? 'var(--danger)' : 'var(--accent-deep)';
    }

    function applyTheme(themeId) {
        document.body.dataset.theme = themeId || 'operator-light';
    }

    function renderThemeSettings(settings) {
        if (!themeSelector || !settings) {
            return;
        }

        availableThemes = Array.isArray(settings.themes) ? settings.themes : [];
        themeSelector.innerHTML = availableThemes.map((theme) => (
            `<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.label)}</option>`
        )).join('');
        themeSelector.value = settings.themeId || 'operator-light';
        applyTheme(settings.themeId);

        const selectedTheme = availableThemes.find((theme) => theme.id === themeSelector.value);
        if (themeMenuOptions) {
            themeMenuOptions.innerHTML = availableThemes.map((theme) => `
                <button
                    type="button"
                    class="hero-theme-option${theme.id === themeSelector.value ? ' is-active' : ''}"
                    data-theme-id="${escapeHtml(theme.id)}"
                >
                    <span class="hero-theme-option-label">${escapeHtml(theme.label)}</span>
                    <span class="hero-theme-option-check" aria-hidden="true">${theme.id === themeSelector.value ? '<i class="bi bi-check2"></i>' : ''}</span>
                </button>
            `).join('');
        }
        if (themeDescription) {
            themeDescription.textContent = selectedTheme?.description || '';
        }
    }

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

    function formatWorkflowLabel(status) {
        const normalized = String(status || 'new').replace(/_/g, ' ');
        switch (normalized) {
            case 'work done':
                return 'WORK DONE';
            case 'system cleared':
                return 'SYSTEM CLEARED';
            default:
                return normalized.toUpperCase();
        }
    }

    function matchesAlertFilter(alert, filter = alertFilter) {
        const active = alert?.isActive !== false;
        switch (filter) {
            case 'attention':
                return active && (
                    alert.workflowStatus === 'new'
                    || (alert.severity === 'critical' && !isClaimedAlert(alert))
                );
            case 'critical':
                return active && alert.severity === 'critical';
            case 'working':
                return active && isClaimedAlert(alert);
            default:
                return true;
        }
    }

    function getAlertPriorityScore(alert) {
        if (alert?.isActive === false) {
            return 0;
        }

        const severityScore = alert?.severity === 'critical'
            ? 40
            : alert?.severity === 'warning'
                ? 25
                : 10;
        const workflowScore = alert?.workflowStatus === 'new'
            ? 20
            : isClaimedAlert(alert)
                ? 14
                : alert?.workflowStatus === 'acknowledged'
                    ? 8
                    : 0;
        const kindScore = alert?.kind === 'messageWait' || alert?.kind === 'lockWait' ? 5 : 0;
        return severityScore + workflowScore + kindScore;
    }

    function syncAlertQuickFilters() {
        alertQuickFilterButtons.forEach((button) => {
            const isActive = button.dataset.alertFilter === alertFilter;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function updateAlertActionSummary(alerts, focusedAlert = null) {
        const nextAlerts = Array.isArray(alerts) ? alerts : [];
        const activeAlertsOnly = nextAlerts.filter((alert) => alert?.isActive !== false);
        const attentionCount = activeAlertsOnly.filter((alert) => matchesAlertFilter(alert, 'attention')).length;
        const workingCount = activeAlertsOnly.filter((alert) => matchesAlertFilter(alert, 'working')).length;
        const criticalCount = activeAlertsOnly.filter((alert) => matchesAlertFilter(alert, 'critical')).length;

        if (actionboardAttentionCount) {
            actionboardAttentionCount.textContent = String(attentionCount);
        }
        if (actionboardWorkingCount) {
            actionboardWorkingCount.textContent = String(workingCount);
        }
        if (alertAttentionSummary) {
            alertAttentionSummary.textContent = attentionCount
                ? `${attentionCount} incident${attentionCount === 1 ? '' : 's'} need operator attention.`
                : activeAlertsOnly.length
                    ? `${activeAlertsOnly.length} active incident${activeAlertsOnly.length === 1 ? '' : 's'} in the queue.`
                    : 'No active incidents. The queue is clear.';
        }
        if (actionboardFocusTitle) {
            actionboardFocusTitle.textContent = focusedAlert
                ? `Working: ${focusedAlert.jobName || focusedAlert.title || 'selected incident'}`
                : attentionCount
                    ? `${attentionCount} incident${attentionCount === 1 ? '' : 's'} need review`
                    : activeAlertsOnly.length
                        ? 'No incident is pinned'
                        : 'All clear';
        }
        if (actionboardFocusCopy) {
            actionboardFocusCopy.textContent = focusedAlert
                ? 'This incident stays pinned while you investigate and record the next step.'
                : activeAlertsOnly.length
                    ? 'Use Focus next to bring the highest-priority unassigned incident into your work area.'
                    : 'The board will surface the next incident when monitoring detects one.';
        }
        if (focusNextAlertButton) {
            focusNextAlertButton.disabled = activeAlertsOnly.length === 0;
            focusNextAlertButton.innerHTML = activeAlertsOnly.length
                ? `<i class="bi bi-crosshair me-1" aria-hidden="true"></i>${focusedAlert ? 'Focus another' : 'Focus next'}`
                : '<i class="bi bi-check2-circle me-1" aria-hidden="true"></i>All clear';
        }
        if (heroFocusNextButton) {
            heroFocusNextButton.disabled = activeAlertsOnly.length === 0;
            heroFocusNextButton.querySelector('span').textContent = focusedAlert
                ? 'Open incident'
                : attentionCount
                    ? 'Review next'
                    : activeAlertsOnly.length
                        ? 'Open queue'
                        : 'All clear';
        }

        const countByFilter = {
            all: nextAlerts.length,
            attention: attentionCount,
            critical: criticalCount,
            working: workingCount
        };
        Object.entries(countByFilter).forEach(([filter, count]) => {
            const countElement = document.getElementById(`alert-filter-${filter}-count`);
            if (countElement) {
                countElement.textContent = String(count);
            }
        });
        syncAlertQuickFilters();
    }

    function getAlertOwner(alert) {
        return String(alert?.owner || '').trim();
    }

    function isOwnedByCurrentOperator(alert) {
        return Boolean(getAlertOwner(alert)) && getAlertOwner(alert) === currentOperatorName;
    }

    function isClaimedAlert(alert) {
        return String(alert?.workflowStatus || '') === 'claimed';
    }

    function isOwnedWorkAlert(alert) {
        const status = String(alert?.workflowStatus || '');
        return isOwnedByCurrentOperator(alert) && (status === 'claimed' || status === 'work_done');
    }

    function premiumControl(label, feature, className, attributes = '') {
        const available = entitlements.features?.[feature] !== false;
        return `<button class="btn btn-outline-ink btn-sm ${className}${available ? '' : ' premium-locked'}" ${available ? '' : 'disabled'} ${attributes}>${available ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}${label}</button>`;
    }

    function premiumIntegrationControl(label, feature, className, attributes = '') {
        const available = entitlements.features?.[feature] !== false;
        return `<button class="btn btn-outline-ink btn-sm ${className}${available ? '' : ' premium-locked'}" ${available ? '' : 'disabled'} ${attributes}>${available ? '' : '<i class="bi bi-lock-fill premium-action-icon" aria-hidden="true"></i>'}${label} <small class="premium-inline-label"><i class="bi bi-lock-fill" aria-hidden="true"></i>Premium</small></button>`;
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
        if (actionboardActiveJobCount) {
            actionboardActiveJobCount.textContent = String(jobs.length);
        }
        if (actionboardWaitingJobCount) {
            actionboardWaitingJobCount.textContent = String(waitingCount);
        }
    }

    function updateLastUpdated(label) {
        if (lastUpdated) {
            lastUpdated.textContent = label;
        }
        if (activityLatestPoll) {
            activityLatestPoll.textContent = label.replace(/^Updated\s*/i, '') || '--';
        }
    }


    function formatShortDateTime(value) {
        const timestamp = new Date(value);
        if (Number.isNaN(timestamp.getTime())) {
            return 'Awaiting poll';
        }

        return timestamp.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
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

    function renderSubsystemFilterOptions(jobs) {
        if (!jobsSubsystemFilter) {
            return;
        }

        const options = getSubsystemOptions(jobs);
        if (jobFilters.subsystem !== 'ALL' && !options.includes(jobFilters.subsystem)) {
            jobFilters = {
                ...jobFilters,
                subsystem: 'ALL'
            };
        }

        const nextOptions = ['<option value="ALL">All subsystems</option>']
            .concat(options.map((subsystem) => (
                `<option value="${escapeHtml(subsystem)}">${escapeHtml(subsystem)}</option>`
            )));

        jobsSubsystemFilter.innerHTML = nextOptions.join('');
        jobsSubsystemFilter.value = jobFilters.subsystem || 'ALL';
    }

    function updateVisibleJobsCount(visibleCount, totalCount) {
        if (!jobsVisibleCount) {
            return;
        }

        jobsVisibleCount.textContent = `Showing ${visibleCount} of ${totalCount} jobs`;
    }

    function syncJobQuickFilters() {
        jobsQuickFilterButtons.forEach((button) => {
            const isActive = button.dataset.jobFilter === (jobFilters.status || 'ALL');
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
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
        renderSubsystemFilterOptions(latestJobs);
        syncJobQuickFilters();
        updateSummary(latestJobs);
        const pollTimestamp = result?.generatedAt || new Date().toISOString();
        if (jobsLastPoll) {
            jobsLastPoll.textContent = formatShortDateTime(pollTimestamp);
        }
        updateLastUpdated(`Updated ${new Date(pollTimestamp).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })}`);

        if (!latestJobs.length) {
            updateVisibleJobsCount(0, 0);
            showTableMessage('No active jobs to display');
            closeDrawer();
            return;
        }

        const visibleJobs = filterVisibleJobs(latestJobs, jobFilters);
        updateVisibleJobsCount(visibleJobs.length, latestJobs.length);

        if (!visibleJobs.length) {
            showTableMessage('No jobs match the current subsystem or search.', 'bi-search', 'text-muted');
            return;
        }

        tbody.innerHTML = visibleJobs.map((job) => {
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

    function setOperatorStatus(message, level = 'info', detail = '') {
        if (appStatusMessage) {
            appStatusMessage.textContent = message;
        }
        if (appStatusDetail) {
            appStatusDetail.textContent = detail;
        }
        if (appStatusBar) {
            appStatusBar.classList.remove('is-info', 'is-success', 'is-warning', 'is-error');
            appStatusBar.classList.add(`is-${level}`);
        }
        if (appStatusIndicator) {
            appStatusIndicator.innerHTML = `<i class="bi ${level === 'success' ? 'bi-check-circle-fill' : level === 'warning' ? 'bi-exclamation-triangle-fill' : level === 'error' ? 'bi-x-circle-fill' : 'bi-circle-fill'}"></i>`;
        }
    }

    function renderHistory(history) {
        renderHistoryView({
            jobsHistoryChart,
            jobsHistoryValue,
            jobsHistoryRange,
            jobsHistoryLatest,
            jobsHistoryNote,
            cpuHistoryChart,
            cpuHistoryValue,
            cpuHistoryRange,
            cpuHistoryRunning,
            cpuHistoryNote,
            waitHistoryChart,
            waitHistoryValue,
            waitHistoryMsgw,
            waitHistoryLckw,
            waitHistoryNote
        }, history);
    }

    function captureAlertScrollState() {
        if (!activeAlerts || !activeAlerts.childElementCount) {
            return null;
        }

        const containerTop = activeAlerts.getBoundingClientRect().top;
        const visibleCards = Array.from(activeAlerts.querySelectorAll('[data-alert-id]'));
        const anchorElement = visibleCards.find((card) => (
            card.getBoundingClientRect().bottom > containerTop + 1
        ));

        return {
            anchorId: anchorElement?.dataset?.alertId || null,
            anchorOffset: anchorElement
                ? anchorElement.getBoundingClientRect().top - containerTop
                : 0,
            scrollTop: activeAlerts.scrollTop
        };
    }

    function restoreAlertScrollState(scrollState) {
        if (!activeAlerts || !scrollState) {
            return;
        }

        if (scrollState.anchorId) {
            const selectorValue = window.CSS?.escape
                ? window.CSS.escape(scrollState.anchorId)
                : scrollState.anchorId.replace(/"/g, '\\"');
            const anchorElement = activeAlerts.querySelector(`[data-alert-id="${selectorValue}"]`);

            if (anchorElement) {
                const containerTop = activeAlerts.getBoundingClientRect().top;
                const currentOffset = anchorElement.getBoundingClientRect().top - containerTop;
                activeAlerts.scrollTop += currentOffset - scrollState.anchorOffset;
                return;
            }
        }

        activeAlerts.scrollTop = scrollState.scrollTop;
    }

    function buildAlertMarkup(alert, options = {}) {
        const isExpanded = Boolean(options.expanded);
        const isFocused = Boolean(options.focused);
        const workflowLabel = formatWorkflowLabel(alert.workflowStatus);
        const owner = getAlertOwner(alert);
        const ownedByCurrentOperator = isOwnedByCurrentOperator(alert);
        const claimedByAnotherOperator = isClaimedAlert(alert) && Boolean(owner) && !ownedByCurrentOperator;
        const resolutionLabel = alert.resolutionSource === 'manual_recheck'
            ? 'RESOLVED · RECHECK'
            : 'RESOLVED · AUTO';
        const stateMarkup = alert.isActive === false
            ? `<span class="activity-log-badge">${resolutionLabel} ${formatTimestamp(alert.resolvedAt || alert.timestamp)}</span>`
            : '<span class="activity-log-badge">ACTIVE</span>';
        const recoveryMarkup = alert.kind === 'highCpu' && alert.isActive !== false && Number(alert.recoveryPollCount || 0) > 0
            ? `<p class="alert-recovery-progress"><i class="bi bi-activity me-1"></i>Recovery check ${Number(alert.recoveryPollCount)} of ${Number(highCpuRecoveryPolls?.value || 3)} healthy polls</p>`
            : '';
        const ownerMarkup = owner
            ? `<p class="alert-owner">${isClaimedAlert(alert) ? 'Working owner' : 'Assigned to'}: ${escapeHtml(owner)}</p>`
            : '';
        const timelineEntries = Array.isArray(alert.timeline) ? alert.timeline : [];
        const isTimelineExpanded = expandedTimelineAlertIds.has(alert.id);
        const timelineMarkup = timelineEntries.length
            ? `
                <div class="alert-history-shell">
                    <div class="alert-history-header">
                        <h4 class="alert-history-title">Incident history</h4>
                        <p class="alert-history-copy">Operator actions and alert events for this incident.</p>
                    </div>
                    <div class="alert-timeline" data-testid="alert-timeline">
                        ${timelineEntries.slice(0, isTimelineExpanded ? timelineEntries.length : 4).map((entry) => `
                            <div class="alert-timeline-entry">
                                <strong>${escapeHtml(entry.label)}</strong>
                                <span>${formatTimestamp(entry.timestamp)}</span>
                                ${entry.actor ? `<p>Operator: ${escapeHtml(entry.actor)}</p>` : ''}
                                ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    ${timelineEntries.length > 4 ? `
                        <button class="btn btn-outline-ink btn-sm alert-history-toggle" type="button" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-history-toggle">
                            <i class="bi bi-clock-history me-1" aria-hidden="true"></i>${isTimelineExpanded ? 'Show less history' : `Show all history (${timelineEntries.length})`}
                        </button>
                    ` : ''}
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
        const claimButton = alert.isActive !== false && !claimedByAnotherOperator && !isClaimedAlert(alert)
            ? `
                <button class="btn btn-outline-ink btn-sm alert-claim" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-claim">
                    Start Work
                </button>
            `
            : '';
        const releaseButton = isOwnedWorkAlert(alert)
            ? `
                <button class="btn btn-outline-ink btn-sm alert-release" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-release">
                    Return To Queue
                </button>
            `
            : '';
        const workDoneButton = ownedByCurrentOperator && isClaimedAlert(alert)
            ? `
                <button class="btn btn-outline-ink btn-sm alert-work-done" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-work-done">
                    Mark Work Done
                </button>
            `
            : '';
        const noteButton = `
            <button class="btn btn-outline-ink btn-sm alert-note-action" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-note-toggle"${claimedByAnotherOperator ? ` disabled title="Claimed by ${escapeHtml(owner)}"` : ''}>
                Add Note
            </button>
        `;
        const aiAvailable = entitlements.features?.['ai-analysis'] !== false;
        const explainButton = premiumControl(
            `${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : ''}Explain Alert`,
            'ai-analysis',
            'alert-ai-button alert-ai-explain',
            `data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-ai-explain" title="${aiAvailable ? 'Explain this alert with IBMEye AI' : 'IBMEye AI requires Premium'}"`
        );
        const nextActionsButton = premiumControl(
            `${aiAvailable ? '<img src="assets/ibmeyeai-eye-open.svg" alt="" aria-hidden="true" class="alert-ai-button-icon">' : ''}Next Best Action`,
            'ai-analysis',
            'alert-ai-button alert-ai-next-actions',
            `data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-ai-next-actions" title="${aiAvailable ? 'Get the next best action with IBMEye AI' : 'IBMEye AI requires Premium'}"`
        );
        const clickUpButton = alert.clickUpTask?.id
            ? premiumIntegrationControl(
                'Open ClickUp Task',
                'clickup-integration',
                'alert-clickup-open',
                `data-task-url="${escapeHtml(alert.clickUpTask.url || '')}" data-testid="alert-clickup-open" title="${entitlements.features?.['clickup-integration'] !== false ? 'Open linked ClickUp task' : 'ClickUp integration requires Premium'}"`
            )
            : '';
        const recheckButton = alert.isActive !== false
            ? `
                <button class="btn btn-outline-ink btn-sm alert-recheck" data-alert-id="${escapeHtml(alert.id)}" data-testid="alert-recheck"${pendingRecheckAlertIds.has(alert.id) ? ' disabled' : ''}>
                    <i class="bi bi-arrow-repeat me-1"></i>${pendingRecheckAlertIds.has(alert.id) ? 'Checking...' : 'Recheck'}
                </button>
            `
            : '';
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
        const summaryLabel = alert.jobName || alert.message;

        return `
            <article
                class="alert-entry is-${escapeHtml(alert.severity)}${alert.isActive === false ? ' is-resolved' : ''}${isFocused ? ' is-focused' : ''}"
                data-testid="${isFocused ? 'focus-alert-card' : 'alert-card'}"
                data-alert-id="${escapeHtml(alert.id)}"
            >
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
                        ${recoveryMarkup}
                        ${ownerMarkup}
                        ${timelineMarkup}
                        ${noteComposerMarkup}
                        <div class="alert-actions">
                            ${acknowledgeButton}
                            ${claimButton}
                            ${releaseButton}
                            ${workDoneButton}
                            ${noteButton}
                            ${explainButton}
                            ${nextActionsButton}
                            ${clickUpButton}
                            ${recheckButton}
                            ${openJobButton}
                        </div>
                    </div>
                ` : ''}
            </article>
        `;
    }

    function renderAlerts(alerts) {
        if (!activeAlerts || !focusAlertShell || !focusAlertCard) {
            return;
        }

        const scrollState = captureAlertScrollState();
        const nextAlerts = Array.isArray(alerts) ? alerts : [];
        latestAlerts = nextAlerts;
        const pinnedAlert = focusedAlertId
            ? nextAlerts.find((alert) => alert.id === focusedAlertId) || null
            : null;
        if (focusedAlertId && (!pinnedAlert || pinnedAlert.isActive === false)) {
            focusedAlertId = null;
        }
        if (noteComposerAlertId && !nextAlerts.some((alert) => alert?.id === noteComposerAlertId)) {
            noteComposerAlertId = null;
        }
        const activeAlertTotal = nextAlerts.filter((alert) => alert?.isActive !== false).length;

        if (alertCount) {
            const label = activeAlertTotal === 1 ? 'alert' : 'alerts';
            alertCount.textContent = `${activeAlertTotal} active ${label} | ${nextAlerts.length} tracked`;
        }

        const focusedAlert = focusedAlertId
            ? nextAlerts.find((alert) => alert.id === focusedAlertId) || null
            : null;
        if (focusedAlert && focusedAlertId !== focusedAlert.id) {
            focusedAlertId = focusedAlert.id;
        }
        updateAlertActionSummary(nextAlerts, focusedAlert);
        const searchedAlerts = alertSearchQuery
            ? nextAlerts.filter((alert) => {
                const haystack = [
                    alert.id, alert.title, alert.message, alert.detail, alert.jobName, alert.owner,
                    ...(alert.notes || []).map((note) => note.text)
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(alertSearchQuery);
            })
            : nextAlerts;
        const visibleAlerts = searchedAlerts.filter((alert) => matchesAlertFilter(alert));
        const visibleFocusedAlert = focusedAlert && visibleAlerts.some((alert) => alert.id === focusedAlert.id)
            ? focusedAlert
            : null;
        const queuedAlerts = visibleFocusedAlert
            ? visibleAlerts.filter((alert) => alert.id !== visibleFocusedAlert.id)
            : visibleAlerts;

        if (visibleFocusedAlert) {
            focusAlertShell.hidden = false;
            focusAlertCard.innerHTML = buildAlertMarkup(visibleFocusedAlert, {
                expanded: true,
                focused: true
            });
        } else {
            focusAlertShell.hidden = true;
            focusAlertCard.innerHTML = '';
        }

        if (!queuedAlerts.length) {
            const emptyMessage = alertSearchQuery
                ? 'No alerts match this search.'
                : alertFilter !== 'all'
                    ? `No ${alertFilter === 'attention' ? 'incidents needing attention' : `${alertFilter} incidents`} right now.`
                    : visibleFocusedAlert
                        ? 'No other alerts in the queue.'
                        : 'No active alerts.';
            activeAlerts.innerHTML = `
                <div class="activity-log-empty">
                    <i class="bi bi-shield-check"></i>
                    <span>${emptyMessage}</span>
                </div>
            `;
            return;
        }

        activeAlerts.innerHTML = queuedAlerts.map((alert) => buildAlertMarkup(alert, {
            expanded: expandedAlertIds.has(alert.id)
        })).join('');

        restoreAlertScrollState(scrollState);
    }

    function applyPremiumUi() {
        const premium = entitlements.plan === 'premium';
        document.querySelectorAll('.ibmeyeai-panel input, .ibmeyeai-panel textarea, .ibmeyeai-panel button, #ibmeyeai-widget-input, #ibmeyeai-widget-submit').forEach((control) => {
            if (premium) return;
            control.disabled = true;
            control.classList.add('premium-locked');
            control.title = 'IBMEye AI requires Premium';
        });
        if (detailWaitAiButton) {
            const aiAvailable = entitlements.features?.['ai-analysis'] !== false;
            detailWaitAiButton.disabled = !aiAvailable || !selectedJobName;
            detailWaitAiButton.classList.toggle('premium-locked', !aiAvailable);
            detailWaitAiButton.title = aiAvailable ? 'Analyze this wait with IBMEye AI' : 'IBMEye AI requires Premium';
        }
        renderAlerts(latestAlerts);
    }

    function openAlertNoteComposer(alertId) {
        const alert = latestAlerts.find((entry) => entry.id === alertId);
        if (alert && isClaimedAlert(alert) && getAlertOwner(alert) && !isOwnedByCurrentOperator(alert)) {
            return;
        }
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

    function setFocusedAlert(alertId) {
        focusedAlertId = alertId || null;
        if (alertId) {
            expandedAlertIds.add(alertId);
        }
        renderAlerts(latestAlerts);
    }

    function clearFocusedAlert(alertId) {
        if (!alertId || focusedAlertId === alertId) {
            focusedAlertId = null;
        }
        renderAlerts(latestAlerts);
    }

    function focusNextAlert() {
        const candidates = latestAlerts
            .filter((alert) => (
                alert?.isActive !== false
                && matchesAlertFilter(alert, 'attention')
                && (!isClaimedAlert(alert) || isOwnedByCurrentOperator(alert))
            ))
            .sort((left, right) => getAlertPriorityScore(right) - getAlertPriorityScore(left));
        const fallbackCandidates = latestAlerts
            .filter((alert) => (
                alert?.isActive !== false
                && (!isClaimedAlert(alert) || isOwnedByCurrentOperator(alert))
            ))
            .sort((left, right) => getAlertPriorityScore(right) - getAlertPriorityScore(left));
        const orderedCandidates = candidates.length ? candidates : fallbackCandidates;
        const nextAlert = orderedCandidates.find((alert) => alert.id !== focusedAlertId) || orderedCandidates[0];
        if (!nextAlert) {
            return;
        }

        if (alertsPanel instanceof HTMLDetailsElement) {
            alertsPanel.open = true;
        }
        setFocusedAlert(nextAlert.id);
        window.requestAnimationFrame(() => {
            focusAlertShell?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    function openActionboardSection(section) {
        const target = {
            incidents: alertsPanel,
            queues: jobQueuesPanel,
            ai: aiPanel,
            jobs: activeJobsPanel
        }[section];
        if (!target) {
            return;
        }

        if (target instanceof HTMLDetailsElement) {
            target.open = true;
        }
        target.classList.remove('is-command-target');
        window.requestAnimationFrame(() => {
            target.classList.add('is-command-target');
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            window.setTimeout(() => target.classList.remove('is-command-target'), 900);
        });
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

    function toggleIncidentHistory(alertId) {
        if (expandedTimelineAlertIds.has(alertId)) {
            expandedTimelineAlertIds.delete(alertId);
        } else {
            expandedTimelineAlertIds.add(alertId);
        }

        renderAlerts(latestAlerts);
    }

    function handleAlertInteraction(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const toggleButton = target.closest('.alert-toggle');
        if (toggleButton?.dataset?.alertId) {
            toggleAlertExpanded(toggleButton.dataset.alertId);
            return;
        }

        const historyToggle = target.closest('.alert-history-toggle');
        if (historyToggle?.dataset?.alertId) {
            toggleIncidentHistory(historyToggle.dataset.alertId);
            return;
        }

        const recheckButton = target.closest('.alert-recheck');
        if (recheckButton?.dataset?.alertId) {
            const alertId = recheckButton.dataset.alertId;
            pendingRecheckAlertIds.add(alertId);
            renderAlerts(latestAlerts);
            void window.electronAPI.recheckAlert(alertId).then((result) => {
                if (result?.status === 'cleared') {
                    setOperatorStatus('Alert rechecked', 'success', 'The condition is clear on IBM i.');
                }
                if (result?.status === 'unavailable' && result.error) {
                    setOperatorStatus('Alert recheck unavailable', 'warning', result.error);
                }
            }).catch((error) => {
                console.error('Unable to recheck alert:', error);
            }).finally(() => {
                pendingRecheckAlertIds.delete(alertId);
                renderAlerts(latestAlerts);
            });
            return;
        }

        const noteSaveButton = target.closest('.alert-note-save');
        if (noteSaveButton?.dataset?.alertId) {
            const note = String(noteDraftByAlertId.get(noteSaveButton.dataset.alertId) || '').trim();
            if (!note) {
                return;
            }

            void window.electronAPI.updateAlertWorkflow({
                alertId: noteSaveButton.dataset.alertId,
                action: 'note',
                note,
                owner: currentOperatorName
            });
            noteDraftByAlertId.delete(noteSaveButton.dataset.alertId);
            noteComposerAlertId = null;
            return;
        }

        const noteCancelButton = target.closest('.alert-note-cancel');
        if (noteCancelButton?.dataset?.alertId) {
            noteDraftByAlertId.delete(noteCancelButton.dataset.alertId);
            closeAlertNoteComposer();
            return;
        }

        const workflowButton = target.closest('.alert-acknowledge, .alert-claim, .alert-release, .alert-work-done, .alert-note-action');
        if (workflowButton?.dataset?.alertId) {
            const action = workflowButton.classList.contains('alert-acknowledge')
                ? 'acknowledge'
                : workflowButton.classList.contains('alert-claim')
                    ? 'claim'
                    : workflowButton.classList.contains('alert-release')
                        ? 'release'
                        : workflowButton.classList.contains('alert-work-done')
                            ? 'workDone'
                        : 'note';

            if (action === 'note') {
                openAlertNoteComposer(workflowButton.dataset.alertId);
                return;
            }

            if (action === 'claim') {
                setFocusedAlert(workflowButton.dataset.alertId);
            }
            if (action === 'release') {
                clearFocusedAlert(workflowButton.dataset.alertId);
            }

            void window.electronAPI.updateAlertWorkflow({
                alertId: workflowButton.dataset.alertId,
                action,
                owner: currentOperatorName
            });
            return;
        }

        const aiExplainButton = target.closest('.alert-ai-explain');
        if (aiExplainButton?.dataset?.alertId) {
            const alert = latestAlerts.find((entry) => entry.id === aiExplainButton.dataset.alertId);
            if (!alert) {
                return;
            }

            aiAssistant.openWidget();
            void aiAssistant.submitPrompt(buildAlertExplanationPrompt(alert));
            return;
        }

        const aiNextActionsButton = target.closest('.alert-ai-next-actions');
        if (aiNextActionsButton?.dataset?.alertId) {
            const alert = latestAlerts.find((entry) => entry.id === aiNextActionsButton.dataset.alertId);
            if (!alert) {
                return;
            }

            aiAssistant.openWidget();
            void aiAssistant.submitPrompt(buildAlertNextActionsPrompt(alert));
            return;
        }

        const clickUpOpenButton = target.closest('.alert-clickup-open');
        if (clickUpOpenButton?.dataset?.taskUrl) {
            void window.electronAPI.openExternalUrl(clickUpOpenButton.dataset.taskUrl);
            return;
        }

        const openJobButton = target.closest('.alert-open-job');
        if (openJobButton?.dataset?.jobName) {
            void loadJobDetails(openJobButton.dataset.jobName);
        }
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
        if (highCpuRecoveryPolls) {
            highCpuRecoveryPolls.value = String(settings.highCpuRecoveryPolls ?? 3);
        }
        if (watchMessageWait) {
            watchMessageWait.checked = Boolean(settings.watchMessageWait);
        }
        if (watchLockWait) {
            watchLockWait.checked = Boolean(settings.watchLockWait);
        }
        if (watchDelayWait) {
            watchDelayWait.checked = Boolean(settings.watchDelayWait);
        }
        if (watchDequeueWait) {
            watchDequeueWait.checked = Boolean(settings.watchDequeueWait);
        }
        if (watchFailedPolls) {
            watchFailedPolls.checked = Boolean(settings.watchFailedPolls);
        }
        if (watchDisconnects) {
            watchDisconnects.checked = Boolean(settings.watchDisconnects);
        }
    }

    function applyEmailNotificationSettings(settings) {
        if (!settings) {
            return;
        }

        if (emailNotificationsEnabled) {
            emailNotificationsEnabled.checked = Boolean(settings.enabled);
        }
        if (emailSmtpHost) {
            emailSmtpHost.value = settings.smtpHost || '';
        }
        if (emailSmtpPort) {
            emailSmtpPort.value = String(settings.smtpPort || 587);
        }
        if (emailSmtpSecure) {
            emailSmtpSecure.checked = Boolean(settings.secure);
        }
        if (emailUsername) {
            emailUsername.value = settings.username || '';
        }
        if (emailPassword) {
            emailPassword.value = settings.password || '';
        }
        if (emailFromAddress) {
            emailFromAddress.value = settings.fromAddress || '';
        }
        if (emailToAddresses) {
            emailToAddresses.value = settings.toAddresses || '';
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

        if (detailAiHealth) {
            detailAiHealth.disabled = true;
        }
        if (detailWaitAiButton) {
            detailWaitAiButton.disabled = true;
        }
        if (detailWaitAiReport) {
            detailWaitAiReport.hidden = true;
        }
        if (detailWaitAiContent) {
            detailWaitAiContent.innerHTML = '';
        }
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
        if (detailAiHealth) {
            detailAiHealth.disabled = false;
        }
        if (detailWaitAiButton) {
            const aiAvailable = entitlements.features?.['ai-analysis'] !== false;
            detailWaitAiButton.disabled = !aiAvailable;
            detailWaitAiButton.classList.toggle('premium-locked', !aiAvailable);
        }
        if (detailWaitReason) {
            detailWaitReason.textContent = payload.waitReason || 'No wait reason available.';
        }
        renderRootCauseGuidanceView({
            detailGuidanceHeadline,
            detailGuidanceSeverity,
            detailGuidanceImpact,
            detailGuidanceCause,
            detailGuidanceSteps,
            detailGuidanceTechnical
        }, payload.guidance);
        renderOperatorActionsView(detailOperatorActions, detailOperatorActionNote, payload.actions);
        renderStatusHistoryView(detailStatusHistory, payload.statusHistory || []);

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
            if (detailWaitAiReport) {
                detailWaitAiReport.hidden = true;
            }
            if (detailWaitAiContent) {
                detailWaitAiContent.innerHTML = '';
            }
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
            const [history, alerts, settings, emailSettings, themeSettings, appFlags] = await Promise.all([
                window.electronAPI.getMonitoringHistory(),
                window.electronAPI.getActiveAlerts(),
                window.electronAPI.getAlertSettings(),
                window.electronAPI.getEmailNotificationSettings(),
                window.electronAPI.getThemeSettings(),
                window.electronAPI.getAppFlags()
            ]);

            currentOperatorName = String(appFlags?.operatorName || '').trim() || 'local-operator';
            renderHistory(history);
            renderAlerts(alerts);
            applyAlertSettings(settings);
            applyEmailNotificationSettings(emailSettings);
            renderThemeSettings(themeSettings);
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
                return state;
            }

            setMonitoringState(false, 'idle');
            return state;
        } catch (error) {
            console.error('Error initializing monitoring:', error);
            setMonitoringState(false, 'idle');
            return null;
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

    refreshInterval?.addEventListener('change', (event) => {
        if (monitoring) {
            const nextInterval = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(nextInterval)) {
                window.electronAPI.startMonitoring(nextInterval);
            }
        }
        updateRefreshLabel();
    });

    jobsSubsystemFilter?.addEventListener('change', (event) => {
        jobFilters = {
            ...jobFilters,
            subsystem: event.target.value || 'ALL'
        };
        renderJobs({ data: latestJobs });
    });

    jobsSearchInput?.addEventListener('input', (event) => {
        jobFilters = {
            ...jobFilters,
            query: event.target.value || ''
        };
        renderJobs({ data: latestJobs });
    });

    jobsQuickFilterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            jobFilters = {
                ...jobFilters,
                status: button.dataset.jobFilter || 'ALL'
            };
            renderJobs({ data: latestJobs });
        });
    });

    alertSearchInput?.addEventListener('input', (event) => {
        alertSearchQuery = String(event.target?.value || '').trim().toLowerCase();
        renderAlerts(latestAlerts);
    });

    alertQuickFilterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            alertFilter = button.dataset.alertFilter || 'all';
            renderAlerts(latestAlerts);
        });
    });

    focusNextAlertButton?.addEventListener('click', focusNextAlert);
    heroFocusNextButton?.addEventListener('click', () => {
        if (focusedAlertId) {
            openActionboardSection('incidents');
            window.requestAnimationFrame(() => focusAlertShell?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            return;
        }
        focusNextAlert();
    });
    actionboardQuickLinks.forEach((button) => {
        button.addEventListener('click', () => openActionboardSection(button.dataset.actionboardTarget));
    });

    themeSelector?.addEventListener('change', async (event) => {
        const nextThemeId = event.target.value;

        try {
            const settings = await window.electronAPI.saveThemeSettings(nextThemeId);
            renderThemeSettings(settings);
            if (themeMenu instanceof HTMLDetailsElement) {
                themeMenu.open = false;
            }
        } catch (error) {
            console.error('Error saving theme settings:', error);
        }
    });

    themeMenuOptions?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const option = target.closest('[data-theme-id]');
        if (!(option instanceof HTMLElement) || !themeSelector) {
            return;
        }

        const nextThemeId = option.dataset.themeId || '';
        if (!nextThemeId || nextThemeId === themeSelector.value) {
            return;
        }

        themeSelector.value = nextThemeId;
        themeSelector.dispatchEvent(new Event('change', { bubbles: true }));
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
                highCpuRecoveryPolls: Number.parseInt(highCpuRecoveryPolls?.value || '3', 10) || 3,
                watchMessageWait: Boolean(watchMessageWait?.checked),
                watchLockWait: Boolean(watchLockWait?.checked),
                watchDelayWait: Boolean(watchDelayWait?.checked),
                watchDequeueWait: Boolean(watchDequeueWait?.checked),
                watchFailedPolls: Boolean(watchFailedPolls?.checked),
                watchDisconnects: Boolean(watchDisconnects?.checked)
            });
            const emailSettings = await window.electronAPI.saveEmailNotificationSettings({
                enabled: Boolean(emailNotificationsEnabled?.checked),
                smtpHost: emailSmtpHost?.value || '',
                smtpPort: Number.parseInt(emailSmtpPort?.value || '587', 10) || 587,
                secure: Boolean(emailSmtpSecure?.checked),
                username: emailUsername?.value || '',
                password: emailPassword?.value || '',
                fromAddress: emailFromAddress?.value || '',
                toAddresses: emailToAddresses?.value || ''
            });
            applyAlertSettings(settings);
            applyEmailNotificationSettings(emailSettings);
            setEmailSettingsStatus('Notification settings saved.');
        } catch (error) {
            console.error('Error saving alert settings:', error);
            setEmailSettingsStatus(error.message || 'Unable to save email notification settings.', true);
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });

    sendTestEmailButton?.addEventListener('click', async () => {
        sendTestEmailButton.disabled = true;
        setEmailSettingsStatus('Sending test email...');

        try {
            const saveResult = await window.electronAPI.saveEmailNotificationSettings({
                enabled: Boolean(emailNotificationsEnabled?.checked),
                smtpHost: emailSmtpHost?.value || '',
                smtpPort: Number.parseInt(emailSmtpPort?.value || '587', 10) || 587,
                secure: Boolean(emailSmtpSecure?.checked),
                username: emailUsername?.value || '',
                password: emailPassword?.value || '',
                fromAddress: emailFromAddress?.value || '',
                toAddresses: emailToAddresses?.value || ''
            });
            applyEmailNotificationSettings(saveResult);

            const result = await window.electronAPI.sendTestEmailNotification();
            if (!result.success) {
                throw new Error(result.error || 'Test email failed.');
            }

            setEmailSettingsStatus('Test email sent.');
        } catch (error) {
            console.error('Error sending test email:', error);
            setEmailSettingsStatus(error.message || 'Test email failed.', true);
        } finally {
            sendTestEmailButton.disabled = false;
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

    activeAlerts?.addEventListener('click', handleAlertInteraction);

    focusAlertCard?.addEventListener('click', handleAlertInteraction);

    activeAlerts?.addEventListener('input', (event) => {
        const noteInput = event.target.closest('.alert-note-input');
        if (!noteInput?.dataset?.alertId) {
            return;
        }

        noteDraftByAlertId.set(noteInput.dataset.alertId, noteInput.value);
    });

    focusAlertCard?.addEventListener('input', (event) => {
        const noteInput = event.target.closest('.alert-note-input');
        if (!noteInput?.dataset?.alertId) {
            return;
        }

        noteDraftByAlertId.set(noteInput.dataset.alertId, noteInput.value);
    });

    releaseFocusAlertButton?.addEventListener('click', () => {
        const alertId = focusedAlertId;
        if (!alertId) {
            return;
        }

        clearFocusedAlert(alertId);
        void window.electronAPI.updateAlertWorkflow({
            alertId,
            action: 'release',
            owner: currentOperatorName
        });
    });

    openSettingsButton?.addEventListener('click', () => {
        void window.electronAPI.navigateToSettings();
    });

    openObjectAnalysisButton?.addEventListener('click', () => {
        void window.electronAPI.navigateToObjectAnalysis();
    });

    openAiSettingsButton?.addEventListener('click', () => {
        void window.electronAPI.navigateToSettings();
    });

    detailOperatorActions?.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('.job-action-button');
        if (!actionButton?.dataset?.actionKind || !selectedJobName) {
            return;
        }

        const actionKind = actionButton.dataset.actionKind;
        const confirmationMessage = actionKind === 'endJob'
            ? `End ${selectedJobName} with a controlled end?`
            : `${actionButton.textContent.trim()} for ${selectedJobName}?`;
        if (['holdJob', 'releaseJob', 'endJob', 'replyMessage'].includes(actionKind)
            && !window.confirm(confirmationMessage)) {
            return;
        }

        const originalMarkup = actionButton.innerHTML;
        actionButton.disabled = true;
        actionButton.innerHTML = 'Working...';

        try {
            const result = await window.electronAPI.runJobAction({
                kind: actionKind,
                jobName: selectedJobName,
                confirmed: true
            });

            if (!result?.success) {
                if (detailOperatorActionNote) {
                    detailOperatorActionNote.textContent = result?.error || 'The action could not be completed.';
                }
                return;
            }

            await loadJobDetails(selectedJobName);
            if (detailOperatorActionNote) {
                detailOperatorActionNote.textContent = result.message || 'Action completed successfully.';
            }
        } catch (error) {
            if (detailOperatorActionNote) {
                detailOperatorActionNote.textContent = error?.message || 'The action failed.';
            }
        } finally {
            actionButton.disabled = false;
            actionButton.innerHTML = originalMarkup;
        }
    });

    detailAiHealth?.addEventListener('click', () => {
        if (!selectedJobName) {
            return;
        }

        aiAssistant.openWidget();
        void aiAssistant.submitPrompt(buildSelectedJobHealthPrompt(selectedJobName));
    });

    function formatWaitAnalysisEvidence(job, payload, messages, logs) {
        const formatRecord = (record) => Object.entries(record ?? {})
            .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
            .map(([key, value]) => `${key}: ${String(value).slice(0, 500)}`)
            .join(' | ');
        const formatRecords = (records, emptyMessage) => {
            const values = Array.isArray(records) ? records.slice(-12).map(formatRecord).filter(Boolean) : [];
            return values.length ? values.join('\n') : emptyMessage;
        };

        return [
            'Wait-analysis evidence for the selected IBM i job. This data is for internal analysis; present conclusions in plain operator language.',
            `Job: ${job?.JOB_NAME || selectedJobName || 'Unknown'}`,
            `Status: ${job?.STATUS || 'Unknown'}`,
            `Wait reason: ${payload?.waitReason || 'Unknown'}`,
            `Function: ${job?.FUNCTION_NAME || 'Unknown'}`,
            `CPU: ${job?.CPU ?? 'Unknown'}; elapsed CPU: ${job?.ELAPSED_CPU_TIME ?? 'Unknown'}`,
            `Message reply capable: ${job?.MESSAGE_REPLY || 'Unknown'}`,
            `Status history:\n${formatRecords(payload?.statusHistory, 'No status history returned.')}`,
            `Job messages:\n${formatRecords(messages, 'No job messages returned.')}`,
            `Recent job log:\n${formatRecords(logs, 'No job log returned.')}`
        ].join('\n');
    }

    detailWaitAiButton?.addEventListener('click', async () => {
        if (!selectedJobName || entitlements.features?.['ai-analysis'] === false) {
            return;
        }

        const selectedJob = latestJobs.find((job) => getJobKey(job) === selectedJobName);
        const waitReason = detailWaitReason?.textContent || '';
        if (detailWaitAiReport) {
            detailWaitAiReport.hidden = false;
        }
        if (detailWaitAiStatus) {
            detailWaitAiStatus.textContent = 'Gathering IBM i evidence…';
        }
        if (detailWaitAiContent) {
            detailWaitAiContent.innerHTML = '<p class="ai-report-pending"><i class="bi bi-hourglass-split me-2"></i>Checking the job messages and recent job log…</p>';
        }
        detailWaitAiButton.disabled = true;

        try {
            const [messageResult, logResult, detailsResult] = await Promise.all([
                window.electronAPI.getJobMessages(selectedJobName),
                window.electronAPI.getJobLog(selectedJobName),
                window.electronAPI.getJobDetails(selectedJobName)
            ]);
            if (!messageResult?.success) {
                throw new Error(messageResult?.error || 'The job message context could not be loaded.');
            }
            if (!logResult?.success) {
                throw new Error(logResult?.error || 'The recent job log could not be loaded.');
            }
            const payload = detailsResult || { job: selectedJob, waitReason, statusHistory: [] };
            const result = await window.electronAPI.askAiAssistant({
                message: buildWaitAnalysisPrompt({
                    jobName: selectedJobName,
                    waitReason: payload.waitReason || waitReason
                }),
                selectedJobName,
                additionalContext: formatWaitAnalysisEvidence(
                    payload.job || selectedJob,
                    payload,
                    messageResult.records,
                    logResult.records
                )
            });
            if (!result?.success) {
                throw new Error(result?.error || 'IBMEye AI could not complete the wait analysis.');
            }
            if (detailWaitAiStatus) {
                detailWaitAiStatus.textContent = 'Analysis complete';
            }
            if (detailWaitAiContent) {
                detailWaitAiContent.innerHTML = renderAiReportMarkdown(result.reply || 'No analysis was returned.');
            }
        } catch (error) {
            if (detailWaitAiStatus) {
                detailWaitAiStatus.textContent = 'Analysis unavailable';
            }
            if (detailWaitAiContent) {
                detailWaitAiContent.innerHTML = `<p class="ai-report-error">${escapeHtml(error?.message || 'Unable to complete the wait analysis.')}</p>`;
            }
        } finally {
            detailWaitAiButton.disabled = false;
        }
    });

    async function loadOnDemandJobData(button, output, loader, successMessage) {
        if (!selectedJobName || !button || !output) {
            return;
        }

        button.disabled = true;
        if (jobOnDemandStatus) {
            jobOnDemandStatus.textContent = 'Loading requested IBM i details...';
        }

        try {
            const result = await loader(selectedJobName);
            if (!result?.success) {
                throw new Error(result?.error || 'The requested IBM i details could not be loaded.');
            }

            if (jobOnDemandStatus) {
                jobOnDemandStatus.textContent = successMessage;
            }
            return result;
        } catch (error) {
            if (jobOnDemandStatus) {
                jobOnDemandStatus.textContent = error?.message || 'The requested IBM i details could not be loaded.';
            }
            output.innerHTML = `<div class="status-history-empty">${escapeHtml(error?.message || 'Unable to load details.')}</div>`;
            return null;
        } finally {
            button.disabled = false;
        }
    }

    loadJobLogButton?.addEventListener('click', async () => {
        const result = await loadOnDemandJobData(
            loadJobLogButton,
            jobLogOutput,
            (jobName) => window.electronAPI.getJobLog(jobName),
            'Recent job log loaded.'
        );
        if (result?.success) {
            renderJobLogView(jobLogOutput, result.records);
        }
    });

    loadJobMessagesButton?.addEventListener('click', async () => {
        const result = await loadOnDemandJobData(
            loadJobMessagesButton,
            jobMessagesOutput,
            (jobName) => window.electronAPI.getJobMessages(jobName),
            'Job message context loaded.'
        );
        if (result?.success) {
            renderJobMessagesView(jobMessagesOutput, result.records);
        }
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
    setOperatorStatus('Waiting for monitoring', 'info', 'Preparing the first IBM i snapshot.');
    renderHistory([]);
    renderAlerts([]);

    window.electronAPI.onStatusUpdate((data) => {
        renderJobs(data);
        void jobQueues.refresh({ silent: true, onlyIfEmpty: true });
        setMonitoringState(true, 'live');
        setOperatorStatus('Monitoring healthy', 'success', `Last update ${new Date().toLocaleTimeString()}`);
        void aiAssistant.refresh();
    });

    window.electronAPI.onMonitoringError((error) => {
        showTableMessage('Monitoring is temporarily unavailable. Retrying automatically.', 'bi-exclamation-triangle', 'text-danger');
        updateLastUpdated('Last update failed');
        setMonitoringState(false, 'error');
        setOperatorStatus('Monitoring needs attention', 'error', 'Retrying the IBM i connection automatically.');
    });

    window.addEventListener('error', () => {
        setOperatorStatus('The app needs attention', 'error', 'Please contact support if this continues.');
    });
    window.addEventListener('unhandledrejection', () => {
        setOperatorStatus('The app needs attention', 'error', 'Please contact support if this continues.');
    });

    window.electronAPI.onMonitoringHistoryUpdated((history) => {
        renderHistory(history);
    });

    window.electronAPI.onAlertsUpdated((alerts) => {
        renderAlerts(alerts);
        void aiAssistant.refresh();
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

        const monitoringState = await initializeMonitoring();
        if (!monitoringState?.active && !latestJobs.length) {
            startMonitoring();
        }
    })();
});
