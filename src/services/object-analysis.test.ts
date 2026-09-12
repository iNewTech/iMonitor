import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OBJECT_ANALYSIS_SETTINGS, type AnalysisFileNode } from '../features/object-analysis/model';
import { getDemoObjectAnalysisPath } from '../utils/demo-system';
import { DemoObjectAnalysisService } from './object-analysis';

describe('demo object analysis service', () => {
    const service = new DemoObjectAnalysisService(getDemoObjectAnalysisPath());

    it('loads the IBM i-shaped master library and source tree', async () => {
        const workspace = await service.getWorkspace(DEFAULT_OBJECT_ANALYSIS_SETTINGS);

        expect(workspace.source).toBe('demo');
        expect(workspace.masterLibrary).toBe('QSYS');
        expect(workspace.libraries.map((library) => library.name)).toEqual([
            'COMMONLIB', 'INVENTORY', 'ORDERLIB'
        ]);
        expect(workspace.sourceFileCount).toBeGreaterThanOrEqual(5);
        expect(workspace.databaseFileCount).toBeGreaterThanOrEqual(4);
        expect(JSON.stringify(workspace.tree)).toContain('ORDENTR.rpgle');
    });

    it('loads the ordered library list from setup.json', async () => {
        await expect(service.getConfiguredLibraries()).resolves.toEqual([
            'ORDERLIB', 'COMMONLIB', 'INVENTORY'
        ]);
    });

    it('analyzes an order-entry program across files and runtime objects', async () => {
        const result = await service.analyzeObject({
            library: 'ORDERLIB',
            relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDENTR.rpgle'
        }, DEFAULT_OBJECT_ANALYSIS_SETTINGS);

        expect(result.root).toEqual(expect.objectContaining({
            library: 'ORDERLIB',
            name: 'ORDENTR',
            type: '*PGM'
        }));
        expect(result.nodes.map((node) => `${node.library}/${node.name}`)).toEqual(expect.arrayContaining([
            'ORDERLIB/CUSTOMER',
            'ORDERLIB/ORDHDR',
            'ORDERLIB/ORDERQ',
            'ORDERLIB/ORDER_MODE',
            'COMMONLIB/PRICING_CALC'
        ]));
        expect(result.edges.map((edge) => edge.relationship)).toEqual(expect.arrayContaining([
            'reads', 'writes', 'references', 'includes', 'uses'
        ]));
        expect(result.sourceSignals).toEqual(expect.arrayContaining([
            'Embedded SQL was found.',
            'Dynamic CL command execution was found.',
            'Data queues are used.'
        ]));
        expect(result.readiness.status).toBe('review');
        expect(result.edges.every((edge) => edge.evidence !== 'demo-fixture')).toBe(true);
    });

    it('treats a selected local library folder as one complete directory scope', async () => {
        const singleLibrary = new DemoObjectAnalysisService(
            path.join(getDemoObjectAnalysisPath(), 'userlib', 'ORDERLIB')
        );
        const workspace = await singleLibrary.getWorkspace({ libraries: ['ORDERLIB'] });

        expect(workspace.libraries.map((library) => library.name)).toEqual(['ORDERLIB']);
        expect(JSON.stringify(workspace.tree)).toContain('ORDENTR.rpgle');
        expect(JSON.stringify(workspace.tree)).not.toContain('PRICING.rpgle');
    });

    it('keeps missing lookup libraries in the analysis scope without blocking source browsing', async () => {
        const settings = { libraryList: ['ORDERLIB', 'MISSINGLIB'] };
        const workspace = await service.getWorkspace(settings);
        expect(workspace.libraries.map((library) => library.name)).toContain('COMMONLIB');
        const result = await service.analyzeObject({
            library: 'ORDERLIB', relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDENTR.rpgle'
        }, settings);
        expect(result.scope.libraries).toEqual(settings.libraryList);
        expect(result.nodes.find((node) => node.name === 'PRICING_CALC')?.status).toBe('unresolved');
    });

    it('uses detected libraries when setup is absent and writes setup only on explicit save', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'imonitor-analysis-setup-'));
        try {
            await mkdir(path.join(root, 'userlib', 'APP01', 'QRPGLESRC'), { recursive: true });
            await writeFile(path.join(root, 'userlib', 'APP01', 'QRPGLESRC', 'MYPGM.rpgle'), '**free\nreturn;\n', 'utf8');
            const temporaryService = new DemoObjectAnalysisService(root);

            await expect(temporaryService.getLibraryListInfo()).resolves.toEqual(expect.objectContaining({
                libraries: ['APP01'],
                source: 'detected'
            }));
            await expect(readFile(path.join(root, 'setup.json'), 'utf8')).rejects.toThrow();

            await expect(temporaryService.saveLibraryList(['APP01'])).resolves.toEqual({
                fileName: 'setup.json',
                libraries: ['APP01']
            });
            await expect(readFile(path.join(root, 'setup.json'), 'utf8')).resolves.toContain('"libraryList"');
            await expect(temporaryService.getLibraryListInfo()).resolves.toEqual(expect.objectContaining({
                libraries: ['APP01'],
                source: 'setup-file',
                fileName: 'setup.json'
            }));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('does not turn reverse references into dependencies of a copybook', async () => {
        const result = await service.analyzeObject({
            library: 'ORDERLIB',
            relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDCOPY.rpgle'
        }, DEFAULT_OBJECT_ANALYSIS_SETTINGS);

        expect(result.directDependencies).toBe(0);
        expect(result.edges).toHaveLength(0);
        expect(result.impactedObjects).toBeGreaterThan(0);
    });

    it('keeps source signals scoped to the selected program', async () => {
        const result = await service.analyzeObject({
            library: 'ORDERLIB',
            relativePath: 'userlib/ORDERLIB/QRPGLESRC/ORDRPGSRV.rpgle'
        }, DEFAULT_OBJECT_ANALYSIS_SETTINGS);

        expect(result.root.name).toBe('ORDRPGSRV');
        expect(result.sourceSignals).not.toContain('Embedded SQL was found.');
        expect(result.sourceSignals).not.toContain('Data queues are used.');
        expect(result.readiness.warnings).toHaveLength(0);
    });
});


describe('local source discovery and object lookup', () => {
    const temporaryRoots: string[] = [];
    afterEach(async () => {
        await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    async function fixture(files: Record<string, string>) {
        const root = await mkdtemp(path.join(os.tmpdir(), 'imonitor-local-'));
        temporaryRoots.push(root);
        for (const [relativePath, content] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
            await writeFile(path.join(root, relativePath), content, 'utf8');
        }
        return root;
    }

    function members(node: AnalysisFileNode): AnalysisFileNode[] {
        return node.analyzable ? [node] : (node.children || []).flatMap(members);
    }

    it.each(['', 'userlib/', 'UserLib/', 'user-libraries/'])(
        'discovers %sLIB/SRCPF without setup and preserves physical path casing', async (prefix) => {
            const source = '**free\nreturn;\n';
            const root = await fixture({
                [`${prefix}App01/SrcPf/MyPgm.Rpgle`]: source,
                [`${prefix}Data01/Tables/Customer.sql`]: 'create table CUSTOMER (ID int);',
                'imonitor-analysis/build/PLAN.cl': 'CALL PGM(GENERATED)',
                '.cache/Bad/Src/Hidden.rpgle': source
            });
            const service = new DemoObjectAnalysisService(root);
            expect(await service.getConfiguredLibraries()).toEqual(['APP01', 'DATA01']);
            const workspace = await service.getWorkspace({ libraryList: ['UNEXPORTED'] });
            expect(workspace.sourceFileCount).toBe(1);
            expect(workspace.databaseFileCount).toBe(1);
            const file = members(workspace.tree).find((node) => node.library === 'APP01')!;
            expect(file.relativePath).toBe(`${prefix}App01/SrcPf/MyPgm.Rpgle`);
            await expect(service.getSourceContent({ library: 'app01', relativePath: file.relativePath }, { libraryList: [] }))
                .resolves.toBe(source);
            const result = await service.analyzeObject({ library: 'APP01', relativePath: file.relativePath }, { libraryList: [] });
            expect(result.root.sourcePath).toBe('SrcPf/MyPgm.Rpgle');
            expect(result.root.status).toBe('known');
            expect(result.scope.libraries).toEqual([]);
            await expect(readFile(path.join(root, 'setup.json'), 'utf8')).rejects.toThrow();
        }
    );

    it.each(['SrcPf/MyPgm.Rpgle', 'MyPgm.Rpgle'])(
        'discovers a selected library with %s and no setup or catalog', async (memberPath) => {
            const root = await fixture({ [`App01/${memberPath}`]: '**free\nreturn;' });
            const service = new DemoObjectAnalysisService(path.join(root, 'App01'));
            expect(await service.getConfiguredLibraries()).toEqual(['APP01']);
            const workspace = await service.getWorkspace({ libraryList: ['MISSING'] });
            expect(workspace.libraries.map((library) => library.name)).toEqual(['APP01']);
            expect(members(workspace.tree)[0].relativePath).toBe(memberPath);
            await expect(service.getSourceContent({ library: 'APP01', relativePath: memberPath.toUpperCase() }))
                .resolves.toContain('return;');
            const result = await service.analyzeObject({ library: 'APP01', relativePath: memberPath }, { libraryList: ['MISSING'] });
            expect(result.root.name).toBe('MYPGM');
        }
    );

    it('discovers libraries when the userlib container itself is selected', async () => {
        const root = await fixture({ 'UserLib/App01/SrcPf/Main.rpgle': '**free\nreturn;' });
        const service = new DemoObjectAnalysisService(path.join(root, 'UserLib'));
        expect(await service.getConfiguredLibraries()).toEqual(['APP01']);
        expect(members((await service.getWorkspace()).tree)[0].relativePath).toBe('App01/SrcPf/Main.rpgle');
    });

    it('does not use setup lookup entries as directories or hide a selected source library', async () => {
        const root = await fixture({
            'App01/SrcPf/Main.rpgle': '**free\nreturn;',
            'App01/Setup.JSON': JSON.stringify({ masterLibrary: 'QSYS', libraryList: ['REMOTE', 'OTHER'], keep: 'custom metadata' })
        });
        const service = new DemoObjectAnalysisService(path.join(root, 'App01'));
        expect(await service.getLibraryListInfo()).toMatchObject({ libraries: ['REMOTE', 'OTHER'], source: 'setup-file' });
        const workspace = await service.getWorkspace({ libraryList: ['REMOTE', 'OTHER'] });
        expect(workspace.libraries.map((library) => library.name)).toEqual(['APP01']);
        expect(workspace.libraries[0].selected).toBe(false);
        await expect(service.getSourceContent({ library: 'APP01', relativePath: 'SrcPf/Main.rpgle' }, { libraryList: ['REMOTE'] }))
            .resolves.toContain('return;');
        expect(await service.saveLibraryList(['OTHER', 'REMOTE'])).toEqual({ fileName: 'Setup.JSON', libraries: ['OTHER', 'REMOTE'] });
        expect(JSON.parse(await readFile(path.join(root, 'App01/Setup.JSON'), 'utf8'))).toMatchObject({ keep: 'custom metadata', libraryList: ['OTHER', 'REMOTE'] });
    });

    it.each(['', 'userlib/'])(
        'excludes generated outputs under %s from browsing, lookup, and direct selection', async (prefix) => {
            const root = await fixture({
                [`${prefix}App01/SrcPf/Main.rpgle`]: "**free\ncall 'GHOST';",
                [`${prefix}App01/imonitor-analysis/build/GHOST.cl`]: "CALL PGM(MAIN)",
                [`${prefix}App01/SrcPf/IMONITOR-ANALYSIS/build/NESTED.cl`]: "CALL PGM(MAIN)",
                'imonitor-analysis/build/ROOT.cl': "CALL PGM(MAIN)"
            });
            const service = new DemoObjectAnalysisService(root);
            const settings = { libraryList: ['APP01'] };
            const workspace = await service.getWorkspace(settings);
            expect(members(workspace.tree).map((file) => file.name)).toEqual(['Main.rpgle']);
            expect(workspace.sourceFileCount).toBe(1);
            const result = await service.analyzeObject({ library: 'APP01', relativePath: `${prefix}App01/SrcPf/Main.rpgle` }, settings);
            expect(result.nodes.find((node) => node.name === 'GHOST')?.status).toBe('unresolved');
            expect(result.impactedObjects).toBe(0);
            const generated = { library: 'APP01', relativePath: `${prefix}App01/imonitor-analysis/build/GHOST.cl` };
            await expect(service.getSourceContent(generated, settings)).rejects.toThrow('Source text was not found');
            await expect(service.analyzeObject(generated, settings)).rejects.toThrow('Source text was not found');
        }
    );

    it('uses strict lookup order across catalogs and inferred objects independently of the selected source', async () => {
        const root = await fixture({
            'userlib/SrcLib/Src/Main.rpgle': "**free\ncall 'TARGET';\ncall 'LOCALONLY';\ncall 'MISSING/TARGET';\ncall 'FIRST/TARGET';\ncall '*LIBL/TARGET';",
            'userlib/SrcLib/Src/TARGET.rpgle': '**free\nreturn;',
            'userlib/SrcLib/Src/LOCALONLY.rpgle': '**free\nreturn;',
            'userlib/First/Src/Target.rpgle': '**free\nreturn;',
            'userlib/Second/Objects.JSON': JSON.stringify({ library: 'WRONG', objects: [{ name: 'TARGET', type: '*PGM' }] }),
            'setup.json': JSON.stringify({ libraryList: ['SECOND', 'FIRST', 'REMOTE'] })
        });
        const service = new DemoObjectAnalysisService(root);
        const request = { library: 'SRCLIB', relativePath: 'userlib/SrcLib/Src/Main.rpgle' };
        const workspace = await service.getWorkspace({ libraryList: ['FIRST', 'SECOND'] });
        expect(workspace.sourceFileCount).toBe(4);
        expect((await service.getWorkspace({ libraryList: ['SECOND'] })).tree).toEqual(workspace.tree);
        const first = await service.analyzeObject(request, { libraryList: ['FIRST', 'SECOND', 'SRCLIB'] });
        const targetOnLine = (result: typeof first, line: number) => {
            const edge = result.edges.find((edge) => edge.from === result.root.id && edge.line === line)!;
            return result.nodes.find((node) => node.id === edge.to)!;
        };
        expect(targetOnLine(first, 2).library).toBe('FIRST');
        expect(targetOnLine(first, 4)).toMatchObject({ library: 'MISSING', name: 'TARGET', status: 'unresolved' });
        expect(targetOnLine(first, 5).library).toBe('FIRST');
        expect(targetOnLine(first, 6).library).toBe('FIRST');
        const second = await service.analyzeObject(request, { libraryList: ['REMOTE', 'SECOND', 'FIRST'] });
        expect(second.root.library).toBe('SRCLIB');
        expect(second.scope.libraries).toEqual(['REMOTE', 'SECOND', 'FIRST']);
        expect(targetOnLine(second, 2).library).toBe('SECOND');
        expect(targetOnLine(second, 3)).toMatchObject({ name: 'LOCALONLY', status: 'unresolved' });
        expect(targetOnLine(second, 5).library).toBe('FIRST');
        expect(targetOnLine(second, 6).library).toBe('SECOND');
    });

    it('rejects a path for another library instead of stripping arbitrary matching segments', async () => {
        const root = await fixture({
            'userlib/App01/Src/Main.rpgle': '**free\nreturn;',
            'userlib/App02/Src/Main.rpgle': '**free\nreturn;'
        });
        const service = new DemoObjectAnalysisService(root);
        for (const relativePath of ['userlib/App02/Src/Main.rpgle', '../App01/Src/Main.rpgle', 'unrelated/App01/Src/Main.rpgle']) {
            await expect(service.getSourceContent({ library: 'APP01', relativePath })).rejects.toThrow('Source text was not found');
        }
    });
});
