import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OBJECT_ANALYSIS_SETTINGS } from './model';
import { buildDetailedProgramAnalysis } from './program-analysis';
import { persistObjectAnalysisReport } from './report-storage';
import { DemoObjectAnalysisService } from '../../services/object-analysis';
import { getDemoObjectAnalysisPath } from '../../utils/demo-system';

describe('mapped object analysis report storage', () => {
    it('writes JSON, Markdown, and a source-to-report map', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'imonitor-analysis-report-'));
        const service = new DemoObjectAnalysisService(getDemoObjectAnalysisPath());
        const request = {
            library: 'ORDERLIB',
            relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDENTR.rpgle'
        };
        try {
            const result = await service.analyzeObject(request, DEFAULT_OBJECT_ANALYSIS_SETTINGS);
            const source = await service.getSourceContent(request, DEFAULT_OBJECT_ANALYSIS_SETTINGS);
            const detailed = buildDetailedProgramAnalysis(result, source);
            detailed.approval = { status: 'approved', approvedAt: '2026-09-04T12:00:00.000Z', approvedBy: 'GajenderT' };
            const artifact = await persistObjectAnalysisReport(root, detailed, source);

            expect(artifact).toEqual(expect.objectContaining({
                key: 'ORDERLIB/QRPGLESRC/ORDENTR',
                mode: 'source-directory'
            }));
            await expect(readFile(path.join(root, artifact.relativePath!), 'utf8')).resolves.toContain('"businessLogic"');
            await expect(readFile(path.join(root, artifact.relativePath!), 'utf8')).resolves.toContain('"approvedBy": "GajenderT"');
            await expect(readFile(path.join(root, artifact.markdownPath!), 'utf8')).resolves.toContain('## Conversion plan');
            await expect(readFile(path.join(root, artifact.mapPath!), 'utf8')).resolves.toContain('ORDERLIB/QRPGLESRC/ORDENTR');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
