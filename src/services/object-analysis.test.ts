import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OBJECT_ANALYSIS_SETTINGS } from '../features/object-analysis/model';
import { getDemoObjectAnalysisPath } from '../utils/demo-system';
import { DemoObjectAnalysisService } from './object-analysis';

describe('demo object analysis service', () => {
    const service = new DemoObjectAnalysisService(getDemoObjectAnalysisPath());

    it('loads the IBM i-shaped master library and source tree', async () => {
        const workspace = await service.getWorkspace(DEFAULT_OBJECT_ANALYSIS_SETTINGS);

        expect(workspace.source).toBe('demo');
        expect(workspace.masterLibrary).toBe('QSYS');
        expect(workspace.libraries.map((library) => library.name)).toEqual([
            'ORDERLIB', 'COMMONLIB', 'INVENTORY'
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

    it('does not silently drop a library from the configured action scope', async () => {
        await expect(service.getWorkspace({ libraries: ['ORDERLIB', 'MISSINGLIB'] }))
            .rejects.toThrow('MISSINGLIB');
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
