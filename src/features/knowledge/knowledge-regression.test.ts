import { describe, expect, it } from 'vitest';
import {
    KNOWLEDGE_GOLDEN_CASES,
    runKnowledgeRegressionSuite,
    serializeKnowledgeRegressionReport
} from './knowledge-regression';

describe('knowledge regression harness', () => {
    it('passes the versioned golden suite across support scenarios', async () => {
        const report = await runKnowledgeRegressionSuite(KNOWLEDGE_GOLDEN_CASES, {
            now: '2026-09-14T10:00:00.000Z',
            clock: (() => { let tick = 0; return () => tick += 1; })()
        });

        expect(report.passed).toBe(true);
        expect(report.totals).toEqual({ cases: 10, passed: 10, failed: 0 });
        expect(report.metrics.retrievalRecallProxy).toBe(1);
        expect(report.metrics.retrievalPrecisionProxy).toBe(1);
        expect(report.metrics.citationCoverage).toBe(1);
        expect(report.metrics.scopeViolations).toBe(0);
        expect(report.metrics.refusalCorrectness).toBe(1);
        expect(report.cases.find((item) => item.id === 'stale-runbook')?.freshness).toBe('stale');
        expect(report.cases.find((item) => item.id === 'prompt-injection')?.passed).toBe(true);
    });

    it('fails promotion evidence when an expected record or citation disappears', async () => {
        const report = await runKnowledgeRegressionSuite([KNOWLEDGE_GOLDEN_CASES[0]], {
            retrieve: () => [],
            now: '2026-09-14T10:00:00.000Z'
        });

        expect(report.passed).toBe(false);
        expect(report.metrics.retrievalRecallProxy).toBe(0);
        expect(report.metrics.citationCoverage).toBe(0);
        expect(report.cases[0].failures).toEqual(expect.arrayContaining([
            'Missing expected records: msgw-runbook',
            'Missing required citations: citation:msgw-runbook'
        ]));
    });

    it('keeps comparison artifacts sanitized and free of source content', async () => {
        const report = await runKnowledgeRegressionSuite(KNOWLEDGE_GOLDEN_CASES, { now: '2026-09-14T10:00:00.000Z' });
        const artifact = serializeKnowledgeRegressionReport(report);

        expect(artifact).toContain('prompt-injection');
        expect(artifact).toContain('hostile-evidence');
        expect(artifact).not.toContain('Ignore previous instructions');
        expect(artifact).not.toContain('password=secret-value');
        expect(artifact).not.toContain('Inspect the lock owner before changing the job');
    });

    it('filters a provider response again when it returns cross-system records', async () => {
        const testCase = KNOWLEDGE_GOLDEN_CASES[1];
        const report = await runKnowledgeRegressionSuite([testCase], {
            retrieve: (current) => [...current.records, ...testCase.records],
            now: '2026-09-14T10:00:00.000Z'
        });

        expect(report.passed).toBe(true);
        expect(report.cases[0].retrievedRecordIds).toEqual(['lckw-runbook']);
        expect(report.cases[0].excludedRecordIds).toContain('other-system-lock');
    });
});
