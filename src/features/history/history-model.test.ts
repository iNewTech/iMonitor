import { describe, expect, it } from 'vitest';
import { buildHistoricalMonitorState, parsePersistentLogRecord } from './history-model';

describe('history-model', () => {
    it('parses persistent poll log records', () => {
        const record = parsePersistentLogRecord(JSON.stringify({
            schemaVersion: 1,
            type: 'poll',
            timestamp: '2026-08-23T10:00:00.000Z',
            monitorMode: 'live',
            connection: { name: 'DEV', host: 'dev.example', user: 'gtyagi', port: 8076 },
            payload: {
                intervalMs: 5000,
                totalJobs: 4,
                peakCpu: 82.5,
                runningJobs: 2,
                waitingJobs: 2,
                messageWaitJobs: 1,
                lockWaitJobs: 1,
                jobs: []
            }
        }));

        expect(record?.type).toBe('poll');
        expect(record?.payload.totalJobs).toBe(4);
    });

    it('rebuilds trends and incident windows from structured poll records', () => {
        const records = [
            parsePersistentLogRecord(JSON.stringify({
                schemaVersion: 1,
                type: 'poll',
                timestamp: '2026-08-23T10:00:00.000Z',
                monitorMode: 'live',
                connection: { name: 'DEV', host: 'dev.example', user: 'gtyagi', port: 8076 },
                payload: {
                    intervalMs: 5000,
                    totalJobs: 4,
                    peakCpu: 42.5,
                    runningJobs: 3,
                    waitingJobs: 1,
                    messageWaitJobs: 0,
                    lockWaitJobs: 0,
                    jobs: []
                }
            })),
            parsePersistentLogRecord(JSON.stringify({
                schemaVersion: 1,
                type: 'poll',
                timestamp: '2026-08-23T10:05:00.000Z',
                monitorMode: 'live',
                connection: { name: 'DEV', host: 'dev.example', user: 'gtyagi', port: 8076 },
                payload: {
                    intervalMs: 5000,
                    totalJobs: 5,
                    peakCpu: 89.5,
                    runningJobs: 2,
                    waitingJobs: 3,
                    messageWaitJobs: 1,
                    lockWaitJobs: 1,
                    jobs: []
                }
            }))
        ].filter(Boolean);

        const state = buildHistoricalMonitorState(records, 80);

        expect(state.snapshots).toHaveLength(2);
        expect(state.trends.peakCpu).toEqual([42.5, 89.5]);
        expect(state.incidents[0]).toMatchObject({
            kind: 'mixed',
            severity: 'critical'
        });
    });
});
