import { formatNumber } from './formatters.js';

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
    const midpoint = height / 2;

    element.innerHTML = `
        <line x1="12" y1="12" x2="${width - 12}" y2="12" class="trend-grid"></line>
        <line x1="12" y1="${midpoint}" x2="${width - 12}" y2="${midpoint}" class="trend-grid"></line>
        <line x1="12" y1="${height - 12}" x2="${width - 12}" y2="${height - 12}" class="trend-axis"></line>
        <path d="${area}" class="trend-area ${strokeClass}"></path>
        <path d="${line}" class="trend-line ${strokeClass}"></path>
        <circle cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="4" class="trend-dot ${strokeClass}"></circle>
    `;
}

export function renderHistory(elements, history) {
    const snapshots = Array.isArray(history) ? history : [];
    const latestSnapshot = snapshots[snapshots.length - 1];
    const totalJobsValues = snapshots.map((snapshot) => Number(snapshot.totalJobs) || 0);
    const peakCpuValues = snapshots.map((snapshot) => Number(snapshot.peakCpu) || 0);
    const waitingValues = snapshots.map((snapshot) => Number(snapshot.waitingJobs) || 0);
    const totalJobsMin = totalJobsValues.length ? Math.min(...totalJobsValues) : 0;
    const totalJobsMax = totalJobsValues.length ? Math.max(...totalJobsValues) : 0;
    const peakCpuMin = peakCpuValues.length ? Math.min(...peakCpuValues) : 0;
    const peakCpuMax = peakCpuValues.length ? Math.max(...peakCpuValues) : 0;

    renderTrendChart(elements.jobsHistoryChart, totalJobsValues, 'jobs');
    renderTrendChart(elements.cpuHistoryChart, peakCpuValues, 'cpu');
    renderTrendChart(elements.waitHistoryChart, waitingValues, 'waits');

    if (elements.jobsHistoryValue) {
        elements.jobsHistoryValue.textContent = latestSnapshot
            ? `${formatNumber(latestSnapshot.totalJobs)} jobs`
            : '0 jobs';
    }

    if (elements.jobsHistoryNote) {
        elements.jobsHistoryNote.textContent = latestSnapshot
            ? `${snapshots.length} snapshots in this session.`
            : 'Waiting for snapshot history.';
    }

    if (elements.jobsHistoryRange) {
        elements.jobsHistoryRange.textContent = `${formatNumber(totalJobsMin)}-${formatNumber(totalJobsMax)}`;
    }

    if (elements.jobsHistoryLatest) {
        elements.jobsHistoryLatest.textContent = latestSnapshot
            ? `${formatNumber(latestSnapshot.totalJobs)} jobs`
            : '0 jobs';
    }

    if (elements.cpuHistoryValue) {
        elements.cpuHistoryValue.textContent = latestSnapshot
            ? `${Number(latestSnapshot.peakCpu || 0).toFixed(2)}%`
            : '0.00%';
    }

    if (elements.cpuHistoryNote) {
        elements.cpuHistoryNote.textContent = latestSnapshot
            ? `Running jobs now: ${formatNumber(latestSnapshot.runningJobs)}.`
            : 'No CPU history collected yet.';
    }

    if (elements.cpuHistoryRange) {
        elements.cpuHistoryRange.textContent = `${peakCpuMin.toFixed(2)}-${peakCpuMax.toFixed(2)}%`;
    }

    if (elements.cpuHistoryRunning) {
        elements.cpuHistoryRunning.textContent = latestSnapshot
            ? `${formatNumber(latestSnapshot.runningJobs)} jobs`
            : '0 jobs';
    }

    if (elements.waitHistoryValue) {
        elements.waitHistoryValue.textContent = latestSnapshot
            ? `${formatNumber(latestSnapshot.waitingJobs)} waits`
            : '0 waits';
    }

    if (elements.waitHistoryNote) {
        elements.waitHistoryNote.textContent = latestSnapshot
            ? `${formatNumber(latestSnapshot.messageWaitJobs)} MSGW and ${formatNumber(latestSnapshot.lockWaitJobs)} LCKW in the latest poll.`
            : 'MSGW and LCKW snapshots will appear here.';
    }

    if (elements.waitHistoryMsgw) {
        elements.waitHistoryMsgw.textContent = latestSnapshot
            ? formatNumber(latestSnapshot.messageWaitJobs)
            : '0';
    }

    if (elements.waitHistoryLckw) {
        elements.waitHistoryLckw.textContent = latestSnapshot
            ? formatNumber(latestSnapshot.lockWaitJobs)
            : '0';
    }
}
