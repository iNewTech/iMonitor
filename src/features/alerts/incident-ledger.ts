import type { AlertKind, MonitorAlert } from './alert-model';
import { normalizeIncidentEvidence } from './incident-evidence';

export const INCIDENT_RECORD_VERSION = 1;

export interface IncidentScope {
    systemId: string;
    systemLabel: string;
}

export type IncidentLedger = Record<string, MonitorAlert>;

/** Builds one stable key from the saved system and monitored condition. */
export function buildScopedAlertId(scope: IncidentScope | undefined, conditionId: string) {
    const systemId = scope?.systemId.trim();
    return systemId ? `${encodeURIComponent(systemId)}::${conditionId}` : conditionId;
}

/** Adds durable identity metadata to a live alert snapshot. */
export function buildIncidentMetadata(
    scope: IncidentScope | undefined,
    incidentId: string,
    resourceId: string,
    existingAlert?: MonitorAlert
) {
    return {
        incidentId,
        systemId: scope?.systemId,
        systemLabel: scope?.systemLabel,
        resourceId,
        occurrence: existingAlert?.isActive === false
            ? (existingAlert.occurrence ?? 1) + 1
            : existingAlert?.occurrence ?? 1,
        recordVersion: INCIDENT_RECORD_VERSION,
        evidence: existingAlert?.evidence
    };
}

/** Keeps only valid operator-facing records when loading local persistence. */
export function normalizeIncidentLedger(candidate: unknown): IncidentLedger {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return {};
    }

    return Object.entries(candidate as Record<string, unknown>).reduce<IncidentLedger>((ledger, [key, value]) => {
        const alert = normalizeIncidentRecord(key, value);
        if (alert) {
            ledger[alert.id] = alert;
        }
        return ledger;
    }, {});
}

export function getIncidentsForSystem(ledger: IncidentLedger, systemId: string) {
    return Object.values(ledger).filter((alert) => alert.systemId === systemId);
}

/** Migrates demo records created before the demo connection received a stable ID. */
export function migrateLegacyDemoIncidents(
    ledger: IncidentLedger,
    stableSystemId: string,
    systemLabel: string
) {
    const next = { ...ledger };
    Object.values(ledger).forEach((alert) => {
        if (!alert.systemId || alert.systemId === stableSystemId || !alert.systemId.startsWith('demo-')) {
            return;
        }

        const stableId = getStableDemoIncidentId(alert.id, stableSystemId);
        const migrated = {
            ...alert,
            id: stableId,
            incidentId: stableId,
            systemId: stableSystemId,
            systemLabel
        };
        const current = next[stableId];
        if (!current || new Date(migrated.lastSeenAt ?? migrated.timestamp).getTime()
            >= new Date(current.lastSeenAt ?? current.timestamp).getTime()) {
            next[stableId] = migrated;
        }
        delete next[alert.id];
    });
    return next;
}

export function getStableDemoIncidentId(legacyId: string, stableSystemId: string) {
    const separator = legacyId.indexOf('::');
    const conditionId = separator >= 0 ? legacyId.slice(separator + 2) : legacyId;
    return `${encodeURIComponent(stableSystemId)}::${conditionId}`;
}

export function mergeSystemIncidents(
    ledger: IncidentLedger,
    _systemId: string,
    incidents: MonitorAlert[]
) {
    const next = { ...ledger };
    incidents.forEach((alert) => {
        next[alert.id] = alert;
    });
    return next;
}

function normalizeIncidentRecord(key: string, candidate: unknown): MonitorAlert | null {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return null;
    }

    const alert = candidate as Partial<MonitorAlert>;
    if (
        typeof alert.id !== 'string'
        || alert.id !== key
        || !isAlertKind(alert.kind)
        || typeof alert.timestamp !== 'string'
        || typeof alert.title !== 'string'
        || typeof alert.message !== 'string'
    ) {
        return null;
    }

    return {
        ...alert,
        incidentId: alert.incidentId || alert.id,
        occurrence: positiveInteger(alert.occurrence, 1),
        recordVersion: INCIDENT_RECORD_VERSION,
        evidence: normalizeIncidentEvidence(alert.evidence),
        lifecyclePhase: alert.lifecyclePhase || 'detected',
        isActive: alert.isActive !== false,
        notes: Array.isArray(alert.notes) ? alert.notes : [],
        timeline: Array.isArray(alert.timeline) ? alert.timeline : [],
        workflowStatus: alert.workflowStatus || 'new',
        workflowUpdatedAt: alert.workflowUpdatedAt || alert.timestamp
    } as MonitorAlert;
}

function positiveInteger(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isAlertKind(value: unknown): value is AlertKind {
    return [
        'highCpu', 'messageWait', 'lockWait', 'delayWait', 'dequeueWait', 'pollFailure'
    ].includes(String(value));
}
