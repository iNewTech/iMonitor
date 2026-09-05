function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

function queueKey(queue) {
    return `${queue.JOB_QUEUE_LIBRARY}/${queue.JOB_QUEUE_NAME}`;
}

function formatTimestamp(value) {
    if (!value) {
        return '--';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return escapeHtml(value);
    }

    return escapeHtml(date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }));
}

function formatStatus(value) {
    return String(value || 'UNKNOWN').replaceAll('_', ' ').toLocaleLowerCase()
        .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? count.toLocaleString() : '0';
}

function firstValue(record, keys, fallback = null) {
    const key = keys.find((candidate) => record?.[candidate] !== null
        && record?.[candidate] !== undefined
        && String(record[candidate]).trim() !== '');
    return key ? record[key] : fallback;
}

function displayValue(value, fallback = '--') {
    if (value === null || value === undefined || String(value).trim() === '') {
        return fallback;
    }
    return escapeHtml(value);
}

function renderQueueMetric(label, value, meta = '') {
    return `
        <div class="job-queue-detail-metric">
            <span>${escapeHtml(label)}</span>
            <strong>${displayValue(value)}</strong>
            ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
        </div>
    `;
}

function buildSearchQueueRecords(jobs) {
    const grouped = new Map();
    jobs.forEach((job) => {
        const key = `${job.JOB_QUEUE_LIBRARY}/${job.JOB_QUEUE_NAME}`;
        const existing = grouped.get(key);
        if (existing) {
            existing.WAITING_JOBS += 1;
            if (job.JOB_QUEUE_TIME && (!existing.OLDEST_WAIT_TIME || job.JOB_QUEUE_TIME < existing.OLDEST_WAIT_TIME)) {
                existing.OLDEST_WAIT_TIME = job.JOB_QUEUE_TIME;
            }
            if (!existing.SUBSYSTEM_NAME && job.SUBSYSTEM) {
                existing.SUBSYSTEM_NAME = job.SUBSYSTEM;
            }
            if (!existing.SUBSYSTEM_LIBRARY_NAME && job.SUBSYSTEM_LIBRARY_NAME) {
                existing.SUBSYSTEM_LIBRARY_NAME = job.SUBSYSTEM_LIBRARY_NAME;
            }
            return;
        }

        grouped.set(key, {
            JOB_QUEUE_NAME: job.JOB_QUEUE_NAME,
            JOB_QUEUE_LIBRARY: job.JOB_QUEUE_LIBRARY,
            JOB_QUEUE_STATUS: job.JOB_QUEUE_STATUS || 'UNKNOWN',
            SUBSYSTEM_NAME: job.SUBSYSTEM || null,
            SUBSYSTEM_LIBRARY_NAME: job.SUBSYSTEM_LIBRARY_NAME || null,
            SEQUENCE_NUMBER: null,
            OPERATOR_CONTROLLED: null,
            WAITING_JOBS: 1,
            ACTIVE_JOBS: null,
            MAX_ACTIVE_JOBS: null,
            HELD_JOBS: null,
            TEXT_DESCRIPTION: 'Found from the latest queued-job search',
            OLDEST_WAIT_TIME: job.JOB_QUEUE_TIME || null,
            _searchMatchedJob: true
        });
    });
    return [...grouped.values()];
}

export function initJobQueues({ root = document, electronAPI = window.electronAPI } = {}) {
    const panel = root.getElementById('job-queues-panel');
    const body = root.getElementById('job-queues-body');
    if (!panel || !body || !electronAPI?.getJobQueues || !electronAPI?.getQueuedJobs) {
        return { refresh: async () => undefined };
    }

    const searchInput = root.getElementById('job-queues-search');
    const statusFilter = root.getElementById('job-queues-status-filter');
    const refreshButton = root.getElementById('job-queues-refresh');
    const loadMoreButton = root.getElementById('job-queues-load-more');
    const queueCount = root.getElementById('job-queues-count');
    const waitingCount = root.getElementById('job-queues-waiting-count');
    const heldCount = root.getElementById('job-queues-held-count');
    const oldestWait = root.getElementById('job-queues-oldest');
    const pageNote = root.getElementById('job-queues-page-note');
    const statusElement = root.getElementById('job-queues-status');
    const expandedJobsByQueue = new Map();
    const expandedDetailsByQueue = new Map();
    const expandedQueueKeys = new Set();
    let queues = [];
    let nextCursor = null;
    let searchTimer = null;
    let requestNumber = 0;
    let loading = false;
    let hasLoaded = false;

    const currentQuery = () => ({
        search: searchInput?.value.trim() || '',
        status: statusFilter?.value || 'ALL'
    });

    function setStatus(message, isError = false) {
        if (!statusElement) {
            return;
        }
        statusElement.textContent = message;
        statusElement.classList.toggle('is-error', isError);
    }

    function updateSummary() {
        const waiting = queues.reduce((total, queue) => total + Number(queue.WAITING_JOBS || 0), 0);
        const held = queues.filter((queue) => String(queue.JOB_QUEUE_STATUS || '').toUpperCase() === 'HELD').length;
        const oldest = queues
            .map((queue) => queue.OLDEST_WAIT_TIME)
            .filter(Boolean)
            .sort()[0];
        const query = currentQuery();

        if (queueCount) {
            queueCount.textContent = `${queues.length} queue${queues.length === 1 ? '' : 's'}`;
        }
        if (waitingCount) {
            waitingCount.textContent = `${formatCount(waiting)} waiting`;
        }
        if (heldCount) {
            heldCount.textContent = `${held} held`;
        }
        if (oldestWait) {
            oldestWait.textContent = oldest ? `Oldest wait ${formatTimestamp(oldest)}` : 'Oldest wait --';
        }
        if (pageNote) {
            pageNote.textContent = query.search
                ? `Results for “${query.search}”`
                : `Showing ${queues.length}${nextCursor ? '+' : ''} queues`;
        }
        if (loadMoreButton) {
            loadMoreButton.hidden = !nextCursor;
        }
        panel.dispatchEvent(new CustomEvent('jobqueues:summary', {
            bubbles: true,
            detail: {
                queues: queues.length,
                waiting,
                held
            }
        }));
    }

    function renderJobRows(queue, entry) {
        if (entry.loading) {
            return '<div class="job-queue-inline-state"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Loading queued jobs…</div>';
        }
        if (entry.error) {
            return `<div class="job-queue-inline-state is-error">${escapeHtml(entry.error)}</div>`;
        }
        if (!entry.jobs.length) {
            return '<div class="job-queue-inline-state"><i class="bi bi-check2-circle" aria-hidden="true"></i>No jobs are waiting in this queue.</div>';
        }

        return `
            <div class="job-queue-expanded-header">
                <div>
                    <span class="eyebrow mb-1">Waiting jobs</span>
                    <strong>${formatCount(entry.jobs.length)} shown</strong>
                </div>
                <span class="table-caption">Oldest first</span>
            </div>
            <div class="table-responsive refined-table job-queue-jobs-table">
                <table class="table table-sm align-middle mb-0">
                    <thead><tr><th>Job</th><th>User</th><th>Waiting since</th><th>Status</th><th class="text-end">Action</th></tr></thead>
                    <tbody>
                        ${entry.jobs.map((job) => `
                            <tr>
                                <td><strong>${escapeHtml(job.JOB_NAME_SHORT || job.JOB_NAME)}</strong><small class="d-block text-muted">${escapeHtml(job.JOB_NAME)}</small></td>
                                <td>${escapeHtml(job.JOB_USER || '--')}</td>
                                <td>${formatTimestamp(job.JOB_QUEUE_TIME)}</td>
                                <td><span class="job-queue-status" data-status="${escapeHtml(job.JOB_STATUS || 'JOBQ')}">${escapeHtml(formatStatus(job.JOB_STATUS || 'JOBQ'))}</span></td>
                                <td class="text-end">
                                    <button type="button" class="btn btn-outline-ink btn-sm job-queue-action" data-action-kind="${String(job.JOB_STATUS).toUpperCase() === 'HELD' ? 'releaseQueuedJob' : 'holdQueuedJob'}" data-queue-name="${escapeHtml(queue.JOB_QUEUE_NAME)}" data-queue-library="${escapeHtml(queue.JOB_QUEUE_LIBRARY)}" data-job-name="${escapeHtml(job.JOB_NAME)}">
                                        ${String(job.JOB_STATUS).toUpperCase() === 'HELD' ? 'Release job' : 'Hold job'}
                                        <small class="premium-inline-label"><i class="bi bi-lock-fill" aria-hidden="true"></i>Premium</small>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ${entry.nextCursor ? '<button type="button" class="btn btn-outline-ink btn-sm job-queue-load-jobs" data-queue-name="' + escapeHtml(queue.JOB_QUEUE_NAME) + '" data-queue-library="' + escapeHtml(queue.JOB_QUEUE_LIBRARY) + '">Load more jobs</button>' : ''}
        `;
    }

    function renderQueueDetails(queue, entry) {
        const queueDetail = entry.queue || queue;
        const subsystemName = firstValue(queueDetail, ['SUBSYSTEM_NAME', 'SUBSYSTEM'], queue.SUBSYSTEM_NAME);
        const subsystemLibrary = firstValue(
            queueDetail,
            ['SUBSYSTEM_LIBRARY_NAME', 'SUBSYSTEM_LIBRARY'],
            queue.SUBSYSTEM_LIBRARY_NAME
        );
        const subsystem = entry.subsystem;
        const subsystemDisplay = subsystemName
            ? `${subsystemLibrary ? `${subsystemLibrary}/` : ''}${subsystemName}`
            : 'Not attached';
        const subsystemStatus = firstValue(subsystem, ['STATUS', 'SUBSYSTEM_STATUS']);
        const activeJobs = firstValue(queueDetail, ['ACTIVE_JOBS', 'CURRENT_ACTIVE_JOBS']);
        const maxActiveJobs = firstValue(queueDetail, ['MAXIMUM_ACTIVE_JOBS', 'MAX_ACTIVE_JOBS']);
        const sequence = firstValue(queueDetail, ['SEQUENCE_NUMBER', 'JOB_QUEUE_SEQUENCE']);
        const operatorControlled = firstValue(queueDetail, ['OPERATOR_CONTROLLED', 'OPERATOR_CONTROL']);
        const queueStatus = firstValue(queueDetail, ['JOB_QUEUE_STATUS', 'STATUS'], queue.JOB_QUEUE_STATUS);
        const subsystemActiveJobs = firstValue(subsystem, ['CURRENT_ACTIVE_JOBS', 'ACTIVE_JOBS']);
        const subsystemMaxActiveJobs = firstValue(subsystem, ['MAX_ACTIVE_JOBS', 'MAXIMUM_ACTIVE_JOBS']);
        const subsystemDescription = firstValue(subsystem, ['TEXT_DESCRIPTION', 'DESCRIPTION']);

        return `
            <section class="job-queue-details-card" data-testid="job-queue-details" aria-label="Queue details">
                <div class="job-queue-details-header">
                    <div>
                        <span class="eyebrow mb-1">Queue details</span>
                        <strong>${escapeHtml(queue.JOB_QUEUE_LIBRARY)}/${escapeHtml(queue.JOB_QUEUE_NAME)}</strong>
                    </div>
                    <span class="table-caption">${subsystemName ? `Attached to ${escapeHtml(subsystemDisplay)}` : 'No subsystem attachment found'}</span>
                </div>
                <div class="job-queue-details-grid">
                    ${renderQueueMetric('Attached subsystem', subsystemDisplay, subsystemName ? 'Subsystem' : 'Verify queue routing')}
                    ${renderQueueMetric('Queue status', formatStatus(queueStatus))}
                    ${renderQueueMetric('Active jobs', activeJobs)}
                    ${renderQueueMetric('Maximum active', maxActiveJobs)}
                    ${renderQueueMetric('Queue sequence', sequence)}
                    ${renderQueueMetric('Operator controlled', operatorControlled)}
                    ${renderQueueMetric('Subsystem status', subsystemStatus)}
                    ${renderQueueMetric('Subsystem workload', subsystemActiveJobs, subsystemMaxActiveJobs !== null ? `of ${subsystemMaxActiveJobs}` : '')}
                </div>
                ${subsystemDescription ? `<p class="job-queue-details-note mb-0">${escapeHtml(subsystemDescription)}</p>` : ''}
                ${entry.loading ? '<div class="job-queue-inline-state"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Loading subsystem details…</div>' : ''}
                ${entry.error ? `<div class="job-queue-inline-state is-error">${escapeHtml(entry.error)}</div>` : ''}
            </section>
        `;
    }

    function render() {
        updateSummary();
        if (!queues.length) {
            body.innerHTML = `
                <tr class="table-placeholder">
                    <td colspan="6" class="text-center py-4 text-muted">
                        <i class="bi bi-search fs-2 d-block mb-2"></i>
                        No matching job queues
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = queues.map((queue) => {
            const key = queueKey(queue);
            const entry = expandedJobsByQueue.get(key) || { jobs: [], nextCursor: null, loading: false, error: '' };
            const detailEntry = expandedDetailsByQueue.get(key) || { queue: null, subsystem: null, loading: false, error: '' };
            const isExpanded = expandedQueueKeys.has(key);
            const isHeld = String(queue.JOB_QUEUE_STATUS || '').toUpperCase() === 'HELD';
            return `
                <tr class="job-queue-row" data-queue-key="${escapeHtml(key)}">
                    <td>
                        <div class="job-queue-name-cell">
                            <button type="button" class="job-queue-toggle" aria-expanded="${isExpanded ? 'true' : 'false'}" data-queue-toggle="${escapeHtml(key)}" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(key)}">
                                <i class="bi bi-chevron-${isExpanded ? 'down' : 'right'}" aria-hidden="true"></i>
                            </button>
                            <div><strong>${escapeHtml(queue.JOB_QUEUE_NAME)}</strong><small>${escapeHtml(queue.JOB_QUEUE_LIBRARY)}</small></div>
                        </div>
                    </td>
                    <td class="job-queue-subsystem-cell">
                        <strong>${displayValue(queue.SUBSYSTEM_NAME, 'Not attached')}</strong>
                        ${queue.SUBSYSTEM_LIBRARY_NAME ? `<small>${escapeHtml(queue.SUBSYSTEM_LIBRARY_NAME)}</small>` : ''}
                    </td>
                    <td><span class="job-queue-status" data-status="${escapeHtml(queue.JOB_QUEUE_STATUS)}">${escapeHtml(formatStatus(queue.JOB_QUEUE_STATUS))}</span></td>
                    <td><strong>${formatCount(queue.WAITING_JOBS)}</strong></td>
                    <td>${escapeHtml(queue.TEXT_DESCRIPTION || 'IBM i job queue')}</td>
                    <td class="text-end">
                        <button type="button" class="btn btn-outline-ink btn-sm job-queue-action" data-action-kind="${isHeld ? 'releaseQueue' : 'holdQueue'}" data-queue-name="${escapeHtml(queue.JOB_QUEUE_NAME)}" data-queue-library="${escapeHtml(queue.JOB_QUEUE_LIBRARY)}">
                            ${isHeld ? 'Release queue' : 'Hold queue'}
                            <small class="premium-inline-label"><i class="bi bi-lock-fill" aria-hidden="true"></i>Premium</small>
                        </button>
                    </td>
                </tr>
                ${isExpanded ? `<tr class="job-queue-expanded-row"><td colspan="6"><div class="job-queue-expanded-shell">${renderQueueDetails(queue, detailEntry)}${renderJobRows(queue, entry)}</div></td></tr>` : ''}
            `;
        }).join('');
    }

    async function loadJobs(queue, { append = false } = {}) {
        const key = queueKey(queue);
        const existing = expandedJobsByQueue.get(key) || { jobs: [], nextCursor: null, loading: false, error: '' };
        const query = currentQuery();
        existing.loading = true;
        existing.error = '';
        expandedJobsByQueue.set(key, existing);
        render();

        try {
            const result = await electronAPI.getQueuedJobs({
                queueName: queue.JOB_QUEUE_NAME,
                queueLibrary: queue.JOB_QUEUE_LIBRARY,
                limit: 50,
                cursor: append ? existing.nextCursor : undefined
            });
            if (!result?.success) {
                throw new Error(result?.error || 'Unable to load waiting jobs.');
            }
            existing.jobs = append ? existing.jobs.concat(result.data || []) : (result.data || []);
            existing.nextCursor = result.nextCursor || null;
        } catch (error) {
            existing.error = error instanceof Error ? error.message : 'Unable to load waiting jobs.';
        } finally {
            existing.loading = false;
            render();
        }
    }

    async function loadQueueDetails(queue) {
        const key = queueKey(queue);
        const entry = expandedDetailsByQueue.get(key) || { queue: null, subsystem: null, loading: false, error: '' };
        if (!electronAPI.getJobQueueDetails) {
            return;
        }
        entry.loading = true;
        entry.error = '';
        expandedDetailsByQueue.set(key, entry);
        render();

        try {
            const result = await electronAPI.getJobQueueDetails(queue.JOB_QUEUE_NAME, queue.JOB_QUEUE_LIBRARY);
            if (!result?.success) {
                throw new Error(result?.error || 'Unable to load queue details.');
            }
            entry.queue = result.queue || null;
            entry.subsystem = result.subsystem || null;
        } catch (error) {
            entry.error = error instanceof Error ? error.message : 'Unable to load queue details.';
        } finally {
            entry.loading = false;
            render();
        }
    }

    async function loadPage({ append = false, silent = false, onlyIfEmpty = false } = {}) {
        if (onlyIfEmpty && (queues.length > 0 || currentQuery().search)) {
            return;
        }
        const request = ++requestNumber;
        loading = true;
        if (refreshButton) {
            refreshButton.disabled = true;
        }
        const query = currentQuery();
        if (!silent) {
            setStatus(append ? 'Loading more job queues…' : 'Loading job queues…');
        }

        try {
            const result = await electronAPI.getJobQueues({
                ...query,
                limit: 50,
                cursor: append ? nextCursor : undefined
            });
            if (request !== requestNumber) {
                return;
            }
            if (!result?.success) {
                throw new Error(result?.error || 'Unable to load job queues.');
            }

            const nextQueues = Array.isArray(result.data) ? result.data : [];
            if (!append && query.search && nextQueues.length === 0) {
                // A job search must be authoritative even when its queue was not
                // in the first queue page. QSYS2.JOB_INFO(*JOBQ) supplies it.
                const jobSearch = await electronAPI.getQueuedJobs({ search: query.search, status: query.status, limit: 50 });
                if (jobSearch?.success) {
                    nextQueues.push(...buildSearchQueueRecords(jobSearch.data || []));
                }
            }

            queues = append ? queues.concat(nextQueues) : nextQueues;
            nextCursor = result.nextCursor || null;
            if (!silent || !hasLoaded) {
                setStatus(queues.length
                    ? `${queues.length} queue${queues.length === 1 ? '' : 's'} available. Expand a queue to load waiting jobs.`
                    : query.search ? `No queue or waiting job matched “${query.search}”.` : 'No job queues were returned.');
            }
            hasLoaded = true;
            render();
        } catch (error) {
            if (request === requestNumber) {
                queues = append ? queues : [];
                nextCursor = null;
                if (!silent || !hasLoaded) {
                    setStatus(error instanceof Error ? error.message : 'Unable to load job queues.', true);
                }
                render();
            }
        } finally {
            if (request === requestNumber) {
                loading = false;
                if (refreshButton) {
                    refreshButton.disabled = false;
                }
            }
        }
    }

    body.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const toggle = target?.closest('[data-queue-toggle]');
        if (toggle) {
            const key = toggle.dataset.queueToggle;
            const queue = queues.find((candidate) => queueKey(candidate) === key);
            if (!queue) {
                return;
            }
            if (expandedQueueKeys.has(key)) {
                expandedQueueKeys.delete(key);
                expandedJobsByQueue.delete(key);
                expandedDetailsByQueue.delete(key);
                render();
            } else {
                expandedQueueKeys.add(key);
                expandedJobsByQueue.set(key, { jobs: [], nextCursor: null, loading: false, error: '' });
                expandedDetailsByQueue.set(key, { queue: null, subsystem: null, loading: false, error: '' });
                render();
                await Promise.all([loadJobs(queue), loadQueueDetails(queue)]);
            }
            return;
        }

        const loadJobsButton = target?.closest('.job-queue-load-jobs');
        if (loadJobsButton) {
            const queue = queues.find((candidate) => candidate.JOB_QUEUE_NAME === loadJobsButton.dataset.queueName && candidate.JOB_QUEUE_LIBRARY === loadJobsButton.dataset.queueLibrary);
            if (queue) {
                await loadJobs(queue, { append: true });
            }
            return;
        }

        const actionButton = target?.closest('.job-queue-action');
        if (!actionButton || !electronAPI.runJobQueueAction) {
            return;
        }
        const kind = actionButton.dataset.actionKind;
        const queueName = actionButton.dataset.queueName;
        const queueLibrary = actionButton.dataset.queueLibrary;
        const jobName = actionButton.dataset.jobName;
        const actionLabel = kind === 'holdQueue' || kind === 'holdQueuedJob' ? 'hold' : 'release';
        if (!window.confirm(`Are you sure you want to ${actionLabel} ${jobName || `${queueLibrary}/${queueName}`}?`)) {
            return;
        }
        actionButton.disabled = true;
        const result = await electronAPI.runJobQueueAction({
            kind,
            queueName,
            queueLibrary,
            jobName,
            confirmed: true
        });
        if (!result?.success) {
        setStatus(result?.error || 'The queue action could not be completed.', true);
            actionButton.disabled = false;
            return;
        }
        if (jobName) {
            const queue = queues.find((candidate) => candidate.JOB_QUEUE_NAME === queueName && candidate.JOB_QUEUE_LIBRARY === queueLibrary);
            if (queue) {
                const key = queueKey(queue);
                expandedQueueKeys.add(key);
                if (!expandedJobsByQueue.has(key)) {
                    expandedJobsByQueue.set(key, { jobs: [], nextCursor: null, loading: false, error: '' });
                }
                if (!expandedDetailsByQueue.has(key)) {
                    expandedDetailsByQueue.set(key, { queue: null, subsystem: null, loading: false, error: '' });
                }
                await loadJobs(queue);
            }
        } else {
            await loadPage();
        }
        setStatus(result.message || 'Queue action completed.');
    });

    searchInput?.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            expandedQueueKeys.clear();
            expandedJobsByQueue.clear();
            expandedDetailsByQueue.clear();
            void loadPage();
        }, 250);
    });
    statusFilter?.addEventListener('change', () => {
        expandedQueueKeys.clear();
        expandedJobsByQueue.clear();
        expandedDetailsByQueue.clear();
        void loadPage();
    });
    refreshButton?.addEventListener('click', () => {
        expandedQueueKeys.clear();
        expandedJobsByQueue.clear();
        expandedDetailsByQueue.clear();
        void loadPage();
    });
    loadMoreButton?.addEventListener('click', () => {
        if (!loading && nextCursor) {
            void loadPage({ append: true });
        }
    });
    return {
        refresh: (options) => loadPage(options),
        getQueues: () => queues.slice()
    };
}
