export function escapeHtml(value) {
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

export function formatTimestamp(value) {
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

export function formatNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '0';
    }

    return parsed.toLocaleString();
}

export function formatCpuValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '0.00%';
    }

    return `${parsed.toFixed(2)}%`;
}

export function formatMegabytes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '0 MB';
    }

    return `${parsed.toLocaleString()} MB`;
}

export function getJobKey(job) {
    if (job?.JOB_NAME) {
        return job.JOB_NAME;
    }

    const jobNumber = job?.JOB_NUMBER || '------';
    const jobUser = job?.JOB_USER || 'UNKNOWN';
    const jobName = job?.JOB_NAME_SHORT || 'UNKNOWN';
    return `${jobNumber}/${jobUser}/${jobName}`;
}

export function getStatusBadgeClass(status) {
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
