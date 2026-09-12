import type { MonitorAlert } from './alert-model';
import {
    DEFAULT_SHARED_SYNC_LIMIT,
    SHARED_INCIDENT_SCHEMA_VERSION,
    buildSharedIncidentEvent,
    getSharedIncidentCursor,
    mergeSharedIncidentEvents,
    normalizeSharedIncidentCache,
    reduceSharedIncidentEvents,
    type SharedIncidentAdapter,
    type SharedIncidentCache,
    type SharedIncidentEvent,
    type SharedIncidentScope,
    type SharedIncidentSyncResult,
    type SharedIncidentSyncState
} from './shared-incident-model';
import type { IncidentLedger } from './incident-ledger';

export {
    buildSharedIncidentEvent,
    mergeSharedIncidentEvents,
    normalizeSharedIncidentCache,
    reduceSharedIncidentEvents
} from './shared-incident-model';
export type {
    SharedIncidentAdapter,
    SharedIncidentCache,
    SharedIncidentEvent,
    SharedIncidentScope,
    SharedIncidentSyncEnvelope,
    SharedIncidentSyncResult,
    SharedIncidentSyncState
} from './shared-incident-model';

interface SharedIncidentServiceDependencies {
    scope: SharedIncidentScope;
    initialCache?: unknown;
    adapter?: SharedIncidentAdapter;
    persist?: (cache: SharedIncidentCache) => void;
    now?: () => string;
    staleAfterMs?: number;
    syncLimit?: number;
}

export interface SharedIncidentService {
    publish(incidents: MonitorAlert[]): Promise<void>;
    sync(): Promise<SharedIncidentSyncResult>;
    getIncidents(): IncidentLedger;
    getEvents(): SharedIncidentEvent[];
    getSyncState(): SharedIncidentSyncState;
    pruneBefore(timestamp: string): number;
    exportCache(): SharedIncidentCache;
}

function sameScope(left: SharedIncidentScope, right: SharedIncidentScope) {
    return left.organizationId === right.organizationId && left.systemId === right.systemId;
}

/** Creates the shared incident boundary with cache, incremental sync, and offline recovery. */
export function createSharedIncidentService(dependencies: SharedIncidentServiceDependencies): SharedIncidentService {
    const now = dependencies.now || (() => new Date().toISOString());
    const staleAfterMs = dependencies.staleAfterMs || 5 * 60 * 1000;
    const syncLimit = dependencies.syncLimit || DEFAULT_SHARED_SYNC_LIMIT;
    let cache = normalizeSharedIncidentCache(dependencies.initialCache, dependencies.scope);
    let syncStatus: SharedIncidentSyncState['status'] = dependencies.adapter ? 'stale' : 'offline';

    const persist = () => dependencies.persist?.({
        ...cache,
        events: cache.events.slice(),
        pendingEventIds: cache.pendingEventIds.slice()
    });

    const getSyncState = (): SharedIncidentSyncState => {
        const lastSyncTime = cache.lastSyncedAt ? Date.parse(cache.lastSyncedAt) : NaN;
        const currentTime = Date.parse(now());
        const isStale = syncStatus === 'online'
            && Number.isFinite(lastSyncTime)
            && Number.isFinite(currentTime)
            && currentTime - lastSyncTime > staleAfterMs;
        return {
            status: isStale ? 'stale' : syncStatus,
            cursor: cache.cursor,
            pendingEvents: cache.pendingEventIds.length,
            lastSyncedAt: cache.lastSyncedAt
        };
    };

    return {
        async publish(incidents) {
            const knownEventIds = new Set(cache.events.map((event) => event.eventId));
            const events = incidents
                .filter((incident) => Boolean(incident.incidentId || incident.id))
                .map((incident) => buildSharedIncidentEvent(incident, dependencies.scope));
            cache.events = mergeSharedIncidentEvents(cache.scope, cache.events, events);
            const pending = new Set(cache.pendingEventIds);
            events.forEach((event) => {
                if (!knownEventIds.has(event.eventId)) {
                    pending.add(event.eventId);
                }
            });
            cache.pendingEventIds = [...pending];
            persist();
        },
        async sync() {
            if (!dependencies.adapter) {
                syncStatus = 'offline';
                return { incidents: reduceSharedIncidentEvents(cache.events), state: getSyncState() };
            }

            try {
                const pendingEvents = cache.events.filter((event) => cache.pendingEventIds.includes(event.eventId));
                if (pendingEvents.length) {
                    await dependencies.adapter.append({
                        schemaVersion: SHARED_INCIDENT_SCHEMA_VERSION,
                        scope: cache.scope,
                        cursor: cache.cursor,
                        events: pendingEvents
                    });
                    const pendingIds = new Set(pendingEvents.map((event) => event.eventId));
                    cache.pendingEventIds = cache.pendingEventIds.filter((id) => !pendingIds.has(id));
                }

                const incoming = await dependencies.adapter.pull({
                    scope: cache.scope,
                    cursor: cache.cursor,
                    limit: syncLimit
                });
                if (incoming.schemaVersion !== SHARED_INCIDENT_SCHEMA_VERSION || !sameScope(incoming.scope, cache.scope)) {
                    throw new Error('Shared incident service returned an invalid scope or schema.');
                }
                cache.events = mergeSharedIncidentEvents(cache.scope, cache.events, incoming.events);
                cache.cursor = incoming.cursor || cache.cursor || getSharedIncidentCursor(cache.events);
                cache.lastSyncedAt = now();
                syncStatus = 'online';
                persist();
            } catch {
                syncStatus = 'offline';
                persist();
            }

            return { incidents: reduceSharedIncidentEvents(cache.events), state: getSyncState() };
        },
        getIncidents() {
            return reduceSharedIncidentEvents(cache.events);
        },
        getEvents() {
            return cache.events.slice();
        },
        getSyncState,
        pruneBefore(timestamp) {
            const cutoff = Date.parse(timestamp);
            if (!Number.isFinite(cutoff)) {
                return 0;
            }
            const latestByIncident = new Map<string, SharedIncidentEvent>();
            cache.events.forEach((event) => latestByIncident.set(event.incidentId, event));
            const latestEventIds = new Set([...latestByIncident.values()].map((event) => event.eventId));
            const retained = cache.events.filter((event) => {
                const eventTime = Date.parse(event.occurredAt);
                return latestEventIds.has(event.eventId) || !Number.isFinite(eventTime) || eventTime >= cutoff;
            });
            const removed = cache.events.length - retained.length;
            cache.events = retained;
            cache.pendingEventIds = cache.pendingEventIds.filter((id) => retained.some((event) => event.eventId === id));
            cache.cursor = cache.cursor && retained.some((event) => event.eventId === cache.cursor?.eventId)
                ? cache.cursor
                : getSharedIncidentCursor(retained);
            persist();
            return removed;
        },
        exportCache() {
            return {
                ...cache,
                events: cache.events.slice(),
                pendingEventIds: cache.pendingEventIds.slice()
            };
        }
    };
}
