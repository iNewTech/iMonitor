import { afterEach, describe, expect, it } from 'vitest';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildObjectAnalysisCompilePlan, persistObjectAnalysisCompilePlan } from './compile-plan';
import type { AnalysisObjectNode, AnalysisObjectType, DependencyEdge, ObjectAnalysisResult } from './model';

function node(name: string, type: AnalysisObjectType = '*PGM', extension = 'rpgle'): AnalysisObjectNode {
    return { id: name, name, type, library: 'APP', status: 'known', sourcePath: `QSRC/${name}.${extension}`, attributes: {} };
}

function edge(from: string, to: string, overrides: Partial<DependencyEdge> = {}): DependencyEdge {
    return { id: `${from}-${to}`, from, to, relationship: 'uses', confidence: 'confirmed', evidence: 'source', ...overrides };
}

function result(nodes: AnalysisObjectNode[], edges: DependencyEdge[] = []): ObjectAnalysisResult {
    return {
        source: 'live', root: nodes[0], nodes, edges, directDependencies: edges.length, impactedObjects: 0,
        unresolvedReferences: [], sourceSignals: [], generatedAt: '2026-09-11T00:00:00.000Z',
        scope: { libraries: ['APP', 'COMMON'], sourceLibrary: null, depth: 5, maxNodes: 100 },
        readiness: { status: 'ready', label: 'Ready', score: 100, blockers: [], warnings: [], confirmed: [] }
    };
}

function executableLines(commands: string) {
    return commands.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.trim()).filter(Boolean);
}

describe('compile plan command evidence', () => {
    it.each([
        ['*FILE', 'pf', 'CRTPF FILE'], ['*FILE', 'lf', 'CRTLF FILE'],
        ['*FILE', 'dspf', 'CRTDSPF FILE'], ['*FILE', 'prtf', 'CRTPRTF FILE'],
        ['*PGM', 'rpg', 'CRTRPGPGM PGM'], ['*PGM', 'rpgle', 'CRTBNDRPG PGM'],
        ['*PGM', 'cl', 'CRTCLPGM PGM'], ['*PGM', 'clle', 'CRTBNDCL PGM'],
        ['*PGM', 'c', 'CRTBNDC PGM'], ['*PGM', 'cpp', 'CRTBNDCPP PGM'],
        ['*PGM', 'cblle', 'CRTBNDCBL PGM'],
        ['*MODULE', 'rpgle', 'CRTRPGMOD MODULE'], ['*MODULE', 'clle', 'CRTCLMOD MODULE'],
        ['*MODULE', 'c', 'CRTCMOD MODULE'], ['*MODULE', 'cpp', 'CRTCPPMOD MODULE'],
        ['*MODULE', 'cblle', 'CRTCBLMOD MODULE']
    ] as const)('selects %s / %s from explicit source type', (type, extension, command) => {
        const plan = buildObjectAnalysisCompilePlan(result([node('THING', type, extension)]));
        expect(plan.steps[0].status).toBe('ready');
        expect(executableLines(plan.clCommands)).toEqual([`${command}(APP/THING) SRCFILE(APP/QSRC) SRCMBR(THING)`]);
    });

    it.each(['*PGM', '*MODULE'] as const)('keeps the SQL RPG precompiler and explicit %s target', (type) => {
        const plan = buildObjectAnalysisCompilePlan(result([node('THING', type, 'sqlrpgle')]));
        expect(plan.steps[0]).toMatchObject({ status: 'ready', command: `CRTSQLRPGI OBJ(APP/THING) SRCFILE(APP/QSRC) SRCMBR(THING) OBJTYPE(${type})` });
    });

    it.each([
        ['*FILE', 'dds'], ['*FILE', 'file'], ['*FILE', 'sql'], ['*FILE', 'ddl'], ['*FILE', 'table'],
        ['*PGM', 'txt'], ['*PGM', 'cbl'], ['*PGM', 'cobol'], ['*PGM', 'unknown'],
        ['*MODULE', 'rpg'], ['*MODULE', 'cl'], ['*MODULE', 'txt'],
        ['*SRVPGM', 'rpgle'], ['*COPY', 'rpgle'], ['*DTAARA', 'txt'], ['*UNKNOWN', 'rpgle']
    ] as const)('leaves unsupported or ambiguous %s / %s as comments', (type, extension) => {
        const input = node('THING', type, extension);
        input.language = 'RPGLE'; // A broad language hint must not override the source type.
        const plan = buildObjectAnalysisCompilePlan(result([input]));
        expect(plan.steps[0].status).toBe('review');
        expect(plan.reviewItems.length).toBeGreaterThan(0);
        expect(executableLines(plan.steps[0].command)).toEqual([]);
        expect(executableLines(plan.clCommands)).toEqual([]);
        expect(plan.clCommands).not.toContain('EXPORT(*ALL)');
    });

    it('requires binder evidence even with module and export counts or a bind edge', () => {
        const service = node('SERVICE', '*SRVPGM');
        service.attributes = { modules: 1, exports: 5 };
        const plan = buildObjectAnalysisCompilePlan(result([service, node('SERVICE1', '*MODULE')], [edge('SERVICE', 'SERVICE1', { relationship: 'binds' })]));
        expect(plan.steps.find((step) => step.object.name === 'SERVICE')?.status).toBe('review');
        expect(plan.clCommands).not.toContain('CRTSRVPGM');
    });

    it('uses explicit source type metadata for generic DDS and refuses conflicts', () => {
        const file = node('THING', '*FILE', 'dds');
        file.attributes.sourceType = 'LF';
        expect(buildObjectAnalysisCompilePlan(result([file])).steps[0].command).toMatch(/^CRTLF /);
        file.sourcePath = 'QSRC/THING.pf';
        const step = buildObjectAnalysisCompilePlan(result([file])).steps[0];
        expect(step.status).toBe('review');
        expect(step.reason).toMatch(/Conflicting source type/);
    });

    it.each(['SOURCE/QSRC/INPUT.rpgle', 'userlib/SOURCE/QSRC/INPUT.rpgle', 'libraries/SOURCE/QSRC/INPUT.rpgle'])('preserves separate source and target libraries: %s', (sourcePath) => {
        const input = { ...node('THING'), sourcePath };
        const plan = buildObjectAnalysisCompilePlan(result([input]));
        expect(plan.steps[0].command).toBe('CRTBNDRPG PGM(APP/THING) SRCFILE(SOURCE/QSRC) SRCMBR(INPUT)');
    });

    it('supports explicit source-library mapping for library-relative exports', () => {
        const input = node('THING');
        input.attributes = { sourceLibrary: 'SOURCE', sourceFile: 'QSRC', sourceMember: 'THING' };
        expect(buildObjectAnalysisCompilePlan(result([input])).steps[0].command).toContain('SRCFILE(SOURCE/QSRC)');
    });

    it.each(['sourceFile', 'sourceMember', 'sourceLibrary'])('refuses conflicting %s metadata', (field) => {
        const input = { ...node('THING'), sourcePath: 'SOURCE/QSRC/THING.rpgle', attributes: { [field]: 'OTHER' } };
        const plan = buildObjectAnalysisCompilePlan(result([input]));
        expect(plan.steps[0].status).toBe('review');
        expect(executableLines(plan.clCommands)).toEqual([]);
    });

    it.each([undefined, 'THING.rpgle', '../QSRC/THING.rpgle', '/APP/QSRC/THING.rpgle', 'APP//QSRC/THING.rpgle', 'APP/../QSRC/THING.rpgle', 'QSRC\\THING.rpgle', 'QSRC/TOOLONGNAME.rpgle'])('refuses missing or unsafe source paths: %s', (sourcePath) => {
        const plan = buildObjectAnalysisCompilePlan(result([{ ...node('THING'), sourcePath }]));
        expect(plan.steps[0].status).toBe('review');
        expect(executableLines(plan.clCommands)).toEqual([]);
    });

    it.each(['unresolved', 'not-observed'] as const)('retains %s nodes as review steps', (status) => {
        const plan = buildObjectAnalysisCompilePlan(result([{ ...node('THING'), status }]));
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].status).toBe('review');
    });
});

describe('compile plan dependency ordering and blocking', () => {
    it('orders prerequisites first even across phase order, deduplicates edges, and is deterministic', () => {
        const nodes = [node('PARENT', '*FILE', 'lf'), node('MIDDLE'), node('BASE', '*FILE', 'pf'), node('OTHER')];
        const edges = [edge('PARENT', 'MIDDLE'), edge('MIDDLE', 'BASE'), edge('MIDDLE', 'BASE')];
        const plan = buildObjectAnalysisCompilePlan(result(nodes, edges));
        const names = plan.steps.map((step) => step.object.name);
        expect(names).toEqual(['BASE', 'MIDDLE', 'PARENT', 'OTHER']);
        expect(plan.steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4]);
        expect(buildObjectAnalysisCompilePlan({ ...result(nodes, edges), nodes: [...nodes].reverse(), edges: [...edges].reverse() }).steps).toEqual(plan.steps);
    });

    it('turns cycles and all downstream dependents into comments while retaining independent commands', () => {
        const nodes = ['TOP', 'NEXT', 'A', 'B', 'INDEP'].map((name) => node(name));
        const plan = buildObjectAnalysisCompilePlan(result(nodes, [edge('TOP', 'NEXT'), edge('NEXT', 'A'), edge('A', 'B'), edge('B', 'A')]));
        expect(plan.steps.filter((step) => step.status === 'ready').map((step) => step.object.name)).toEqual(['INDEP']);
        for (const step of plan.steps.filter((step) => step.status === 'review')) {
            expect(step.reason).toMatch(/cycle/);
            expect(executableLines(step.command)).toEqual([]);
        }
        expect(executableLines(plan.clCommands)).toHaveLength(1);
    });

    it.each(['binds', 'unknown'] as const)('retains cycle diagnostics for %s relationships', (relationship) => {
        const plan = buildObjectAnalysisCompilePlan(result([node('A'), node('B')], [
            edge('A', 'B', { relationship, confidence: 'possible' }), edge('B', 'A')
        ]));
        expect(plan.steps.every((step) => step.status === 'review' && step.reason.includes('cycle'))).toBe(true);
        expect(executableLines(plan.clCommands)).toEqual([]);
    });

    it('does not silently order self-dependencies', () => {
        const plan = buildObjectAnalysisCompilePlan(result([node('SELF')], [edge('SELF', 'SELF')]));
        expect(plan.steps[0].reason).toMatch(/cycle/);
        expect(executableLines(plan.clCommands)).toEqual([]);
    });

    it.each(['missing-source', 'unresolved', 'unsupported', 'missing-node'] as const)('blocks transitive dependents of a %s prerequisite', (problem) => {
        const prerequisite = node('BASE', problem === 'unsupported' ? '*DTAQ' : '*FILE', 'pf');
        if (problem === 'missing-source') delete prerequisite.sourcePath;
        if (problem === 'unresolved') prerequisite.status = 'unresolved';
        const nodes = [node('TOP'), node('MID'), ...(problem === 'missing-node' ? [] : [prerequisite])];
        const plan = buildObjectAnalysisCompilePlan(result(nodes, [edge('TOP', 'MID'), edge('MID', 'BASE')]));
        expect(plan.steps.every((step) => step.status === 'review')).toBe(true);
        expect(plan.steps.find((step) => step.object.name === 'TOP')?.reason).toMatch(/Blocked by prerequisite/);
        expect(executableLines(plan.clCommands)).toEqual([]);
    });

    it('requires review for uncertain evidence and its dependents', () => {
        const plan = buildObjectAnalysisCompilePlan(result([node('TOP'), node('MID'), node('BASE')], [edge('TOP', 'MID'), edge('MID', 'BASE', { confidence: 'possible', evidence: 'inferred' })]));
        expect(plan.steps.filter((step) => step.status === 'ready').map((step) => step.object.name)).toEqual(['BASE']);
    });

    it('does not approve plans with unattributed unresolved references', () => {
        const input = result([node('THING')]);
        input.unresolvedReferences = ['COMMON/MISSING'];
        const plan = buildObjectAnalysisCompilePlan(input);
        expect(executableLines(plan.clCommands)).toEqual([]);
        expect(plan.reviewItems.join(' ')).toContain('COMMON/MISSING');
    });

    it('retains a root absent from the nodes array and flags duplicate identities', () => {
        const input = result([node('ROOT')]);
        input.nodes = [];
        expect(buildObjectAnalysisCompilePlan(input).steps[0].object.name).toBe('ROOT');
        input.nodes = [input.root, { ...input.root, sourcePath: undefined }];
        expect(buildObjectAnalysisCompilePlan(input).steps[0].reason).toMatch(/Duplicate/);
    });
});

describe('compile plan artifact safety', () => {
    const directories: string[] = [];
    async function temporaryDirectory() {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'imonitor-compile-plan-'));
        directories.push(directory);
        return directory;
    }
    afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

    it.each(['..', '../ESCAPE', 'A/B', 'A\\B', '1BAD', '_BAD', 'TOOLONGNAME', 'A) DLTLIB', 'A\nB', 'THING\n', 'THING\r', 'THING\u2028'])('rejects invalid names without changing them into other targets: %s', async (name) => {
        const directory = await temporaryDirectory();
        const input = result([{ ...node('THING'), name }]);
        const plan = await persistObjectAnalysisCompilePlan(directory, input);
        expect(plan.artifact?.mode).toBe('error');
        expect(plan.steps[0].status).toBe('review');
        expect(await readdir(directory)).toEqual([]);
    });

    it('rejects root-library traversal before creating directories', async () => {
        const directory = await temporaryDirectory();
        const plan = await persistObjectAnalysisCompilePlan(directory, result([{ ...node('THING'), library: '..' }]));
        expect(plan.artifact?.mode).toBe('error');
        expect(await readdir(directory)).toEqual([]);
    });

    it('neutralizes comment terminators, newlines and library-list injection in saved JSON commands and CL', async () => {
        const directory = await temporaryDirectory();
        const input = result([node('THING'), { ...node('BAD'), name: '*/\nDLTLIB LIB(X)\n/*', type: '*UNKNOWN' }]);
        input.scope.libraries = ['APP)\nDLTLIB LIB(X)'];
        input.unresolvedReferences = ['*/\r\nDLTLIB LIB(X)\n/*'];
        const plan = await persistObjectAnalysisCompilePlan(directory, input);
        expect(executableLines(plan.clCommands)).toEqual([]);
        expect(plan.clCommands).not.toContain('\nDLTLIB');
        const json = JSON.parse(await readFile(path.join(directory, plan.artifact!.relativePath!), 'utf8'));
        expect(executableLines(json.clCommands)).toEqual([]);
        expect(await readFile(path.join(directory, plan.artifact!.clPath!), 'utf8')).toBe(plan.clCommands);
    });

    it.each([{ libraries: [] }, { libraries: ['APP', '*LIBL'] }, { libraries: ['APP', '1INVALID'] }])('keeps an invalid or absent library list review-only: $libraries', ({ libraries }) => {
        const input = result([node('THING')]);
        input.scope.libraries = libraries;
        expect(executableLines(buildObjectAnalysisCompilePlan(input).clCommands)).toEqual([]);
    });

    it.each(['source-directory', 'app-storage'] as const)('saves and updates JSON and CL with the existing public shape in %s mode', async (mode) => {
        const directory = await temporaryDirectory();
        const input = result([node('THING', '*FILE', 'lf')]);
        const first = await persistObjectAnalysisCompilePlan(directory, input, mode);
        expect(first.artifact).toMatchObject({ mode, key: 'APP/THING', relativePath: path.join('imonitor-analysis', 'build', 'APP', 'THING.build.json'), clPath: path.join('imonitor-analysis', 'build', 'APP', 'THING.cl') });
        expect(JSON.parse(await readFile(path.join(directory, first.artifact!.relativePath!), 'utf8'))).toEqual(first);
        input.nodes[0].sourcePath = undefined;
        const second = await persistObjectAnalysisCompilePlan(directory, input, mode);
        expect(second.artifact?.mode).toBe(mode);
        expect(await readFile(path.join(directory, second.artifact!.clPath!), 'utf8')).toBe(second.clCommands);
        expect(executableLines(second.clCommands)).toEqual([]);
    });

    it.each(['imonitor-analysis', 'imonitor-analysis/build', 'imonitor-analysis/build/APP'])('rejects directory symlinks at %s without writing outside the root', async (relative) => {
        const directory = await temporaryDirectory();
        const outside = await temporaryDirectory();
        const destination = path.join(directory, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await symlink(outside, destination, 'dir');
        const plan = await persistObjectAnalysisCompilePlan(directory, result([node('THING')]));
        expect(plan.artifact?.mode).toBe('error');
        expect(await readdir(outside)).toEqual([]);
        expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    });

    it.each(['THING.build.json', 'THING.cl'])('rejects file symlinks at %s without overwriting their targets', async (file) => {
        const directory = await temporaryDirectory();
        const outside = await temporaryDirectory();
        const target = path.join(outside, 'keep');
        await writeFile(target, 'unchanged');
        const programDirectory = path.join(directory, 'imonitor-analysis', 'build', 'APP');
        await mkdir(programDirectory, { recursive: true });
        await symlink(target, path.join(programDirectory, file));
        const plan = await persistObjectAnalysisCompilePlan(directory, result([node('THING')]));
        expect(plan.artifact?.mode).toBe('error');
        expect(await readFile(target, 'utf8')).toBe('unchanged');
    });

    it('rejects hard-linked destinations before truncating outside files', async () => {
        const directory = await temporaryDirectory();
        const target = path.join(directory, 'keep');
        await writeFile(target, 'unchanged');
        const programDirectory = path.join(directory, 'imonitor-analysis', 'build', 'APP');
        await mkdir(programDirectory, { recursive: true });
        await link(target, path.join(programDirectory, 'THING.build.json'));
        const plan = await persistObjectAnalysisCompilePlan(directory, result([node('THING')]));
        expect(plan.artifact?.mode).toBe('error');
        expect(await readFile(target, 'utf8')).toBe('unchanged');
    });

    it('returns the generated reviewable plan when storage is unavailable', async () => {
        const directory = await temporaryDirectory();
        const file = path.join(directory, 'file');
        await writeFile(file, 'unchanged');
        const plan = await persistObjectAnalysisCompilePlan(file, result([node('THING')]));
        expect(plan.artifact).toMatchObject({ mode: 'error', key: 'APP/THING' });
        expect(plan.steps).toHaveLength(1);
        expect(await readFile(file, 'utf8')).toBe('unchanged');
    });
});
