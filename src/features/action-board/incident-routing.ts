import type { AlertKind, AlertSeverity, MonitorAlert } from '../alerts/alert-model';
import type { SupportAccessPermission } from './support-access';

export type RoutingAvailability = 'available' | 'away' | 'offline';
export type SlaState = 'on_track' | 'at_risk' | 'overdue';

export interface SupportWindow {
    timezone: string;
    days: number[];
    startMinute: number;
    endMinute: number;
}

export interface RoutingOperator {
    operatorId: string;
    displayName: string;
    systemIds: string[];
    permissions: SupportAccessPermission[];
    skills: string[];
    availability: RoutingAvailability;
    supportWindow?: SupportWindow;
    expiresAt?: string;
}

export interface RoutingRule {
    id: string;
    incidentKinds: AlertKind[];
    minimumSeverity: AlertSeverity;
    requiredSkills: string[];
    slaMinutes: number;
    priority: number;
}

export interface SlaSummary {
    state: SlaState;
    startedAt: string;
    dueAt: string;
    minutesRemaining: number;
    targetMinutes: number;
}

export interface RoutingRecommendation {
    rule: RoutingRule;
    recommendedOperator?: {
        operatorId: string;
        displayName: string;
    };
    eligibleOperatorCount: number;
    sla: SlaSummary;
    reasons: string[];
    escalationReasons: string[];
}

export interface BuildRoutingRecommendationInput {
    alert: MonitorAlert;
    systemId: string;
    now: string;
    operators: RoutingOperator[];
    preferredOperatorId?: string;
    rules?: RoutingRule[];
}

export const ALWAYS_ON_SUPPORT_WINDOW: SupportWindow = {
    timezone: 'UTC',
    days: [0, 1, 2, 3, 4, 5, 6],
    startMinute: 0,
    endMinute: 24 * 60
};

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
    { id: 'message-wait', incidentKinds: ['messageWait'], minimumSeverity: 'warning', requiredSkills: ['message-response'], slaMinutes: 30, priority: 100 },
    { id: 'lock-wait', incidentKinds: ['lockWait'], minimumSeverity: 'warning', requiredSkills: ['lock-investigation'], slaMinutes: 30, priority: 100 },
    { id: 'high-cpu', incidentKinds: ['highCpu'], minimumSeverity: 'warning', requiredSkills: ['performance'], slaMinutes: 60, priority: 80 },
    { id: 'queue-wait', incidentKinds: ['dequeueWait', 'delayWait'], minimumSeverity: 'warning', requiredSkills: ['ibmi-operations'], slaMinutes: 60, priority: 70 },
    { id: 'poll-failure', incidentKinds: ['pollFailure'], minimumSeverity: 'warning', requiredSkills: ['ibmi-monitoring'], slaMinutes: 15, priority: 110 }
];

/** Builds an explainable assignee recommendation without changing incident ownership. */
export function buildRoutingRecommendation(input: BuildRoutingRecommendationInput): RoutingRecommendation {
    const nowMs = parseTime(input.now);
    const rule = selectRule(input.alert, input.rules || DEFAULT_ROUTING_RULES);
    const candidates = input.operators
        .map((operator) => ({ operator, exclusion: getExclusionReason(operator, input, rule, nowMs) }))
        .filter((candidate) => !candidate.exclusion)
        .sort((left, right) => rankOperator(right.operator, input.preferredOperatorId) - rankOperator(left.operator, input.preferredOperatorId));
    const recommendedOperator = candidates[0]?.operator;
    const sla = buildSlaSummary(input.alert, rule.slaMinutes, input.now, nowMs);
    const excluded = input.operators
        .map((operator) => getExclusionReason(operator, input, rule, nowMs))
        .filter(Boolean) as string[];
    const reasons = recommendedOperator
        ? [
            `${recommendedOperator.displayName} matches ${rule.requiredSkills.join(', ')}.`,
            `${recommendedOperator.displayName} has the required incident-workflow permission and system scope.`,
            sla.state === 'overdue' ? 'The SLA is overdue; escalate while assigning.' : `SLA target is ${rule.slaMinutes} minutes.`
        ]
        : ['No eligible operator is configured for this incident.'];
    const escalationReasons = [...new Set([
        ...excluded.slice(0, 3),
        ...(sla.state === 'overdue' ? ['The incident has exceeded its response target.'] : []),
        ...(input.alert.workflowStatus === 'work_done' ? ['Work is marked done but still needs recovery verification.'] : [])
    ])];

    return {
        rule,
        recommendedOperator: recommendedOperator
            ? { operatorId: recommendedOperator.operatorId, displayName: recommendedOperator.displayName }
            : undefined,
        eligibleOperatorCount: candidates.length,
        sla,
        reasons,
        escalationReasons
    };
}

export function isWithinSupportWindow(window: SupportWindow | undefined, timestamp: string) {
    if (!window) return true;
    const parts = getZonedParts(timestamp, window.timezone);
    if (!parts) return false;
    if (!window.days.includes(parts.day)) return false;
    if (window.startMinute === window.endMinute) return true;
    const minute = parts.hour * 60 + parts.minute;
    return window.startMinute < window.endMinute
        ? minute >= window.startMinute && minute < window.endMinute
        : minute >= window.startMinute || minute < window.endMinute;
}

function selectRule(alert: MonitorAlert, rules: RoutingRule[]) {
    return rules
        .filter((rule) => rule.incidentKinds.includes(alert.kind))
        .filter((rule) => alert.severity === 'critical' || rule.minimumSeverity === 'warning')
        .sort((left, right) => right.priority - left.priority)[0]
        || DEFAULT_ROUTING_RULES[0];
}

function getExclusionReason(
    operator: RoutingOperator,
    input: BuildRoutingRecommendationInput,
    rule: RoutingRule,
    nowMs: number
) {
    if (!operator.systemIds.includes('*') && !operator.systemIds.includes(input.systemId)) {
        return `${operator.displayName} is outside this IBM i system scope.`;
    }
    if (!operator.permissions.includes('investigate') && !operator.permissions.includes('execute')) {
        return `${operator.displayName} has read access but not incident-workflow permission.`;
    }
    if (operator.availability !== 'available') {
        return `${operator.displayName} is ${operator.availability}.`;
    }
    if (operator.expiresAt && parseTime(operator.expiresAt) <= nowMs) {
        return `${operator.displayName}'s support access has expired.`;
    }
    const missingSkill = rule.requiredSkills.find((skill) => !operator.skills.includes(skill));
    if (missingSkill) {
        return `${operator.displayName} is missing the ${missingSkill} skill.`;
    }
    if (!isWithinSupportWindow(operator.supportWindow, input.now)) {
        return `${operator.displayName} is outside the configured support window.`;
    }
    return undefined;
}

function rankOperator(operator: RoutingOperator, preferredOperatorId?: string) {
    return (operator.operatorId === preferredOperatorId ? 100 : 0)
        + operator.skills.length;
}

function buildSlaSummary(alert: MonitorAlert, targetMinutes: number, now: string, nowMs: number): SlaSummary {
    const startedAt = alert.timestamp;
    const startedMs = parseTime(startedAt);
    const dueMs = startedMs + targetMinutes * 60 * 1000;
    const minutesRemaining = Math.ceil((dueMs - nowMs) / 60000);
    const state: SlaState = minutesRemaining <= 0
        ? 'overdue'
        : minutesRemaining <= Math.max(1, Math.ceil(targetMinutes * 0.2))
            ? 'at_risk'
            : 'on_track';
    return {
        state,
        startedAt,
        dueAt: new Date(dueMs).toISOString(),
        minutesRemaining,
        targetMinutes
    };
}

function parseTime(value: string) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
}

function getZonedParts(timestamp: string, timezone: string) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date(timestamp));
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
        if (weekday < 0 || !values.hour || !values.minute) return undefined;
        return { day: weekday, hour: Number(values.hour), minute: Number(values.minute) };
    } catch {
        return undefined;
    }
}
