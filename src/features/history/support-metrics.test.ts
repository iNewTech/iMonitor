import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../alerts/alert-model';
import { buildAiAvailabilityEvents, calculateSupportMetrics } from './support-metrics';

const window = {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    timeZone: 'Asia/Kolkata'
};

function incident(overrides: Partial<MonitorAlert> = {}): MonitorAlert {
    return {
        id: overrides.id || 'system::msgw:JOB1',
        systemId: 'system',
        kind: 'messageWait',
        severity: 'critical',
        timestamp: '2026-09-01T01:00:00.000Z',
        title: 'MSGW detected',
        message: 'A job is waiting.',
        workflowStatus: 'system_cleared',
        notes: [],
        timeline: [],
        workflowUpdatedAt: '2026-09-01T01:20:00.000Z',
        isActive: false,
        ...overrides
    };
}

describe('support-metrics', () => {
    it('measures the operator path and explicitly reports no autonomous recovery', () => {
        const report = calculateSupportMetrics({
            systemId: 'system',
            incidents: [incident({
                timeline: [
                    { id: 'resolved', action: 'system_cleared', label: 'Condition cleared', timestamp: '2026-09-01T01:40:00.000Z' },
                    { id: 'done', action: 'work_marked_done', label: 'Work marked done', timestamp: '2026-09-01T01:30:00.000Z' },
                    { id: 'claim', action: 'claimed', label: 'Work claimed', timestamp: '2026-09-01T01:10:00.000Z' },
                    { id: 'ack', action: 'acknowledged', label: 'Acknowledged', timestamp: '2026-09-01T01:05:00.000Z' },
                    { id: 'created', action: 'created', label: 'Alert created', timestamp: '2026-09-01T01:00:00.000Z' }
                ]
            })],
            ...window,
            generatedAt: '2026-09-02T00:00:00.000Z'
        });

        expect(report.summary).toMatchObject({
            incidentCount: 1,
            resolvedCount: 1,
            operatorVerifiedRecoveryCount: 1,
            monitoringConfirmedRecoveryCount: 1,
            autonomousResolutionCount: 0
        });
        expect(report.stages.acknowledgement.averageMinutes).toBe(5);
        expect(report.stages.investigation.averageMinutes).toBe(20);
        expect(report.stages.verifiedRecovery.averageMinutes).toBe(10);
        expect(report.window.timeZone).toBe('Asia/Kolkata');
    });

    it('uses an exclusive upper boundary and handles timezone-labelled windows', () => {
        const report = calculateSupportMetrics({
            systemId: 'system',
            incidents: [
                incident({ id: 'at-start', timestamp: '2026-09-01T00:00:00.000Z' }),
                incident({ id: 'at-end', timestamp: '2026-09-02T00:00:00.000Z' })
            ],
            ...window,
            generatedAt: '2026-09-02T00:00:00.000Z'
        });

        expect(report.summary.incidentCount).toBe(1);
        expect(report.window).toEqual(window);
    });

    it('counts a reopened incident as unresolved for the current cycle', () => {
        const report = calculateSupportMetrics({
            systemId: 'system',
            incidents: [incident({
                isActive: true,
                workflowStatus: 'new',
                timeline: [
                    { id: 'reopened', action: 'reopened', label: 'Condition returned', timestamp: '2026-09-01T02:00:00.000Z' },
                    { id: 'resolved', action: 'system_cleared', label: 'Condition cleared', timestamp: '2026-09-01T01:40:00.000Z' }
                ],
                resolvedAt: undefined
            })],
            ...window
        });

        expect(report.summary).toMatchObject({ incidentCount: 1, resolvedCount: 0, unresolvedCount: 1, reopenedCount: 1 });
        expect(report.stages.recurrence.unknown).toBe(1);
    });

    it('keeps missing timestamps and zero denominators visible as unknown', () => {
        const report = calculateSupportMetrics({
            systemId: 'system',
            incidents: [incident({ timestamp: 'not-a-date', timeline: [] })],
            aiEvents: [],
            ...window
        });

        expect(report.summary.incidentCount).toBe(0);
        expect(report.aiAvailability).toMatchObject({ sampleSize: 0, availabilityPercent: null });
        expect(report.stages.acknowledgement).toMatchObject({ sampleSize: 0, measured: 0, unknown: 0, averageMinutes: null });
    });

    it('keeps a small baseline honest and compares only measured averages', () => {
        const report = calculateSupportMetrics({
            systemId: 'system',
            incidents: [incident({
                timeline: [
                    { id: 'resolved', action: 'system_cleared', label: 'Condition cleared', timestamp: '2026-09-01T01:30:00.000Z' },
                    { id: 'done', action: 'work_marked_done', label: 'Work marked done', timestamp: '2026-09-01T01:20:00.000Z' }
                ]
            })],
            aiEvents: [
                { timestamp: '2026-09-01T01:00:00.000Z', status: 'available' },
                { timestamp: '2026-09-01T01:05:00.000Z', status: 'unavailable' }
            ],
            ...window
        });

        expect(report.baseline?.summary.incidentCount).toBe(0);
        expect(report.baseline?.comparison.recoveryMinutesDelta).toBeNull();
        expect(report.aiAvailability).toMatchObject({ sampleSize: 2, available: 1, unavailable: 1, availabilityPercent: 50 });
    });

    it('keeps AI request observations scoped to the connected customer system', () => {
        const events = buildAiAvailabilityEvents([
            { id: 'one', timestamp: '2026-09-01T01:00:00.000Z', systemId: 'system', area: 'ai', level: 'info', message: 'IBMEye AI analysis completed.' },
            { id: 'two', timestamp: '2026-09-01T01:01:00.000Z', systemId: 'other', area: 'ai', level: 'error', message: 'IBMEye AI analysis failed.' }
        ], 'system');

        expect(events).toEqual([{ timestamp: '2026-09-01T01:00:00.000Z', status: 'available', systemId: 'system' }]);
    });
});
