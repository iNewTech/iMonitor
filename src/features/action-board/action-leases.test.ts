import { describe, expect, it } from 'vitest';
import { createActionLeaseStore } from './action-leases';

describe('action leases', () => {
    it('allows one execution, blocks a concurrent duplicate, and rejects replay', () => {
        const leases = createActionLeaseStore({ now: () => '2026-09-12T10:00:00.000Z' });
        const first = leases.acquire('system-a/job-a', 'execution-1', 'operator-a');
        expect(first.granted).toBe(true);
        expect(leases.acquire('system-a/job-a', 'execution-2', 'operator-b')).toMatchObject({ granted: false, reason: 'duplicate' });
        expect(leases.acquire('system-a/job-b', 'execution-1', 'operator-b')).toMatchObject({ granted: false, reason: 'replay' });
        if (first.granted) leases.complete(first.lease);
        expect(leases.acquire('system-a/job-a', 'execution-1', 'operator-a')).toMatchObject({ granted: false, reason: 'replay' });
    });

    it('expires a lease so a later execution can proceed', () => {
        let timestamp = '2026-09-12T10:00:00.000Z';
        const leases = createActionLeaseStore({ now: () => timestamp, ttlMs: 1000 });
        expect(leases.acquire('system-a/job-a', 'execution-1', 'operator-a').granted).toBe(true);
        timestamp = '2026-09-12T10:00:02.000Z';
        expect(leases.acquire('system-a/job-a', 'execution-2', 'operator-b').granted).toBe(true);
    });
});
