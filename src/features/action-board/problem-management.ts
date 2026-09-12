import type { ActiveJobRecord } from '../../services/ibmi';
import type { AlertKind, MonitorAlert } from '../alerts/alert-model';

export type ProblemStatus = 'candidate' | 'confirmed' | 'resolved' | 'reopened';
export type ProblemTicketProvider = 'clickup' | 'jira' | 'vendor' | 'github' | 'other';

export interface ProblemEnvironment {
    jobType?: string;
    subsystem?: string;
}

export interface ProblemOccurrence {
    incidentId: string;
    occurrence: number;
    jobName: string;
    title: string;
    kind: AlertKind;
    fingerprint?: string;
    timestamp: string;
    evidence: string[];
    environment: ProblemEnvironment;
}

export interface ProblemTicket {
    provider: ProblemTicketProvider;
    key: string;
    url?: string;
}

export interface ProblemRecord {
    schema: 'imonitor-problem-record';
    version: 1;
    id: string;
    systemId: string;
    systemLabel?: string;
    status: ProblemStatus;
    title: string;
    incidentKind: AlertKind;
    jobPattern: string;
    environment: ProblemEnvironment;
    occurrences: ProblemOccurrence[];
    rootCause?: string;
    workaround?: string;
    linkedTicket?: ProblemTicket;
    createdAt: string;
    updatedAt: string;
    confirmedBy?: string;
    confirmedAt?: string;
    resolvedBy?: string;
    resolvedAt?: string;
}

export interface ProblemManagementStore {
    records: ProblemRecord[];
}

export interface ProblemContext {
    systemId: string;
    systemLabel?: string;
    job: ActiveJobRecord;
    alert: MonitorAlert;
    now: string;
}

export interface ProblemMatch {
    recordId: string;
    score: number;
    reasons: string[];
}

export const DEFAULT_PROBLEM_MANAGEMENT: ProblemManagementStore = { records: [] };

const ALERT_KINDS: AlertKind[] = ['highCpu', 'messageWait', 'lockWait', 'delayWait', 'dequeueWait', 'pollFailure'];
const PROBLEM_STATUSES: ProblemStatus[] = ['candidate', 'confirmed', 'resolved', 'reopened'];
const TICKET_PROVIDERS: ProblemTicketProvider[] = ['clickup', 'jira', 'vendor', 'github', 'other'];

/** Creates a compact occurrence from the current incident evidence. */
export function buildProblemOccurrence(context: ProblemContext): ProblemOccurrence {
    const jobName = String(context.job.JOB_NAME || context.job.SUBSYSTEM_JOB || context.alert.jobName || 'job').trim();
    const evidence = [context.alert.message, context.alert.detail, context.alert.lastActionSummary]
        .filter(Boolean).map(String).map((value) => value.trim()).filter(Boolean).slice(0, 6);
    return {
        incidentId: String(context.alert.incidentId || context.alert.id).trim(),
        occurrence: Math.max(1, Number(context.alert.occurrence || 1)),
        jobName,
        title: context.alert.title.trim() || `${context.alert.kind} incident`,
        kind: context.alert.kind,
        fingerprint: context.alert.correlation?.fingerprint,
        timestamp: context.alert.lastSeenAt || context.alert.timestamp,
        evidence,
        environment: {
            jobType: String(context.job.TYPE || '').trim() || undefined,
            subsystem: String(context.job.SUBSYSTEM || '').trim() || undefined
        }
    };
}

/** Creates an unconfirmed problem candidate from one operator-selected incident. */
export function createProblemCandidate(context: ProblemContext, id = `problem-${Date.now()}`): ProblemRecord {
    const occurrence = buildProblemOccurrence(context);
    return {
        schema: 'imonitor-problem-record',
        version: 1,
        id: id.trim().slice(0, 100),
        systemId: context.systemId.trim(),
        systemLabel: context.systemLabel?.trim() || undefined,
        status: 'candidate',
        title: context.alert.title.trim() || `${context.alert.kind} recurring problem`,
        incidentKind: context.alert.kind,
        jobPattern: occurrence.jobName,
        environment: occurrence.environment,
        occurrences: [occurrence],
        createdAt: context.now,
        updatedAt: context.now
    };
}

/** Matches only the same customer system, condition, job, and compatible runtime shape. */
export function matchProblem(record: ProblemRecord, context: ProblemContext): ProblemMatch | null {
    const current = buildProblemOccurrence(context);
    if (record.systemId !== context.systemId || record.incidentKind !== current.kind || record.jobPattern !== current.jobName) {
        return null;
    }
    const environmentReasons = compareEnvironment(record.environment, current.environment);
    if (!environmentReasons) return null;
    const latest = record.occurrences[record.occurrences.length - 1];
    const sameFingerprint = Boolean(current.fingerprint && latest?.fingerprint === current.fingerprint);
    const reasons = [
        `Same IBM i system: ${context.systemLabel || context.systemId}.`,
        `Same ${current.kind} condition on ${current.jobName}.`,
        ...environmentReasons,
        sameFingerprint
            ? 'The incident fingerprint matches a previous occurrence.'
            : 'The fingerprint differs, so this remains an operator-confirmed recurrence candidate.'
    ];
    return { recordId: record.id, score: sameFingerprint ? 100 : 80, reasons };
}

export function findProblemMatches(context: ProblemContext, store: ProblemManagementStore): ProblemMatch[] {
    return store.records
        .map((record) => matchProblem(record, context))
        .filter((match): match is ProblemMatch => Boolean(match))
        .sort((left, right) => right.score - left.score);
}

/** Adds one later occurrence once; a resolved problem becomes reopened for review. */
export function addProblemOccurrence(record: ProblemRecord, occurrence: ProblemOccurrence, now: string): ProblemRecord {
    const duplicate = record.occurrences.some((item) => (
        item.incidentId === occurrence.incidentId && item.occurrence === occurrence.occurrence
    ));
    if (duplicate) return record;
    return {
        ...record,
        status: record.status === 'resolved' ? 'reopened' : record.status,
        occurrences: [...record.occurrences, occurrence].slice(-50),
        updatedAt: now,
        resolvedAt: record.status === 'resolved' ? undefined : record.resolvedAt,
        resolvedBy: record.status === 'resolved' ? undefined : record.resolvedBy
    };
}

export function confirmProblem(
    record: ProblemRecord,
    update: { rootCause?: string; workaround?: string; linkedTicket?: ProblemTicket },
    operator: string,
    now: string
): ProblemRecord {
    return {
        ...record,
        status: 'confirmed',
        rootCause: clean(update.rootCause, 2000),
        workaround: clean(update.workaround, 2000),
        linkedTicket: normalizeTicket(update.linkedTicket),
        confirmedBy: operator.trim() || 'Unknown reviewer',
        confirmedAt: now,
        updatedAt: now,
        resolvedAt: undefined,
        resolvedBy: undefined
    };
}

export function resolveProblem(record: ProblemRecord, operator: string, now: string): ProblemRecord {
    return {
        ...record,
        status: 'resolved',
        resolvedBy: operator.trim() || 'Unknown reviewer',
        resolvedAt: now,
        updatedAt: now
    };
}

export function normalizeProblemManagement(candidate?: Partial<ProblemManagementStore>): ProblemManagementStore {
    const records = Array.isArray(candidate?.records) ? candidate.records : [];
    return { records: records.map(normalizeRecord).filter((record): record is ProblemRecord => Boolean(record)).slice(0, 250) };
}

function normalizeRecord(candidate: ProblemRecord): ProblemRecord | null {
    if (!candidate || candidate.schema !== 'imonitor-problem-record' || candidate.version !== 1) return null;
    if (!String(candidate.id || '').trim() || !String(candidate.systemId || '').trim() || !String(candidate.title || '').trim()) return null;
    if (!ALERT_KINDS.includes(candidate.incidentKind) || !PROBLEM_STATUSES.includes(candidate.status)) return null;
    const occurrences = Array.isArray(candidate.occurrences) ? candidate.occurrences.map(normalizeOccurrence).filter((item): item is ProblemOccurrence => Boolean(item)).slice(-50) : [];
    if (!occurrences.length) return null;
    return {
        ...candidate,
        id: String(candidate.id).trim().slice(0, 100),
        systemId: String(candidate.systemId).trim().slice(0, 120),
        systemLabel: clean(candidate.systemLabel, 160),
        title: String(candidate.title).trim().slice(0, 180),
        jobPattern: String(candidate.jobPattern || occurrences[0].jobName).trim().slice(0, 180),
        environment: normalizeEnvironment(candidate.environment),
        occurrences,
        rootCause: clean(candidate.rootCause, 2000),
        workaround: clean(candidate.workaround, 2000),
        linkedTicket: normalizeTicket(candidate.linkedTicket),
        createdAt: validDate(candidate.createdAt) ? candidate.createdAt : new Date(0).toISOString(),
        updatedAt: validDate(candidate.updatedAt)
            ? candidate.updatedAt
            : validDate(candidate.createdAt) ? candidate.createdAt : new Date(0).toISOString(),
        confirmedBy: clean(candidate.confirmedBy, 120),
        confirmedAt: validDate(candidate.confirmedAt) ? candidate.confirmedAt : undefined,
        resolvedBy: clean(candidate.resolvedBy, 120),
        resolvedAt: validDate(candidate.resolvedAt) ? candidate.resolvedAt : undefined
    };
}

function normalizeOccurrence(candidate: ProblemOccurrence): ProblemOccurrence | null {
    if (!candidate || !String(candidate.incidentId || '').trim() || !String(candidate.jobName || '').trim() || !validDate(candidate.timestamp)) return null;
    if (!ALERT_KINDS.includes(candidate.kind)) return null;
    return {
        incidentId: String(candidate.incidentId).trim().slice(0, 160),
        occurrence: Math.max(1, Math.round(Number(candidate.occurrence) || 1)),
        jobName: String(candidate.jobName).trim().slice(0, 180),
        title: String(candidate.title || candidate.kind).trim().slice(0, 180),
        kind: candidate.kind,
        fingerprint: clean(candidate.fingerprint, 240),
        timestamp: candidate.timestamp,
        evidence: normalizeStrings(candidate.evidence),
        environment: normalizeEnvironment(candidate.environment)
    };
}

function compareEnvironment(record: ProblemEnvironment, current: ProblemEnvironment) {
    if (record.jobType && current.jobType && record.jobType !== current.jobType) return null;
    if (record.subsystem && current.subsystem && record.subsystem !== current.subsystem) return null;
    return [
        record.jobType ? `Job type remains ${record.jobType}.` : 'Job type was not recorded in the earlier evidence.',
        record.subsystem ? `Subsystem remains ${record.subsystem}.` : 'Subsystem was not recorded in the earlier evidence.'
    ];
}

function normalizeEnvironment(candidate?: ProblemEnvironment): ProblemEnvironment {
    return { jobType: clean(candidate?.jobType, 80), subsystem: clean(candidate?.subsystem, 120) };
}

function normalizeTicket(candidate?: ProblemTicket): ProblemTicket | undefined {
    if (!candidate || !TICKET_PROVIDERS.includes(candidate.provider) || !String(candidate.key || '').trim()) return undefined;
    return { provider: candidate.provider, key: String(candidate.key).trim().slice(0, 180), url: clean(candidate.url, 500) };
}

function normalizeStrings(values?: string[]) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 10);
}

function clean(value: unknown, max: number) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? text.slice(0, max) : undefined;
}

function validDate(value: unknown) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
