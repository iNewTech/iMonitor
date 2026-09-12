import type { MonitorAlert } from './alert-model';

export type IncidentHandoffStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface IncidentHandoff {
    schema: 'imonitor-incident-handoff';
    version: 1;
    id: string;
    incidentId: string;
    fromOperator: string;
    toOperator: string;
    reason: string;
    pendingChecks: string[];
    responseTargetAt?: string;
    createdAt: string;
    status: IncidentHandoffStatus;
    acceptedAt?: string;
    acceptedBy?: string;
}

export type HandoffCreationResult =
    | { success: true; handoff: IncidentHandoff; }
    | { success: false; error: string; };

export type HandoffAcceptanceResult =
    | { success: true; handoff: IncidentHandoff; }
    | { success: false; error: string; };

interface CreateIncidentHandoffInput {
    incidentId: string;
    fromOperator: string;
    toOperator: string;
    reason?: string;
    pendingChecks?: string[];
    responseTargetAt?: string;
    createdAt: string;
    id?: string;
}

export function createIncidentHandoff(input: CreateIncidentHandoffInput): HandoffCreationResult {
    const incidentId = input.incidentId.trim();
    const fromOperator = input.fromOperator.trim();
    const toOperator = input.toOperator.trim();
    const createdAt = parseIso(input.createdAt);

    if (!incidentId) return { success: false, error: 'An incident is required for handoff.' };
    if (!fromOperator) return { success: false, error: 'The handing-off operator is required.' };
    if (!toOperator) return { success: false, error: 'Choose a recipient before sending the handoff.' };
    if (fromOperator.toLowerCase() === toOperator.toLowerCase()) {
        return { success: false, error: 'Choose another operator for the handoff.' };
    }
    if (!createdAt) return { success: false, error: 'The handoff time is invalid.' };

    const responseTargetAt = input.responseTargetAt?.trim();
    const normalizedResponseTarget = responseTargetAt ? parseIso(responseTargetAt) : undefined;
    if (responseTargetAt && !normalizedResponseTarget) {
        return { success: false, error: 'The response target must be a valid date and time.' };
    }

    return {
        success: true,
        handoff: {
            schema: 'imonitor-incident-handoff',
            version: 1,
            id: input.id?.trim() || `handoff-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
            incidentId,
            fromOperator,
            toOperator,
            reason: input.reason?.trim() || 'Specialist review requested.',
            pendingChecks: normalizeLines(input.pendingChecks),
            responseTargetAt: normalizedResponseTarget,
            createdAt,
            status: 'pending'
        }
    };
}

export function normalizeIncidentHandoff(candidate: unknown): IncidentHandoff | undefined {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const value = candidate as Partial<IncidentHandoff>;
    if (
        value.schema !== 'imonitor-incident-handoff'
        || value.version !== 1
        || typeof value.id !== 'string'
        || typeof value.incidentId !== 'string'
        || typeof value.fromOperator !== 'string'
        || typeof value.toOperator !== 'string'
        || typeof value.reason !== 'string'
        || typeof value.createdAt !== 'string'
        || !isHandoffStatus(value.status)
    ) return undefined;

    const createdAt = parseIso(value.createdAt);
    if (!createdAt || !value.fromOperator.trim() || !value.toOperator.trim()) return undefined;
    const responseTargetAt = typeof value.responseTargetAt === 'string' && parseIso(value.responseTargetAt)
        ? value.responseTargetAt
        : undefined;
    return {
        schema: 'imonitor-incident-handoff',
        version: 1,
        id: value.id.trim(),
        incidentId: value.incidentId.trim(),
        fromOperator: value.fromOperator.trim(),
        toOperator: value.toOperator.trim(),
        reason: value.reason.trim() || 'Specialist review requested.',
        pendingChecks: normalizeLines(value.pendingChecks),
        responseTargetAt,
        createdAt,
        status: value.status,
        acceptedAt: typeof value.acceptedAt === 'string' && parseIso(value.acceptedAt) ? value.acceptedAt : undefined,
        acceptedBy: typeof value.acceptedBy === 'string' ? value.acceptedBy.trim() || undefined : undefined
    };
}

export function acceptIncidentHandoff(
    handoff: IncidentHandoff | undefined,
    operator: string,
    acceptedAt: string
): HandoffAcceptanceResult {
    if (!handoff) return { success: false, error: 'There is no pending handoff for this incident.' };
    if (handoff.status !== 'pending') return { success: false, error: 'This handoff is no longer pending.' };
    const acceptedBy = operator.trim();
    const timestamp = parseIso(acceptedAt);
    if (!acceptedBy) return { success: false, error: 'An accepting operator is required.' };
    if (acceptedBy.toLowerCase() !== handoff.toOperator.toLowerCase()) {
        return { success: false, error: `This handoff is addressed to ${handoff.toOperator}.` };
    }
    if (!timestamp) return { success: false, error: 'The acceptance time is invalid.' };
    return {
        success: true,
        handoff: { ...handoff, status: 'accepted', acceptedAt: timestamp, acceptedBy }
    };
}

/** Creates a plain-text shift brief from every open incident for editing or export. */
export function buildShiftHandoffSummary(alerts: MonitorAlert[], generatedAt = new Date().toISOString()) {
    const openAlerts = alerts.filter((alert) => alert.isActive !== false);
    const lines = [
        '# iMonitor shift handover',
        `Generated: ${generatedAt}`,
        `Open incidents: ${openAlerts.length}`,
        ''
    ];
    if (!openAlerts.length) return [...lines, 'No open incidents require handover.', ''].join('\n');

    openAlerts.forEach((alert, index) => {
        const handoff = alert.handoff;
        lines.push(
            `## ${index + 1}. ${alert.title}`,
            `Job: ${alert.jobName || 'Unknown job'}`,
            `Incident: ${alert.incidentId || alert.id}`,
            `Status: ${alert.workflowStatus}`,
            `Owner: ${alert.owner || 'Unassigned'}`,
            `Impact: ${alert.severity}`,
            `Summary: ${alert.message}`,
            handoff ? `Handoff: ${handoff.status} from ${handoff.fromOperator} to ${handoff.toOperator}` : 'Handoff: None',
            handoff?.responseTargetAt ? `Response target: ${handoff.responseTargetAt}` : '',
            handoff?.pendingChecks.length ? `Pending checks: ${handoff.pendingChecks.join('; ')}` : '',
            handoff?.reason ? `Handoff reason: ${handoff.reason}` : '',
            ''
        );
    });
    return lines.filter((line, index) => line || lines[index - 1]).join('\n');
}

function normalizeLines(lines: unknown) {
    return Array.isArray(lines)
        ? lines.map((line) => String(line).trim()).filter(Boolean).slice(0, 20)
        : [];
}

function parseIso(value: string) {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isHandoffStatus(value: unknown): value is IncidentHandoffStatus {
    return ['pending', 'accepted', 'declined', 'cancelled'].includes(String(value));
}
