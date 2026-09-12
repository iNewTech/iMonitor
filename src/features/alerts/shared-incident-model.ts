import type { MonitorAlert } from './alert-model';
import { normalizeIncidentLedger, type IncidentLedger } from './incident-ledger';

export const SHARED_INCIDENT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SHARED_SYNC_LIMIT = 250;

export interface SharedIncidentScope {
    organizationId: string;
    systemId: string;
}

export type SharedIncidentEventKind = 'upsert' | 'remove';

export interface SharedIncidentEvent {
    schemaVersion: typeof SHARED_INCIDENT_SCHEMA_VERSION;
    eventId: string;
    kind: SharedIncidentEventKind;
    incidentId: string;
    scope: SharedIncidentScope;
    occurredAt: string;
    sourceRevision: string;
    incident?: MonitorAlert;
}

export interface SharedIncidentCursor {
    occurredAt: string;
    eventId: string;
}

export interface SharedIncidentSyncEnvelope {
    schemaVersion: typeof SHARED_INCIDENT_SCHEMA_VERSION;
    scope: SharedIncidentScope;
    cursor: SharedIncidentCursor | null;
    events: SharedIncidentEvent[];
}

export interface SharedIncidentCache {
    schemaVersion: typeof SHARED_INCIDENT_SCHEMA_VERSION;
    scope: SharedIncidentScope;
    cursor: SharedIncidentCursor | null;
    events: SharedIncidentEvent[];
    pendingEventIds: string[];
    lastSyncedAt?: string;
}

export type SharedIncidentSyncStatus = 'online' | 'offline' | 'stale';

export interface SharedIncidentSyncState {
    status: SharedIncidentSyncStatus;
    cursor: SharedIncidentCursor | null;
    pendingEvents: number;
    lastSyncedAt?: string;
}

export interface SharedIncidentAdapter {
    append(envelope: SharedIncidentSyncEnvelope): Promise<void>;
    pull(request: {
        scope: SharedIncidentScope;
        cursor: SharedIncidentCursor | null;
        limit: number;
    }): Promise<SharedIncidentSyncEnvelope>;
}

export interface SharedIncidentSyncResult {
    incidents: IncidentLedger;
    state: SharedIncidentSyncState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeScope(candidate: unknown): SharedIncidentScope | null {
    if (!isRecord(candidate)) {
        return null;
    }

    const organizationId = typeof candidate.organizationId === 'string' ? candidate.organizationId.trim() : '';
    const systemId = typeof candidate.systemId === 'string' ? candidate.systemId.trim() : '';
    return organizationId && systemId ? { organizationId, systemId } : null;
}

function scopeKey(scope: SharedIncidentScope) {
    return `${scope.organizationId}::${scope.systemId}`;
}

function compareEvents(left: SharedIncidentEvent, right: SharedIncidentEvent) {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
    }
    if (left.occurredAt !== right.occurredAt) {
        return left.occurredAt.localeCompare(right.occurredAt);
    }
    return left.eventId.localeCompare(right.eventId);
}

function latestEventByIncident(events: SharedIncidentEvent[]) {
    const latest = new Map<string, SharedIncidentEvent>();
    events.slice().sort(compareEvents).forEach((event) => {
        latest.set(event.incidentId, event);
    });
    return latest;
}

function getIncidentId(incident: MonitorAlert) {
    return String(incident.incidentId || incident.id || '').trim();
}

function getSourceRevision(incident: MonitorAlert) {
    const timelineVersion = incident.timeline.reduce((highest, entry) => Math.max(highest, entry.version || 0), 0);
    return [
        incident.occurrence || 1,
        timelineVersion,
        incident.workflowUpdatedAt,
        incident.lastSeenAt || '',
        incident.resolvedAt || '',
        incident.isActive === false ? 'inactive' : 'active',
        incident.workflowStatus
    ].join('|');
}

/** Builds a deterministic event identity for one incident revision. */
export function buildSharedIncidentEvent(incident: MonitorAlert, scope: SharedIncidentScope): SharedIncidentEvent {
    const incidentId = getIncidentId(incident);
    const sourceRevision = getSourceRevision(incident);
    const occurredAt = incident.workflowUpdatedAt || incident.lastSeenAt || incident.timestamp;
    return {
        schemaVersion: SHARED_INCIDENT_SCHEMA_VERSION,
        eventId: [scopeKey(scope), incidentId, sourceRevision].map(encodeURIComponent).join('::'),
        kind: 'upsert',
        incidentId,
        scope,
        occurredAt,
        sourceRevision,
        incident
    };
}

function normalizeCursor(candidate: unknown): SharedIncidentCursor | null {
    if (!isRecord(candidate) || typeof candidate.occurredAt !== 'string' || typeof candidate.eventId !== 'string') {
        return null;
    }
    return { occurredAt: candidate.occurredAt, eventId: candidate.eventId };
}

/** Rejects malformed records before they enter a shared cache or adapter. */
export function normalizeSharedIncidentEvent(candidate: unknown): SharedIncidentEvent | null {
    if (!isRecord(candidate)
        || candidate.schemaVersion !== SHARED_INCIDENT_SCHEMA_VERSION
        || typeof candidate.eventId !== 'string'
        || !['upsert', 'remove'].includes(String(candidate.kind))
        || typeof candidate.incidentId !== 'string'
        || typeof candidate.occurredAt !== 'string'
        || typeof candidate.sourceRevision !== 'string') {
        return null;
    }

    const scope = normalizeScope(candidate.scope);
    if (!scope) {
        return null;
    }

    if (candidate.kind === 'upsert') {
        const incident = normalizeIncidentLedger({ [candidate.incidentId]: candidate.incident })[candidate.incidentId];
        if (!incident) {
            return null;
        }
        return {
            schemaVersion: SHARED_INCIDENT_SCHEMA_VERSION,
            eventId: candidate.eventId,
            kind: 'upsert',
            incidentId: candidate.incidentId,
            scope,
            occurredAt: candidate.occurredAt,
            sourceRevision: candidate.sourceRevision,
            incident
        };
    }

    return {
        schemaVersion: SHARED_INCIDENT_SCHEMA_VERSION,
        eventId: candidate.eventId,
        kind: 'remove',
        incidentId: candidate.incidentId,
        scope,
        occurredAt: candidate.occurredAt,
        sourceRevision: candidate.sourceRevision
    };
}

/** Merges events by stable ID and keeps a deterministic order for all clients. */
export function mergeSharedIncidentEvents(
    scope: SharedIncidentScope,
    localEvents: SharedIncidentEvent[],
    incomingEvents: SharedIncidentEvent[]
) {
    const expectedScope = scopeKey(scope);
    const merged = new Map<string, SharedIncidentEvent>();
    [...localEvents, ...incomingEvents].forEach((candidate) => {
        const event = normalizeSharedIncidentEvent(candidate);
        if (!event || scopeKey(event.scope) !== expectedScope) {
            return;
        }
        merged.set(event.eventId, event);
    });
    return [...merged.values()].sort(compareEvents);
}

/** Reduces an ordered event stream into the current incident view. */
export function reduceSharedIncidentEvents(events: SharedIncidentEvent[]): IncidentLedger {
    const incidents: IncidentLedger = {};
    latestEventByIncident(events).forEach((event) => {
        if (event.kind === 'upsert' && event.incident) {
            incidents[event.incident.id] = event.incident;
        }
    });
    return incidents;
}

export function getSharedIncidentCursor(events: SharedIncidentEvent[]): SharedIncidentCursor | null {
    const ordered = events.slice().sort(compareEvents);
    const latest = ordered[ordered.length - 1];
    return latest ? { occurredAt: latest.occurredAt, eventId: latest.eventId } : null;
}

export function normalizeSharedIncidentCache(candidate: unknown, fallbackScope: SharedIncidentScope): SharedIncidentCache {
    const source = isRecord(candidate) ? candidate : {};
    const storedScope = normalizeScope(source.scope);
    const scope = storedScope && scopeKey(storedScope) === scopeKey(fallbackScope)
        ? storedScope
        : fallbackScope;
    const events = Array.isArray(source.events)
        ? mergeSharedIncidentEvents(scope, [], source.events as SharedIncidentEvent[])
        : [];
    const pendingEventIds = Array.isArray(source.pendingEventIds)
        ? source.pendingEventIds.filter((id): id is string => typeof id === 'string' && events.some((event) => event.eventId === id))
        : [];
    return {
        schemaVersion: SHARED_INCIDENT_SCHEMA_VERSION,
        scope,
        cursor: normalizeCursor(source.cursor) || getSharedIncidentCursor(events),
        events,
        pendingEventIds,
        lastSyncedAt: typeof source.lastSyncedAt === 'string' ? source.lastSyncedAt : undefined
    };
}
