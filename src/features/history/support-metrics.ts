import type { ActivityLogEntry } from '../../main/types';
import type { MonitorAlert, AlertTimelineEntry } from '../alerts/alert-model';

export const SUPPORT_METRICS_SCHEMA_VERSION = 1;

export interface SupportMetricsWindow {
    from: string;
    to: string;
    timeZone: string;
}

export interface SupportMetricsStage {
    sampleSize: number;
    measured: number;
    unknown: number;
    averageMinutes: number | null;
    medianMinutes: number | null;
}

export interface SupportMetricsSummary {
    incidentCount: number;
    resolvedCount: number;
    unresolvedCount: number;
    unknownOutcomeCount: number;
    reopenedCount: number;
    operatorVerifiedRecoveryCount: number;
    monitoringConfirmedRecoveryCount: number;
    autonomousResolutionCount: 0;
}

export interface SupportAiAvailability {
    sampleSize: number;
    available: number;
    unavailable: number;
    unknown: number;
    availabilityPercent: number | null;
}

export interface SupportMetricsComparison {
    incidentCountDelta: number;
    resolvedCountDelta: number;
    recoveryMinutesDelta: number | null;
    acknowledgementMinutesDelta: number | null;
}

export interface SupportMetricsReport {
    schemaVersion: 1;
    type: 'support-metrics';
    systemId: string;
    generatedAt: string;
    window: SupportMetricsWindow;
    summary: SupportMetricsSummary;
    stages: {
        triage: SupportMetricsStage;
        acknowledgement: SupportMetricsStage;
        investigation: SupportMetricsStage;
        verifiedRecovery: SupportMetricsStage;
        escalation: SupportMetricsStage;
        recurrence: SupportMetricsStage;
    };
    aiAvailability: SupportAiAvailability;
    baseline: {
        window: SupportMetricsWindow;
        summary: SupportMetricsSummary;
        stages: SupportMetricsReport['stages'];
        aiAvailability: SupportAiAvailability;
        comparison: SupportMetricsComparison;
    } | null;
}

export interface SupportAiAvailabilityEvent {
    timestamp: string;
    status: 'available' | 'unavailable';
}

export interface SupportMetricsInput {
    systemId: string;
    incidents: MonitorAlert[];
    aiEvents?: SupportAiAvailabilityEvent[];
    from: string;
    to: string;
    timeZone?: string;
    generatedAt?: string;
    includeBaseline?: boolean;
}

interface IncidentFacts {
    incident: MonitorAlert;
    detectedAt: number | null;
    acknowledgedAt: number | null;
    claimedAt: number | null;
    workDoneAt: number | null;
    handoffAt: number | null;
    resolvedAt: number | null;
    reopenedAt: number | null;
    hasOperatorAction: boolean;
    monitoringConfirmed: boolean;
}

interface MetricWindow {
    fromMs: number;
    toMs: number;
    value: SupportMetricsWindow;
}

const ACTIONS_WITH_OPERATOR = new Set([
    'acknowledged',
    'claimed',
    'released',
    'note_added',
    'work_marked_done',
    'rechecked',
    'handoff_requested',
    'handoff_accepted'
]);

/** Builds availability observations from the existing AI activity log. */
export function buildAiAvailabilityEvents(
    entries: ActivityLogEntry[],
    systemId?: string
): SupportAiAvailabilityEvent[] {
    return entries.flatMap((entry): Array<SupportAiAvailabilityEvent & { systemId?: string }> => {
        if (entry.area !== 'ai') return [];
        if (entry.message === 'IBMEye AI analysis completed.') {
            return [{ timestamp: entry.timestamp, status: 'available' as const, systemId: entry.systemId }];
        }
        if (entry.message === 'IBMEye AI analysis failed.') {
            return [{ timestamp: entry.timestamp, status: 'unavailable' as const, systemId: entry.systemId }];
        }
        return [];
    }).filter((event) => !systemId || event.systemId === systemId);
}

/** Returns a stable, customer-scoped report from persisted incident evidence. */
export function calculateSupportMetrics(input: SupportMetricsInput): SupportMetricsReport {
    const window = normalizeWindow(input.from, input.to, input.timeZone);
    const current = summarizeWindow(input.incidents, input.systemId, input.aiEvents ?? [], window);
    const baselineWindow = {
        fromMs: window.fromMs - (window.toMs - window.fromMs),
        toMs: window.fromMs,
        value: {
            from: new Date(window.fromMs - (window.toMs - window.fromMs)).toISOString(),
            to: new Date(window.fromMs).toISOString(),
            timeZone: window.value.timeZone
        }
    } satisfies MetricWindow;
    const baseline = input.includeBaseline === false
        ? null
        : summarizeWindow(input.incidents, input.systemId, input.aiEvents ?? [], baselineWindow);

    return {
        schemaVersion: SUPPORT_METRICS_SCHEMA_VERSION,
        type: 'support-metrics',
        systemId: input.systemId,
        generatedAt: input.generatedAt || new Date().toISOString(),
        window: window.value,
        summary: current.summary,
        stages: current.stages,
        aiAvailability: current.aiAvailability,
        baseline: baseline
            ? {
                window: baselineWindow.value,
                summary: baseline.summary,
                stages: baseline.stages,
                aiAvailability: baseline.aiAvailability,
                comparison: compareSupportMetrics(current, baseline)
            }
            : null
    };
}

function normalizeWindow(from: string, to: string, timeZone?: string): MetricWindow {
    const fromMs = parseTimestamp(from);
    const toMs = parseTimestamp(to);
    if (fromMs === null || toMs === null || fromMs >= toMs) {
        throw new Error('Support metrics require a valid window where from is before to.');
    }

    return {
        fromMs,
        toMs,
        value: {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString(),
            timeZone: String(timeZone || 'UTC')
        }
    };
}

function summarizeWindow(
    incidents: MonitorAlert[],
    systemId: string,
    aiEvents: SupportAiAvailabilityEvent[],
    window: MetricWindow
) {
    const facts = incidents
        .filter((incident) => incident.systemId === systemId)
        .map(toIncidentFacts)
        .filter((facts) => isInside(facts.detectedAt, window));
    const summary = summarizeOutcomes(facts, window);
    const stages = buildStages(facts, window);
    const scopedAiEvents = aiEvents
        .map((event) => ({ ...event, timestampMs: parseTimestamp(event.timestamp) }))
        .filter((event) => isInside(event.timestampMs, window));

    return {
        summary,
        stages,
        aiAvailability: summarizeAiAvailability(scopedAiEvents)
    };
}

function toIncidentFacts(incident: MonitorAlert): IncidentFacts {
    const timeline = (Array.isArray(incident.timeline) ? incident.timeline : [])
        .map((entry) => ({ entry, timestamp: parseTimestamp(entry.timestamp) }))
        .filter((candidate): candidate is { entry: AlertTimelineEntry; timestamp: number } => candidate.timestamp !== null)
        .sort((left, right) => left.timestamp - right.timestamp);
    const first = (action: AlertTimelineEntry['action']) => timeline.find((candidate) => candidate.entry.action === action)?.timestamp ?? null;
    const resolvedAt = parseTimestamp(incident.resolvedAt)
        ?? first('system_cleared')
        ?? first('rechecked');
    const reopenedAt = first('reopened');

    return {
        incident,
        detectedAt: parseTimestamp(incident.timestamp) ?? first('created') ?? first('condition_seen'),
        acknowledgedAt: first('acknowledged'),
        claimedAt: first('claimed'),
        workDoneAt: first('work_marked_done'),
        handoffAt: first('handoff_requested'),
        resolvedAt: resolvedAt !== null && reopenedAt !== null && reopenedAt > resolvedAt && incident.isActive !== false
            ? null
            : resolvedAt,
        reopenedAt,
        hasOperatorAction: timeline.some(({ entry }) => ACTIONS_WITH_OPERATOR.has(entry.action)),
        monitoringConfirmed: resolvedAt !== null
    };
}

function summarizeOutcomes(facts: IncidentFacts[], window: MetricWindow): SupportMetricsSummary {
    const resolved = facts.filter((facts) => facts.resolvedAt !== null && isInside(facts.resolvedAt, window));
    const reopened = facts.filter((facts) => facts.reopenedAt !== null && isInside(facts.reopenedAt, window));

    return {
        incidentCount: facts.length,
        resolvedCount: resolved.length,
        unresolvedCount: facts.length - resolved.length,
        unknownOutcomeCount: facts.filter((facts) => facts.resolvedAt === null).length,
        reopenedCount: reopened.length,
        operatorVerifiedRecoveryCount: resolved.filter((facts) => facts.hasOperatorAction).length,
        monitoringConfirmedRecoveryCount: resolved.filter((facts) => facts.monitoringConfirmed).length,
        autonomousResolutionCount: 0
    };
}

function buildStages(facts: IncidentFacts[], window: MetricWindow): SupportMetricsReport['stages'] {
    return {
        triage: buildStage(facts, (facts) => duration(facts.detectedAt, facts.acknowledgedAt), window),
        acknowledgement: buildStage(facts, (facts) => duration(facts.detectedAt, facts.acknowledgedAt), window),
        investigation: buildStage(facts, (facts) => duration(facts.claimedAt, facts.workDoneAt ?? facts.resolvedAt), window),
        verifiedRecovery: buildStage(facts, (facts) => duration(facts.workDoneAt, facts.resolvedAt), window),
        escalation: buildStage(facts, (facts) => duration(facts.detectedAt, facts.handoffAt), window),
        recurrence: buildStage(facts, (facts) => duration(facts.resolvedAt, facts.reopenedAt), window)
    };
}

function buildStage(
    facts: IncidentFacts[],
    getDuration: (facts: IncidentFacts) => number | null,
    window: MetricWindow
): SupportMetricsStage {
    const sample = facts.filter((facts) => isInside(facts.detectedAt, window));
    const durations = sample
        .map(getDuration)
        .filter((value): value is number => value !== null && value >= 0);

    return {
        sampleSize: sample.length,
        measured: durations.length,
        unknown: sample.length - durations.length,
        averageMinutes: averageMinutes(durations),
        medianMinutes: medianMinutes(durations)
    };
}

function summarizeAiAvailability(events: Array<SupportAiAvailabilityEvent & { timestampMs: number | null }>): SupportAiAvailability {
    const available = events.filter((event) => event.status === 'available').length;
    const unavailable = events.filter((event) => event.status === 'unavailable').length;
    const sampleSize = available + unavailable;
    return {
        sampleSize,
        available,
        unavailable,
        unknown: 0,
        availabilityPercent: sampleSize ? Number(((available / sampleSize) * 100).toFixed(2)) : null
    };
}

function compareSupportMetrics(
    current: ReturnType<typeof summarizeWindow>,
    baseline: ReturnType<typeof summarizeWindow>
): SupportMetricsComparison {
    return {
        incidentCountDelta: current.summary.incidentCount - baseline.summary.incidentCount,
        resolvedCountDelta: current.summary.resolvedCount - baseline.summary.resolvedCount,
        recoveryMinutesDelta: subtractNullable(
            current.stages.verifiedRecovery.averageMinutes,
            baseline.stages.verifiedRecovery.averageMinutes
        ),
        acknowledgementMinutesDelta: subtractNullable(
            current.stages.acknowledgement.averageMinutes,
            baseline.stages.acknowledgement.averageMinutes
        )
    };
}

function subtractNullable(current: number | null, baseline: number | null) {
    return current !== null && baseline !== null ? Number((current - baseline).toFixed(2)) : null;
}

function duration(start: number | null, end: number | null) {
    if (start === null || end === null || end < start) return null;
    return end - start;
}

function averageMinutes(values: number[]) {
    if (!values.length) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length / 60000).toFixed(2));
}

function medianMinutes(values: number[]) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    return Number((value / 60000).toFixed(2));
}

function isInside(timestamp: number | null, window: MetricWindow) {
    return timestamp !== null && timestamp >= window.fromMs && timestamp < window.toMs;
}

function parseTimestamp(value: string | undefined) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}
