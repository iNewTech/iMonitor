import { describe, expect, it } from 'vitest';
import { normalizeBusinessServiceSettings, resolveBusinessService, type BusinessServiceSettings } from './business-service-mapping';

const job = (overrides = {}) => ({
    JOB_NAME: 'ORDER/POST', JOB_NAME_SHORT: 'POST', JOB_NUMBER: '1', JOB_USER: 'OPS', SUBSYSTEM: 'QBATCH', SUBSYSTEM_LIBRARY_NAME: 'QSYS',
    STATUS: 'MSGW', CPU: 12, JOB_QUEUE_NAME: 'ORDQ', ...overrides
} as any);

describe('business service mapping', () => {
    it('uses the more specific mapping before a broader overlapping rule', () => {
        const settings: BusinessServiceSettings = { mappings: [
            { id: 'broad', serviceName: 'Operations', owner: 'Ops', systemIds: ['*'], alertKinds: [], jobPattern: 'ORDER/*', priority: 100 },
            { id: 'specific', serviceName: 'Order Processing', owner: 'Finance', systemIds: ['prod'], alertKinds: ['messageWait'], jobPattern: 'ORDER/POST', priority: 0, deadlineMinutes: 60 }
        ] };
        const result = resolveBusinessService({ systemId: 'prod', job: job(), alert: { kind: 'messageWait', timestamp: '2026-09-12T10:00:00Z' } as any, now: '2026-09-12T10:20:00Z' }, settings);
        expect(result).toMatchObject({ mapped: true, serviceName: 'Order Processing', owner: 'Finance', deadlineState: 'on_track' });
    });

    it('handles overnight schedules and invalid timezones without inventing impact', () => {
        const overnight: BusinessServiceSettings = { mappings: [{ id: 'night', serviceName: 'Nightly close', owner: 'Finance', systemIds: ['prod'], alertKinds: [], jobPattern: 'ORDER/*', priority: 1, expectedSchedule: { timezone: 'Asia/Kolkata', days: [6], startMinute: 22 * 60, endMinute: 2 * 60 } }] };
        const result = resolveBusinessService({ systemId: 'prod', job: job(), now: '2026-09-12T17:00:00Z' }, overnight);
        expect(result.scheduleState).toBe('expected');
        const invalid = normalizeBusinessServiceSettings({ mappings: [{ id: 'bad', serviceName: 'Bad', owner: 'Ops', systemIds: ['prod'], alertKinds: [], jobPattern: 'ORDER/*', expectedSchedule: { timezone: 'Invalid/Zone', days: [8], startMinute: -1, endMinute: 300 } }] as any });
        expect(resolveBusinessService({ systemId: 'prod', job: job(), now: '2026-09-12T20:00:00Z' }, invalid).scheduleState).toBe('unknown');
    });

    it('labels absent configuration as unknown and keeps limits bounded', () => {
        const result = resolveBusinessService({ systemId: 'prod', job: job(), now: '2026-09-12T10:00:00Z' }, normalizeBusinessServiceSettings(undefined));
        expect(result).toMatchObject({ mapped: false, deadlineState: 'not_configured', scheduleState: 'not_configured' });
        expect(normalizeBusinessServiceSettings({ mappings: Array.from({ length: 130 }, (_, index) => ({ id: String(index), serviceName: 'Service', owner: 'Ops', systemIds: [], alertKinds: [], jobPattern: '*', priority: 0 })) })).toHaveProperty('mappings.length', 100);
    });
});
