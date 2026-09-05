import { describe, expect, it, vi } from 'vitest';
import { IbmiObjectAnalysisService, type IbmiObjectAnalysisClient } from './object-analysis-live';

describe('live IBM i object analysis service', () => {
    it('loads only the configured libraries and their source members', async () => {
        const query = vi.fn(async (statement: string, parameters: (string | number)[] = []) => {
            if (statement.includes('SYSMEMBERSTAT')) {
                return {
                    data: [
                        {
                            SYSTEM_TABLE_SCHEMA: parameters[0],
                            SYSTEM_TABLE_NAME: 'QRPGLESRC',
                            SYSTEM_TABLE_MEMBER: 'ORDENTR',
                            SOURCE_TYPE: 'RPGLE'
                        },
                        {
                            SYSTEM_TABLE_SCHEMA: parameters[0],
                            SYSTEM_TABLE_NAME: 'QSQLSRC',
                            SYSTEM_TABLE_MEMBER: 'ORDERS',
                            SOURCE_TYPE: 'SQL'
                        }
                    ]
                };
            }
            return {
                data: [{
                    OBJECT_SCHEMA: parameters[0],
                    OBJECT_NAME: 'ORDENTR',
                    OBJECT_TYPE: '*PGM',
                    TEXT_DESCRIPTION: 'Order entry'
                }]
            };
        });
        const service = new IbmiObjectAnalysisService({ query: query as unknown as IbmiObjectAnalysisClient['query'] });

        const workspace = await service.getWorkspace({ source: 'ibmi', libraries: ['ORDERLIB'] });

        expect(workspace.source).toBe('live');
        expect(workspace.libraries.map((library) => library.name)).toEqual(['ORDERLIB']);
        expect(JSON.stringify(workspace.tree)).toContain('ORDENTR.rpgle');
        expect(JSON.stringify(workspace.tree)).toContain('ORDERS.sql');
        expect(query.mock.calls.every((call) => call[1]?.[0] === 'ORDERLIB')).toBe(true);
    });

    it('loads source text on demand and keeps analysis inside the configured scope', async () => {
        const query = vi.fn(async (statement: string, parameters: (string | number)[] = []) => {
            if (statement.includes('SYSMEMBERSTAT')) return { data: [] };
            if (statement.includes('FROM "ORDERLIB"."QRPGLESRC"')) {
                return { data: [{ SRCSEQ: 1, SRCDTA: "CALL PGM(PRICING)" }] };
            }
            return {
                data: [{
                    OBJECT_SCHEMA: parameters[0],
                    OBJECT_NAME: parameters[0] === 'ORDERLIB' ? 'ORDENTR' : 'PRICING',
                    OBJECT_TYPE: '*PGM'
                }]
            };
        });
        const service = new IbmiObjectAnalysisService({ query: query as unknown as IbmiObjectAnalysisClient['query'] });

        const result = await service.analyzeObject({
            library: 'ORDERLIB',
            relativePath: 'libraries/ORDERLIB/source-pf/QRPGLESRC/ORDENTR.rpgle'
        }, { source: 'ibmi', libraries: ['ORDERLIB', 'COMMONLIB'] });

        expect(result.source).toBe('live');
        expect(result.scope.libraries).toEqual(['ORDERLIB', 'COMMONLIB']);
        expect(result.nodes.map((node) => `${node.library}/${node.name}`)).toContain('COMMONLIB/PRICING');
        expect(query.mock.calls.some((call) => call[0].includes('FROM "COMMONLIB"."QRPGLESRC"'))).toBe(false);
    });

    it('reads the live library-list sequence separately from source members', async () => {
        const query = vi.fn(async (statement: string) => {
            if (statement.includes('SYSLIBL')) {
                return { data: [
                    { ORDINAL_POSITION: 1, SYSTEM_SCHEMA_NAME: 'APP01' },
                    { ORDINAL_POSITION: 2, SYSTEM_SCHEMA_NAME: 'COMMONLIB' }
                ] };
            }
            return { data: [] };
        });
        const service = new IbmiObjectAnalysisService({ query: query as unknown as IbmiObjectAnalysisClient['query'] });

        await expect(service.getEnvironmentLibraryList()).resolves.toEqual(['APP01', 'COMMONLIB']);
        expect(query.mock.calls[0][0]).toContain('ORDER BY ORDINAL_POSITION');
    });

    it('loads source members from one library while searching objects in the ordered list', async () => {
        const query = vi.fn(async (statement: string, parameters: (string | number)[] = []) => {
            if (statement.includes('SYSMEMBERSTAT')) {
                return { data: [{ SYSTEM_TABLE_NAME: 'QRPGLESRC', SYSTEM_TABLE_MEMBER: 'PROGRAM', SOURCE_TYPE: 'RPGLE' }] };
            }
            return { data: [{ OBJECT_SCHEMA: parameters[0], OBJECT_NAME: 'PROGRAM', OBJECT_TYPE: '*PGM' }] };
        });
        const service = new IbmiObjectAnalysisService({ query: query as unknown as IbmiObjectAnalysisClient['query'] });

        const workspace = await service.getWorkspace({
            source: 'ibmi',
            libraryList: ['COMMONLIB', 'APP01'],
            sourceLibrary: 'APP01'
        });

        expect(workspace.masterLibrary).toBe('APP01');
        expect(workspace.libraries.map((library) => [library.name, library.sourceFiles])).toEqual([
            ['COMMONLIB', 0], ['APP01', 1]
        ]);
        expect(query.mock.calls.filter((call) => call[0].includes('SYSMEMBERSTAT')).map((call) => call[1]?.[0])).toEqual(['APP01']);
    });

    it('rejects an object outside the configured library list', async () => {
        const service = new IbmiObjectAnalysisService({ query: vi.fn() as unknown as IbmiObjectAnalysisClient['query'] });

        await expect(service.analyzeObject({
            library: 'OTHERLIB',
            relativePath: 'libraries/OTHERLIB/source-pf/QRPGLESRC/PROGRAM.rpgle'
        }, { source: 'ibmi', libraries: ['ORDERLIB'] })).rejects.toThrow('outside the configured IBM i library list');
    });

    it('collects compiled command evidence and keeps it separate from source evidence', async () => {
        const query = vi.fn(async (statement: string, parameters: (string | number)[] = []) => {
            if (statement.includes('SYSMEMBERSTAT')) {
                return { data: [] };
            }
            if (statement.includes('FROM "ORDERLIB"."QRPGLESRC"')) {
                return { data: [{ SRCSEQ: 1, SRCDTA: 'dcl-f ORDHDR keyed usage(*input);' }] };
            }
            if (statement.includes('QTEMP."IMPGMREF"')) {
                return {
                    data: [{ WHFNAM: 'ORDHDR', WHLNAM: 'ORDERLIB', WHOTYP: '*FILE', WHFUSG: 1 }]
                };
            }
            if (statement.includes('QTEMP."IMDBR"') || statement.includes('QTEMP."IMDSPFD"')) {
                return { data: [] };
            }
            return {
                data: [{
                    OBJECT_SCHEMA: parameters[0],
                    OBJECT_NAME: 'ORDENTR',
                    OBJECT_TYPE: '*PGM'
                }]
            };
        });
        const executeClCommand = vi.fn(async () => undefined);
        const service = new IbmiObjectAnalysisService({
            query: query as unknown as IbmiObjectAnalysisClient['query'],
            executeClCommand
        });

        const result = await service.analyzeObject({
            library: 'ORDERLIB',
            relativePath: 'libraries/ORDERLIB/QRPGLESRC/ORDENTR.rpgle'
        }, { source: 'ibmi', libraries: ['ORDERLIB'] });

        expect(result.systemEvidence?.source).toBe('ibmi-commands');
        expect(result.systemEvidence?.commands.map((command) => command.name)).toEqual([
            'DSPPGMREF', 'DSPDBR', 'DSPFD'
        ]);
        expect(result.systemEvidence?.commands.every((command) => command.status === 'collected')).toBe(true);
        expect(executeClCommand).toHaveBeenCalledWith(expect.stringContaining('DSPPGMREF PGM(ORDERLIB/ORDENTR)'));
        expect(result.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                evidence: 'compiled',
                relationship: 'reads'
            })
        ]));
    });
});
