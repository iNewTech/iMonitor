import { describe, expect, it } from 'vitest';
import { buildObjectAnalysisAiContext, buildObjectAnalysisAiQuestion } from './ai-prompt';
import type { ObjectAnalysisResult } from './model';

const result: ObjectAnalysisResult = {
    source: 'live',
    root: {
        id: 'ORDERLIB/ORDENTR|*PGM',
        name: 'ORDENTR',
        library: 'ORDERLIB',
        type: '*PGM',
        status: 'known',
        attributes: {}
    },
    nodes: [],
    edges: [],
    directDependencies: 0,
    impactedObjects: 0,
    unresolvedReferences: [],
    sourceSignals: ['Embedded SQL was found.'],
    readiness: {
        status: 'review',
        label: 'Review needed',
        score: 92,
        blockers: [],
        warnings: [],
        confirmed: []
    },
    systemEvidence: {
        source: 'ibmi-commands',
        collectedAt: '2026-09-04T00:00:00.000Z',
        commands: [{
            name: 'DSPPGMREF',
            command: 'DSPPGMREF PGM(ORDERLIB/ORDENTR)',
            status: 'collected',
            rowCount: 4
        }],
        notes: []
    },
    generatedAt: '2026-09-04T00:00:00.000Z',
    scope: { libraries: ['ORDERLIB'], sourceLibrary: 'ORDERLIB', depth: 2, maxNodes: 100 }
};

describe('object analysis AI prompt', () => {
    it('keeps the AI report grounded in command evidence and source text', () => {
        const context = buildObjectAnalysisAiContext(result, 'dcl-f ORDHDR keyed usage(*input);');

        expect(context).toContain('DSPPGMREF: collected; rows=4');
        expect(context).toContain('dcl-f ORDHDR');
        expect(context).toContain('Do not invent tables, programs, fields, steps, or business rules.');
    });

    it('asks for business logic without claiming an IBM i action was executed', () => {
        expect(buildObjectAnalysisAiQuestion(result)).toContain('business-logic and modernization report');
        expect(buildObjectAnalysisAiQuestion(result)).toContain('never claim that you executed an action');
    });
});
