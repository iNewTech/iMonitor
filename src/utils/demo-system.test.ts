import { describe, expect, it } from 'vitest';
import { buildDemoSnapshot, getDemoDataFilePath } from './demo-system';

describe('demo system snapshots', () => {
    it('builds a persistent IBM i style snapshot with operator-impacting waits present', () => {
        const snapshot = buildDemoSnapshot(1);
        const statuses = new Set(snapshot.data.map((job) => job.STATUS));

        expect(snapshot.pollCount).toBe(1);
        expect(Number.isNaN(new Date(snapshot.generatedAt).getTime())).toBe(false);
        expect(snapshot.data.length).toBeGreaterThanOrEqual(12);
        expect(snapshot.data.some((job) => job.STATUS === 'MSGW')).toBe(true);
        expect(snapshot.data.some((job) => job.STATUS === 'LCKW')).toBe(true);
        expect(snapshot.data.some((job) => job.SUBSYSTEM === 'QBATCH')).toBe(true);
        expect(snapshot.data.some((job) => job.SUBSYSTEM === 'QINTER')).toBe(true);
        expect(snapshot.data.every((job) => typeof job.JOB_NAME === 'string')).toBe(true);
        expect(statuses.has('DEQW')).toBe(true);
        expect(statuses.has('DLYW')).toBe(true);
    });

    it('spreads generated demo polls across the day', () => {
        const firstSnapshot = buildDemoSnapshot(1);
        const secondSnapshot = buildDemoSnapshot(2);

        expect(firstSnapshot.generatedAt).not.toBe(secondSnapshot.generatedAt);
        expect(new Date(secondSnapshot.generatedAt).getTime()).toBeGreaterThan(new Date(firstSnapshot.generatedAt).getTime());
    });

    it('keeps wait jobs present and adds more jobs over later polls', () => {
        const firstSnapshot = buildDemoSnapshot(1);
        const laterSnapshot = buildDemoSnapshot(5);

        expect(firstSnapshot.data.some((job) => job.JOB_NAME === '738412/QSYSOPR/MSGWJOB' && job.STATUS === 'MSGW')).toBe(true);
        expect(laterSnapshot.data.some((job) => job.JOB_NAME === '738412/QSYSOPR/MSGWJOB' && job.STATUS === 'MSGW')).toBe(true);
        expect(firstSnapshot.data.some((job) => job.JOB_NAME === '441210/APPUSR/LOCKJOB' && job.STATUS === 'LCKW')).toBe(true);
        expect(laterSnapshot.data.some((job) => job.JOB_NAME === '441210/APPUSR/LOCKJOB' && job.STATUS === 'LCKW')).toBe(true);
        expect(laterSnapshot.data.length).toBeGreaterThan(firstSnapshot.data.length);
    });

    it('uses a stable user-data relative file path for generated demo snapshots', () => {
        expect(getDemoDataFilePath('/tmp/ibmeye')).toBe('/tmp/ibmeye/demo/ibm-eye-demo-jobs.json');
    });
});
