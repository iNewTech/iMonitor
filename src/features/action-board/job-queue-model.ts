import type { JobQueueRecord, QueuedJobRecord } from '../../services/ibmi';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface JobQueueQuery {
    search?: string;
    status?: string;
    limit?: number;
    cursor?: string;
}

export interface QueuedJobQuery extends JobQueueQuery {
    queueName?: string;
    queueLibrary?: string;
}

export function normalizePageSize(value: unknown, fallback = DEFAULT_PAGE_SIZE) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

export function encodeCursor(value: unknown) {
    return encodeURIComponent(JSON.stringify(value));
}

export function decodeCursor<T>(value: unknown): T | null {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    try {
        return JSON.parse(decodeURIComponent(value)) as T;
    } catch {
        return null;
    }
}

function asString(value: unknown, fallback = '') {
    return value === null || value === undefined ? fallback : String(value).trim();
}

function asNullableString(value: unknown) {
    const result = asString(value);
    return result || null;
}

function asNumber(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
    return keys.map((key) => row[key]).find((value) => value !== null && value !== undefined);
}

export function normalizeJobQueueRecord(row: Record<string, unknown>): JobQueueRecord {
    const waitingJobs = asNumber(firstValue(row, [
        'NUMBER_OF_JOBS', 'WAITING_JOBS', 'CURRENT_JOBS', 'JOB_QUEUE_TOTAL_JOBS', 'TOTAL_JOBS', 'JOB_COUNT'
    ])) ?? 0;

    return {
        JOB_QUEUE_NAME: asString(firstValue(row, ['JOB_QUEUE_NAME', 'QUEUE_NAME']), 'UNKNOWN'),
        JOB_QUEUE_LIBRARY: asString(firstValue(row, ['JOB_QUEUE_LIBRARY', 'QUEUE_LIBRARY']), 'QGPL'),
        JOB_QUEUE_STATUS: asString(firstValue(row, ['JOB_QUEUE_STATUS', 'STATUS']), 'UNKNOWN'),
        SUBSYSTEM_NAME: asNullableString(firstValue(row, ['SUBSYSTEM_NAME', 'SUBSYSTEM'])),
        SUBSYSTEM_LIBRARY_NAME: asNullableString(firstValue(row, ['SUBSYSTEM_LIBRARY_NAME', 'SUBSYSTEM_LIBRARY'])),
        SEQUENCE_NUMBER: asNumber(firstValue(row, ['SEQUENCE_NUMBER', 'JOB_QUEUE_SEQUENCE'])),
        OPERATOR_CONTROLLED: asNullableString(firstValue(row, ['OPERATOR_CONTROLLED', 'OPERATOR_CONTROL'])),
        WAITING_JOBS: Math.max(0, waitingJobs),
        ACTIVE_JOBS: asNumber(firstValue(row, ['ACTIVE_JOBS', 'CURRENT_ACTIVE_JOBS'])),
        MAX_ACTIVE_JOBS: asNumber(firstValue(row, ['MAXIMUM_ACTIVE_JOBS', 'MAX_ACTIVE_JOBS', 'JOB_QUEUE_MAX_ACTIVE_JOBS'])),
        HELD_JOBS: asNumber(firstValue(row, ['HELD_JOBS', 'HELD_JOB_COUNT'])),
        TEXT_DESCRIPTION: asNullableString(firstValue(row, ['TEXT_DESCRIPTION', 'JOB_QUEUE_TEXT', 'DESCRIPTION'])),
        OLDEST_WAIT_TIME: asNullableString(firstValue(row, ['OLDEST_WAIT_TIME', 'OLDEST_JOB_QUEUE_TIME']))
    };
}

export function normalizeQueuedJobRecord(row: Record<string, unknown>): QueuedJobRecord {
    return {
        JOB_NAME: asString(row.JOB_NAME, 'UNKNOWN'),
        JOB_NAME_SHORT: asNullableString(row.JOB_NAME_SHORT),
        JOB_NUMBER: asNullableString(row.JOB_NUMBER),
        JOB_USER: asNullableString(row.JOB_USER),
        JOB_STATUS: asNullableString(row.JOB_STATUS),
        JOB_TYPE: asNullableString(row.JOB_TYPE),
        JOB_TYPE_ENHANCED: asNullableString(row.JOB_TYPE_ENHANCED),
        JOB_QUEUE_NAME: asString(row.JOB_QUEUE_NAME, 'UNKNOWN'),
        JOB_QUEUE_LIBRARY: asString(row.JOB_QUEUE_LIBRARY, 'QGPL'),
        JOB_QUEUE_STATUS: asNullableString(row.JOB_QUEUE_STATUS || row.STATUS),
        JOB_QUEUE_PRIORITY: asNumber(row.JOB_QUEUE_PRIORITY),
        JOB_QUEUE_TIME: asNullableString(row.JOB_QUEUE_TIME),
        JOB_ENTERED_SYSTEM_TIME: asNullableString(row.JOB_ENTERED_SYSTEM_TIME),
        SUBSYSTEM: asNullableString(row.SUBSYSTEM),
        SUBSYSTEM_LIBRARY_NAME: asNullableString(row.SUBSYSTEM_LIBRARY_NAME)
    };
}

export function queueKey(queueName: string, queueLibrary: string) {
    return `${queueLibrary.trim()}/${queueName.trim()}`;
}

export function matchesSearch(values: unknown[], search: string) {
    const normalizedSearch = search.trim().toLocaleUpperCase();
    if (!normalizedSearch) {
        return true;
    }

    return values.some((value) => String(value ?? '').toLocaleUpperCase().includes(normalizedSearch));
}
