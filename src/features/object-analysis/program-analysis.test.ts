import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECT_ANALYSIS_SETTINGS } from './model';
import { buildDetailedProgramAnalysis } from './program-analysis';
import { DemoObjectAnalysisService } from '../../services/object-analysis';
import { getDemoObjectAnalysisPath } from '../../utils/demo-system';

describe('detailed RPGLE program analysis', () => {
    it('derives business rules, execution flow, and a conversion plan from source evidence', async () => {
        const service = new DemoObjectAnalysisService(getDemoObjectAnalysisPath());
        const request = {
            library: 'ORDERLIB',
            relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDENTR.rpgle'
        };
        const [result, source] = await Promise.all([
            service.analyzeObject(request, DEFAULT_OBJECT_ANALYSIS_SETTINGS),
            service.getSourceContent(request, DEFAULT_OBJECT_ANALYSIS_SETTINGS)
        ]);

        const detailed = buildDetailedProgramAnalysis(result, source);

        expect(detailed.businessLogic?.findings.map((item) => item.category)).toEqual(expect.arrayContaining([
            'validation', 'data-rule', 'transaction', 'integration'
        ]));
        expect(detailed.programFlow?.map((item) => item.kind)).toEqual(expect.arrayContaining([
            'entry', 'condition', 'data-read', 'data-write', 'service-call', 'runtime-resource', 'transaction', 'exit'
        ]));
        expect(detailed.conversionPlan?.map((item) => item.phase)).toEqual(expect.arrayContaining([
            'Discover', 'Design', 'Build', 'Verify', 'Cutover'
        ]));
        expect(detailed.conversionPlan?.find((item) => item.phase === 'Verify')?.action).toContain('test case');
    });
});
