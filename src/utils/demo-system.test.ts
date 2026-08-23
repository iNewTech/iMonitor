import { describe, expect, it } from 'vitest';
import { buildDemoSnapshot, getDemoDataFilePath } from './demo-system';

describe('demo system snapshots', () => {
    it('builds a rotating snapshot with IBM i style job records', () => {
        const snapshot = buildDemoSnapshot(1);

        expect(snapshot.pollCount).toBe(1);
        expect(snapshot.data).toHaveLength(4);
        expect(snapshot.data.some((job) => job.STATUS === 'MSGW')).toBe(true);
        expect(snapshot.data.every((job) => typeof job.JOB_NAME === 'string')).toBe(true);
    });

    it('uses a stable user-data relative file path for generated demo snapshots', () => {
        expect(getDemoDataFilePath('/tmp/ibmeye')).toBe('/tmp/ibmeye/demo/ibm-eye-demo-jobs.json');
    });
});
