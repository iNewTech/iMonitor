import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeObjectAnalysisSettings, type ObjectAnalysisResult } from '../../features/object-analysis/model';
import { IbmiObjectAnalysisService } from '../../services/object-analysis-live';
import { createObjectAnalysisRuntime } from './object-analysis-runtime';

describe('object-analysis-runtime', () => {
    it('creates app storage and saves the first remote compile plan when the analysis directory is absent', async () => {
        const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'imonitor-remote-compile-'));
        const appStorageRoot = path.join(userDataRoot, 'object-analysis');
        try {
            await expect(stat(appStorageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
            const settings = normalizeObjectAnalysisSettings({
                source: 'ibmi', libraryList: ['APP'], sourceLibrary: 'APP'
            });
            const request = { library: 'APP', relativePath: 'APP/QSRC/THING.rpgle' };
            const root: ObjectAnalysisResult['root'] = {
                id: 'APP/THING|*PGM', name: 'THING', library: 'APP', type: '*PGM',
                sourcePath: 'QSRC/THING.rpgle', language: 'RPGLE', status: 'known', attributes: {}
            };
            const result: ObjectAnalysisResult = {
                source: 'live', root, nodes: [root], edges: [], directDependencies: 0, impactedObjects: 0,
                unresolvedReferences: [], sourceSignals: [], generatedAt: '2026-09-11T00:00:00.000Z',
                scope: { libraries: ['APP'], sourceLibrary: 'APP', depth: 2, maxNodes: 100 },
                readiness: { status: 'ready', label: 'Ready', score: 100, blockers: [], warnings: [], confirmed: [] }
            };
            const loadSource = vi.spyOn(IbmiObjectAnalysisService.prototype, 'getSourceContent')
                .mockResolvedValue('**free\nreturn;');
            const unused = vi.fn(async () => { throw new Error('Unexpected runtime dependency call'); });
            const runtime = createObjectAnalysisRuntime({
                getSettings: async () => settings,
                setSettings: unused,
                isDemoSession: () => false,
                isConnected: () => true,
                getCurrentService: () => ({ query: unused }),
                getAppPath: (name) => {
                    expect(name).toBe('userData');
                    return userDataRoot;
                },
                getCurrentOperatorName: () => 'operator',
                showOpenDialog: unused,
                showSaveDialog: unused,
                askAssistant: unused,
                recordActivity: unused
            });

            const response = await runtime.generateObjectAnalysisCompilePlan(request, result);

            expect(loadSource).toHaveBeenCalledExactlyOnceWith(request, settings);
            expect(response.success).toBe(true);
            expect((await stat(appStorageRoot)).isDirectory()).toBe(true);
            expect(response.compilePlan.artifact).toMatchObject({
                mode: 'app-storage', key: 'APP/THING',
                relativePath: 'imonitor-analysis/build/APP/THING.build.json',
                clPath: 'imonitor-analysis/build/APP/THING.cl'
            });
            const buildDirectory = path.join(appStorageRoot, 'imonitor-analysis', 'build', 'APP');
            const saved = JSON.parse(await readFile(path.join(buildDirectory, 'THING.build.json'), 'utf8'));
            expect(saved).toMatchObject({
                schema: 'imonitor-object-compile-plan', root: { library: 'APP', name: 'THING' }, libraryList: ['APP']
            });
            expect(await readFile(path.join(buildDirectory, 'THING.cl'), 'utf8'))
                .toContain('CRTBNDRPG PGM(APP/THING) SRCFILE(APP/QSRC) SRCMBR(THING)');
            expect(result.compilePlan).toBe(response.compilePlan);
            expect(unused).not.toHaveBeenCalled();
        } finally {
            vi.restoreAllMocks();
            await rm(userDataRoot, { recursive: true, force: true });
        }
    });
});
