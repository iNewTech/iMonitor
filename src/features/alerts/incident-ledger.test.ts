import { describe, expect, it, vi } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { createAlertStateStore } from '../../main/state/alert-state';
import { DEFAULT_ALERT_SETTINGS, type StoredAlertWorkflowState } from './alert-model';
import {
    migrateLegacyDemoIncidents,
    normalizeIncidentLedger,
    type IncidentLedger,
    type IncidentScope
} from './incident-ledger';
import { claimAlertWorkflow } from './alert-operator-workflow';

function createWaitingJob(): ActiveJobRecord {
    return {
        JOB_NAME: '123456/DEMO/SAMEJOB',
        JOB_NAME_SHORT: 'SAMEJOB',
        JOB_NUMBER: '123456',
        JOB_USER: 'DEMO',
        SUBSYSTEM: 'QSYSWRK',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QSYSWRK/SAMEJOB',
        CURRENT_USER: 'DEMO',
        TYPE: 'BATCH',
        CPU: 1,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Durable incident test',
        STATUS: 'MSGW',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 1,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'YES',
        DATABASE_LOCK_WAITS: 0,
        DATABASE_LOCK_WAIT_TIME: 0,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: '',
        SQL_STATEMENT_STATUS: '',
        SQL_STATEMENT_START_TIMESTAMP: ''
    };
}

describe('durable incident ledger', () => {
    it('restores one incident after restart and deduplicates repeated polls', () => {
        let ledger: IncidentLedger = {};
        let workflows: Record<string, StoredAlertWorkflowState> = {};
        const scope = { systemId: 'system-a', systemLabel: 'Production A' };
        const createStore = () => createAlertStateStore({
            initialIncidentLedger: ledger,
            initialWorkflowStateByAlertId: workflows,
            persistIncidentLedger: (next) => { ledger = next; },
            persistWorkflowState: (next) => { workflows = next; },
            getIncidentScope: () => scope,
            onAlertsChanged: vi.fn()
        });

        const firstRuntime = createStore();
        firstRuntime.evaluateAlertRules(
            [createWaitingJob()], '2026-09-12T10:00:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn()
        );
        const incidentId = firstRuntime.getActiveAlerts()[0].id;
        firstRuntime.mutateAlertWorkflow(incidentId, (state) => claimAlertWorkflow(state, {
            timestamp: '2026-09-12T10:00:30.000Z',
            owner: 'Operator One'
        }));
        firstRuntime.evaluateAlertRules(
            [createWaitingJob()], '2026-09-12T10:01:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn()
        );

        const restoredRuntime = createStore();
        restoredRuntime.evaluateAlertRules(
            [createWaitingJob()], '2026-09-12T10:02:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn()
        );

        const [incident] = restoredRuntime.getActiveAlerts();
        expect(incident.id).toContain('system-a::msgw:');
        expect(incident.systemLabel).toBe('Production A');
        expect(incident.lastSeenAt).toBe('2026-09-12T10:02:00.000Z');
        expect(incident).toMatchObject({
            workflowStatus: 'claimed',
            lifecyclePhase: 'investigating',
            owner: 'Operator One'
        });
        expect(incident.timeline.filter((event) => event.action === 'created')).toHaveLength(1);
        expect(Object.keys(ledger)).toHaveLength(1);
    });

    it('records a recurrence and keeps identical jobs separate by system', () => {
        let scope: IncidentScope = { systemId: 'system-a', systemLabel: 'Production A' };
        let ledger: IncidentLedger = {};
        const store = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            persistWorkflowState: vi.fn(),
            persistIncidentLedger: (next) => { ledger = next; },
            getIncidentScope: () => scope,
            onAlertsChanged: vi.fn()
        });

        store.evaluateAlertRules([createWaitingJob()], '2026-09-12T10:00:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn());
        store.evaluateAlertRules([], '2026-09-12T10:01:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn());
        store.evaluateAlertRules([createWaitingJob()], '2026-09-12T10:02:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn());
        expect(store.getActiveAlerts()[0]).toMatchObject({ occurrence: 2, isActive: true });
        expect(store.getActiveAlerts()[0].timeline[0]?.action).toBe('reopened');
        expect(store.getActiveAlerts()[0].timeline.map((event) => event.version)).toEqual([3, 2, 1]);

        scope = { systemId: 'system-b', systemLabel: 'Production B' };
        store.evaluateAlertRules([createWaitingJob()], '2026-09-12T10:03:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn());

        expect(Object.values(ledger)).toHaveLength(2);
        expect(new Set(Object.values(ledger).map((incident) => incident.systemId))).toEqual(
            new Set(['system-a', 'system-b'])
        );
    });

    it('drops corrupt records while retaining valid records', () => {
        const validStore = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            persistWorkflowState: vi.fn(),
            getIncidentScope: () => ({ systemId: 'system-a', systemLabel: 'A' }),
            onAlertsChanged: vi.fn()
        });
        validStore.evaluateAlertRules(
            [createWaitingJob()], '2026-09-12T10:00:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn()
        );
        const valid = validStore.getActiveAlerts()[0];

        const normalized = normalizeIncidentLedger({
            [valid.id]: valid,
            broken: { id: 'broken', title: 'Incomplete' },
            mismatch: { ...valid, id: 'different' }
        });
        expect(Object.keys(normalized)).toEqual([valid.id]);
    });

    it('migrates legacy random demo identities to the stable demo profile', () => {
        const legacy = {
            'demo-123::msgw:123456/DEMO/SAMEJOB': {
                id: 'demo-123::msgw:123456/DEMO/SAMEJOB',
                systemId: 'demo-123',
                systemLabel: 'iMonitor Demo System',
                kind: 'messageWait',
                severity: 'critical',
                timestamp: '2026-09-12T10:00:00.000Z',
                title: 'MSGW detected',
                message: 'Job entered message wait.',
                workflowStatus: 'claimed',
                workflowUpdatedAt: '2026-09-12T10:00:30.000Z',
                notes: [],
                timeline: [],
                isActive: true
            }
        } as unknown as IncidentLedger;

        const migrated = migrateLegacyDemoIncidents(legacy, 'demo-connection', 'Demo connection');
        const [record] = Object.values(migrated);
        expect(record).toMatchObject({
            id: 'demo-connection::msgw:123456/DEMO/SAMEJOB',
            incidentId: 'demo-connection::msgw:123456/DEMO/SAMEJOB',
            systemId: 'demo-connection',
            systemLabel: 'Demo connection'
        });
    });

    it('keeps the local incident when an external delivery adapter fails', async () => {
        const store = createAlertStateStore({
            initialWorkflowStateByAlertId: {},
            persistWorkflowState: vi.fn(),
            getIncidentScope: () => ({ systemId: 'system-a', systemLabel: 'A' }),
            onAlertsChanged: vi.fn(),
            onAlertCreated: () => Promise.reject(new Error('External service unavailable'))
        });

        store.evaluateAlertRules(
            [createWaitingJob()], '2026-09-12T10:00:00.000Z', DEFAULT_ALERT_SETTINGS, vi.fn()
        );
        await Promise.resolve();

        expect(store.getActiveAlerts()).toHaveLength(1);
    });
});
