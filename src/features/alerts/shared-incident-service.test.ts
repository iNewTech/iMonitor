import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from './alert-model';
import {
    buildSharedIncidentEvent,
    createSharedIncidentService,
    mergeSharedIncidentEvents,
    type SharedIncidentAdapter,
    type SharedIncidentEvent,
    type SharedIncidentScope
} from './shared-incident-service';

const scope: SharedIncidentScope = { organizationId: 'customer-a', systemId: 'system-a' };

function incident(overrides: Partial<MonitorAlert> = {}): MonitorAlert {
    return {
        id: 'system-a::msgw:1/USER/JOB',
        incidentId: 'system-a::msgw:1/USER/JOB',
        systemId: 'system-a',
        systemLabel: 'Production A',
        resourceId: '1/USER/JOB',
        occurrence: 1,
        recordVersion: 1,
        kind: 'messageWait',
        severity: 'critical',
        timestamp: '2026-09-12T10:00:00.000Z',
        lastSeenAt: '2026-09-12T10:00:00.000Z',
        isActive: true,
        title: 'MSGW detected',
        message: 'Job entered message wait.',
        workflowStatus: 'new',
        notes: [],
        timeline: [],
        workflowUpdatedAt: '2026-09-12T10:00:00.000Z',
        ...overrides
    };
}

function createMemoryAdapter() {
    let events: SharedIncidentEvent[] = [];
    let available = true;
    const requests: Array<{ cursor: unknown; }> = [];
    const adapter: SharedIncidentAdapter = {
        async append(envelope) {
            if (!available) throw new Error('shared service unavailable');
            events = mergeSharedIncidentEvents(envelope.scope, events, envelope.events);
        },
        async pull(request) {
            if (!available) throw new Error('shared service unavailable');
            requests.push({ cursor: request.cursor });
            return {
                schemaVersion: 1,
                scope: request.scope,
                cursor: events.length
                    ? { occurredAt: events[events.length - 1].occurredAt, eventId: events[events.length - 1].eventId }
                    : null,
                events: events.slice(0, request.limit)
            };
        }
    };
    return {
        adapter,
        requests,
        setAvailable(value: boolean) {
            available = value;
        }
    };
}

describe('shared incident service', () => {
    it('syncs an incident from one client cache to another', async () => {
        const backend = createMemoryAdapter();
        const clientA = createSharedIncidentService({ scope, adapter: backend.adapter });
        const clientB = createSharedIncidentService({ scope, adapter: backend.adapter });

        await clientA.publish([incident({ owner: 'Operator A', workflowStatus: 'claimed' })]);
        await clientA.sync();
        const result = await clientB.sync();

        expect(result.state.status).toBe('online');
        expect(result.incidents['system-a::msgw:1/USER/JOB']).toMatchObject({
            owner: 'Operator A',
            workflowStatus: 'claimed'
        });
    });

    it('keeps local events pending and recovers after an interrupted sync', async () => {
        const backend = createMemoryAdapter();
        const service = createSharedIncidentService({ scope, adapter: backend.adapter });
        await service.publish([incident()]);

        backend.setAvailable(false);
        const offline = await service.sync();
        expect(offline.state).toMatchObject({ status: 'offline', pendingEvents: 1 });

        backend.setAvailable(true);
        const online = await service.sync();
        expect(online.state).toMatchObject({ status: 'online', pendingEvents: 0 });
        expect(backend.requests).toHaveLength(1);
    });

    it('marks a previously online cache stale when the sync window expires', async () => {
        const backend = createMemoryAdapter();
        let clock = '2026-09-12T10:00:00.000Z';
        const service = createSharedIncidentService({
            scope,
            adapter: backend.adapter,
            now: () => clock,
            staleAfterMs: 60_000
        });

        await service.publish([incident()]);
        await service.sync();
        clock = '2026-09-12T10:01:01.000Z';
        expect(service.getSyncState().status).toBe('stale');
    });

    it('deduplicates events and rejects events from another customer scope', () => {
        const event = buildSharedIncidentEvent(incident(), scope);
        const otherEvent = buildSharedIncidentEvent(incident({ id: 'other::msgw:job', incidentId: 'other::msgw:job' }), {
            organizationId: 'customer-b',
            systemId: 'system-b'
        });
        const merged = mergeSharedIncidentEvents(scope, [event], [event, otherEvent]);
        expect(merged).toHaveLength(1);
        expect(merged[0].eventId).toBe(event.eventId);
    });

    it('does not load a cache from another customer scope', async () => {
        const otherScope = { organizationId: 'customer-b', systemId: 'system-b' };
        const otherEvent = buildSharedIncidentEvent(incident({ id: 'other::msgw:job', incidentId: 'other::msgw:job' }), otherScope);
        const service = createSharedIncidentService({
            scope,
            initialCache: { scope: otherScope, events: [otherEvent], pendingEventIds: [] }
        });

        expect(service.getEvents()).toHaveLength(0);
        expect(service.getSyncState().cursor).toBeNull();
    });

    it('retains the latest incident revision while purging old history', async () => {
        const service = createSharedIncidentService({ scope });
        await service.publish([incident()]);
        await service.publish([incident({
            owner: 'Operator A',
            workflowStatus: 'claimed',
            workflowUpdatedAt: '2026-09-12T11:00:00.000Z',
            lastSeenAt: '2026-09-12T11:00:00.000Z'
        })]);

        expect(service.pruneBefore('2026-09-12T10:30:00.000Z')).toBe(1);
        expect(service.getEvents()).toHaveLength(1);
        expect(service.exportCache().schemaVersion).toBe(1);
        expect(service.getIncidents()['system-a::msgw:1/USER/JOB']?.owner).toBe('Operator A');
    });
});
