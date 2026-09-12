import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind, MonitorAlert } from '../alerts/alert-model';

export type BusinessDeadlineState = 'on_track' | 'at_risk' | 'overdue' | 'not_configured' | 'unknown';
export type BusinessScheduleState = 'expected' | 'outside_expected_window' | 'not_configured' | 'unknown';

export interface BusinessServiceSchedule {
    timezone: string;
    days: number[];
    startMinute: number;
    endMinute: number;
}

export interface BusinessServiceMapping {
    id: string;
    serviceName: string;
    owner: string;
    systemIds: string[];
    alertKinds: AlertKind[];
    jobPattern?: string;
    resourcePattern?: string;
    queuePattern?: string;
    subsystemPattern?: string;
    priority: number;
    deadlineMinutes?: number;
    expectedSchedule?: BusinessServiceSchedule;
}

export interface BusinessServiceSettings {
    mappings: BusinessServiceMapping[];
}

export interface BusinessServiceImpact {
    mapped: boolean;
    serviceName?: string;
    owner?: string;
    mappingId?: string;
    matchedBy?: string;
    deadlineState: BusinessDeadlineState;
    deadlineAt?: string;
    scheduleState: BusinessScheduleState;
    summary: string;
}

export const DEFAULT_BUSINESS_SERVICE_SETTINGS: BusinessServiceSettings = { mappings: [] };

interface ResolveBusinessServiceInput {
    systemId?: string;
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    now: string;
}

/** Keeps client mappings bounded and safe to persist. */
export function normalizeBusinessServiceSettings(candidate?: Partial<BusinessServiceSettings>): BusinessServiceSettings {
    const mappings = Array.isArray(candidate?.mappings) ? candidate.mappings : [];
    return {
        mappings: mappings
            .map(normalizeMapping)
            .filter((mapping): mapping is BusinessServiceMapping => Boolean(mapping))
            .slice(0, 100)
    };
}

/** Resolves one explicit customer mapping using deterministic precedence. */
export function resolveBusinessService(
    input: ResolveBusinessServiceInput,
    settings: BusinessServiceSettings
): BusinessServiceImpact {
    const matches = settings.mappings
        .map((mapping, index) => ({ mapping, index, matchedBy: getMatchReason(mapping, input) }))
        .filter((candidate) => candidate.matchedBy)
        .sort((left, right) => (
            matchSpecificity(right.mapping) - matchSpecificity(left.mapping)
            || right.mapping.priority - left.mapping.priority
            || left.index - right.index
            || left.mapping.id.localeCompare(right.mapping.id)
        ));
    const selected = matches[0];
    if (!selected) {
        return {
            mapped: false,
            deadlineState: 'not_configured',
            scheduleState: 'not_configured',
            summary: 'Business impact is unknown until a customer mapping matches this job.'
        };
    }

    const { mapping } = selected;
    const scheduleState = mapping.expectedSchedule
        ? isWithinSchedule(input.now, mapping.expectedSchedule) === undefined
            ? 'unknown'
            : isWithinSchedule(input.now, mapping.expectedSchedule)
                ? 'expected'
                : 'outside_expected_window'
        : 'not_configured';
    const deadline = getDeadline(input.alert?.timestamp || input.now, mapping.deadlineMinutes);
    const deadlineState = deadline
        ? getDeadlineState(deadline, input.now, mapping.deadlineMinutes || 0)
        : mapping.deadlineMinutes === undefined ? 'not_configured' : 'unknown';
    const risk = deadlineState === 'overdue'
        ? 'Deadline overdue.'
        : deadlineState === 'at_risk'
            ? 'Deadline at risk.'
            : deadlineState === 'on_track'
                ? 'Deadline on track.'
                : 'No deadline configured.';
    const schedule = scheduleState === 'outside_expected_window'
        ? ' Outside expected operating window.'
        : scheduleState === 'expected' ? ' Within expected operating window.' : '';

    return {
        mapped: true,
        serviceName: mapping.serviceName,
        owner: mapping.owner,
        mappingId: mapping.id,
        matchedBy: selected.matchedBy || undefined,
        deadlineState,
        deadlineAt: deadline?.toISOString(),
        scheduleState,
        summary: `${mapping.serviceName} · owner ${mapping.owner}. ${risk}${schedule}`
    };
}

function normalizeMapping(candidate: BusinessServiceMapping): BusinessServiceMapping | null {
    if (!candidate || !String(candidate.serviceName || '').trim() || !String(candidate.id || '').trim()) return null;
    const schedule = normalizeSchedule(candidate.expectedSchedule);
    const deadline = Number(candidate.deadlineMinutes);
    return {
        id: String(candidate.id).trim().slice(0, 80),
        serviceName: String(candidate.serviceName).trim().slice(0, 120),
        owner: String(candidate.owner || 'Unassigned').trim().slice(0, 120) || 'Unassigned',
        systemIds: normalizeStrings(candidate.systemIds),
        alertKinds: normalizeAlertKinds(candidate.alertKinds),
        jobPattern: normalizeOptional(candidate.jobPattern),
        resourcePattern: normalizeOptional(candidate.resourcePattern),
        queuePattern: normalizeOptional(candidate.queuePattern),
        subsystemPattern: normalizeOptional(candidate.subsystemPattern),
        priority: clampInteger(candidate.priority, 0, 1000, 0),
        deadlineMinutes: Number.isFinite(deadline) && deadline >= 1 ? Math.min(10080, Math.round(deadline)) : undefined,
        expectedSchedule: schedule
    };
}

function getMatchReason(mapping: BusinessServiceMapping, input: ResolveBusinessServiceInput) {
    const systemId = String(input.systemId || '').trim();
    if (mapping.systemIds.length && !mapping.systemIds.includes('*') && !mapping.systemIds.includes(systemId)) return '';
    if (mapping.alertKinds.length && (!input.alert || !mapping.alertKinds.includes(input.alert.kind))) return '';
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || '').trim();
    const resourceId = String(input.alert?.resourceId || input.alert?.jobName || '').trim();
    const queueName = String((input.job as unknown as Record<string, unknown>).JOB_QUEUE_NAME || '').trim();
    const subsystem = String(input.job.SUBSYSTEM || '').trim();
    const matches = [
        ['job', mapping.jobPattern, jobName],
        ['resource', mapping.resourcePattern, resourceId],
        ['queue', mapping.queuePattern, queueName],
        ['subsystem', mapping.subsystemPattern, subsystem]
    ].filter(([, pattern]) => pattern);
    if (!matches.length) return '';
    return matches.every(([, pattern, value]) => matchesPattern(String(value), String(pattern)))
        ? matches.map(([kind]) => kind).join(' + ')
        : '';
}

function matchSpecificity(mapping: BusinessServiceMapping) {
    return [mapping.jobPattern, mapping.resourcePattern, mapping.queuePattern, mapping.subsystemPattern]
        .filter(Boolean).length * 10 + (mapping.alertKinds.length ? 2 : 0) + (mapping.systemIds.length ? 1 : 0);
}

function matchesPattern(value: string, pattern: string) {
    const expression = `^${pattern.split('*').map(escapeRegExp).join('.*')}$`;
    return new RegExp(expression, 'i').test(value);
}

function getDeadline(startedAt: string, deadlineMinutes?: number) {
    const started = Date.parse(startedAt);
    return Number.isFinite(started) && deadlineMinutes !== undefined
        ? new Date(started + deadlineMinutes * 60 * 1000)
        : undefined;
}

function getDeadlineState(deadline: Date, now: string, targetMinutes: number): BusinessDeadlineState {
    const remaining = deadline.getTime() - Date.parse(now);
    if (!Number.isFinite(remaining)) return 'unknown';
    if (remaining <= 0) return 'overdue';
    return remaining <= Math.max(60_000, targetMinutes * 60_000 * 0.2) ? 'at_risk' : 'on_track';
}

function isWithinSchedule(timestamp: string, schedule: BusinessServiceSchedule): boolean | undefined {
    if (!Number.isFinite(Date.parse(timestamp))) return undefined;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: schedule.timezone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date(timestamp));
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
        if (day < 0 || !schedule.days.includes(day)) return false;
        if (schedule.startMinute === schedule.endMinute) return true;
        const minute = Number(values.hour) * 60 + Number(values.minute);
        return schedule.startMinute < schedule.endMinute
            ? minute >= schedule.startMinute && minute < schedule.endMinute
            : minute >= schedule.startMinute || minute < schedule.endMinute;
    } catch {
        return undefined;
    }
}

function normalizeSchedule(candidate?: BusinessServiceSchedule) {
    if (!candidate || !String(candidate.timezone || '').trim()) return undefined;
    const startMinute = clampInteger(candidate.startMinute, 0, 1439, 0);
    const endMinute = clampInteger(candidate.endMinute, 0, 1439, 0);
    return {
        timezone: String(candidate.timezone).trim(),
        days: normalizeDays(candidate.days),
        startMinute,
        endMinute
    };
}

function normalizeStrings(values?: string[]) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 50);
}

function normalizeDays(values?: number[]) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))).sort((a, b) => a - b);
}

function normalizeAlertKinds(values?: AlertKind[]) {
    const allowed: AlertKind[] = ['highCpu', 'messageWait', 'lockWait', 'delayWait', 'dequeueWait', 'pollFailure'];
    return Array.from(new Set((Array.isArray(values) ? values : []).filter((value): value is AlertKind => allowed.includes(value))));
}

function normalizeOptional(value?: string) {
    const text = String(value || '').trim();
    return text ? text.slice(0, 160) : undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
