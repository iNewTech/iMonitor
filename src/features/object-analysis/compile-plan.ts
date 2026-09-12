import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type {
    AnalysisObjectNode,
    AnalysisObjectType,
    DependencyEdge,
    ObjectAnalysisCompilePlan,
    ObjectAnalysisCompilePlanArtifact,
    ObjectAnalysisCompilePlanStep,
    ObjectAnalysisResult
} from './model';

// Deliberately support only unquoted IBM i object names (at most ten characters).
// https://www.ibm.com/docs/en/i/7.4.0?topic=elements-naming-within-commands
function objectName(value: unknown): string | undefined {
    return typeof value === 'string' && value === value.trim() && /^[A-Z$#@][A-Z0-9_$#@.]{0,9}$/i.test(value)
        ? value.toUpperCase() : undefined;
}

function comment(value: string) {
    return `/* ${value.replace(/\/\*|\*\//g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, ' ')} */`;
}

function sourceParts(node: AnalysisObjectNode) {
    if (!node.sourcePath) throw new Error('Missing source path; confirm the source member before compiling.');
    const parts = node.sourcePath.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) {
        throw new Error('Invalid source path; no source location inferred.');
    }
    // Local exports are relative to a library; workspace/live paths carry the library.
    if (parts.length === 4 && ['userlib', 'libraries'].includes(parts[0])) parts.shift();
    if (parts.length !== 2 && parts.length !== 3) {
        throw new Error('Unsupported source layout; supply a library/source-file/member mapping.');
    }
    const fileName = parts[parts.length - 1];
    const dot = fileName.lastIndexOf('.');
    const member = dot > 0 ? fileName.slice(0, dot) : fileName;
    const library = parts.length === 3 ? parts[0] : node.attributes.sourceLibrary ?? node.library;
    const sourceFile = parts[parts.length - 2];
    for (const [label, value, explicit] of [
        ['source library', library, node.attributes.sourceLibrary],
        ['source file', sourceFile, node.attributes.sourceFile],
        ['source member', member, node.attributes.sourceMember]
    ] as const) {
        if (!objectName(value) || (explicit != null && objectName(explicit) !== objectName(value))) {
            throw new Error(`Invalid or conflicting ${label} evidence.`);
        }
    }
    return {
        library: objectName(library)!, sourceFile: objectName(sourceFile)!, member: objectName(member)!,
        extension: dot > 0 ? fileName.slice(dot + 1).toUpperCase() : ''
    };
}

// Exact source types only: broad language labels cannot distinguish OPM from ILE.
// IBM command references:
// https://www.ibm.com/docs/en/i/7.4.0?topic=ssw_ibm_i_74%2Fcl%2Fcrtlf.html
// https://www.ibm.com/docs/en/i/7.5.0?topic=procedures-cl-program
// https://www.ibm.com/docs/en/i/7.5.0?topic=c-create-sql-ile-rpg-object
// https://www.ibm.com/docs/en/i/7.5.0?topic=iccr-control-language-commands
const fileCommands: Record<string, string> = { PF: 'CRTPF', LF: 'CRTLF', DSPF: 'CRTDSPF', PRTF: 'CRTPRTF' };
const programCommands: Record<string, string> = {
    RPG: 'CRTRPGPGM', RPGLE: 'CRTBNDRPG', CL: 'CRTCLPGM', CLLE: 'CRTBNDCL',
    C: 'CRTBNDC', CPP: 'CRTBNDCPP', CBLLE: 'CRTBNDCBL'
};
const moduleCommands: Record<string, string> = {
    RPGLE: 'CRTRPGMOD', CLLE: 'CRTCLMOD', C: 'CRTCMOD', CPP: 'CRTCPPMOD', CBLLE: 'CRTCBLMOD'
};

function compileCommandFor(node: AnalysisObjectNode) {
    if (!objectName(node.library) || !objectName(node.name)) throw new Error('Invalid object or library name.');
    if (node.status !== 'known') throw new Error('Object is unresolved or not observed; confirm its existence and source.');
    if (node.type === '*SRVPGM') {
        // Module counts/names alone do not establish the binder's public interface.
        // https://www.ibm.com/docs/en/i/7.5.0?topic=access-export-parameter-crtsrvpgm-command
        throw new Error('Service program requires verified modules, binding options and binder export/signature source.');
    }
    if (!['*FILE', '*MODULE', '*PGM'].includes(node.type)) throw new Error(`Unsupported object type ${node.type}.`);
    const source = sourceParts(node);
    const explicitType = node.attributes.sourceType;
    const sourceType = explicitType == null ? source.extension : String(explicitType).toUpperCase();
    if (explicitType != null && source.extension && !['TXT', 'DDS', 'FILE'].includes(source.extension)
        && sourceType !== source.extension) {
        throw new Error('Conflicting source type and extension; confirm the compiler.');
    }
    const object = `${objectName(node.library)}/${objectName(node.name)}`;
    const input = `SRCFILE(${source.library}/${source.sourceFile}) SRCMBR(${source.member})`;
    if (node.type === '*FILE') {
        if (['SQL', 'DDL', 'TABLE'].includes(sourceType)) {
            throw new Error('SQL script requires review of statements, target schema and commitment control; no RUNSQLSTM inferred.');
        }
        const command = Object.prototype.hasOwnProperty.call(fileCommands, sourceType) ? fileCommands[sourceType] : undefined;
        if (!command) throw new Error('Missing or unsupported file subtype; generic DDS does not establish PF, LF, DSPF or PRTF.');
        return `${command} FILE(${object}) ${input}`;
    }
    if (sourceType === 'SQLRPGLE') return `CRTSQLRPGI OBJ(${object}) ${input} OBJTYPE(${node.type})`;
    const commands = node.type === '*MODULE' ? moduleCommands : programCommands;
    const command = Object.prototype.hasOwnProperty.call(commands, sourceType) ? commands[sourceType] : undefined;
    if (!command) throw new Error(`Unsupported or ambiguous source type ${sourceType || '(missing)'} for ${node.type}; confirm the compiler.`);
    return `${command} ${node.type === '*MODULE' ? 'MODULE' : 'PGM'}(${object}) ${input}`;
}

function compilePhase(type: AnalysisObjectType) {
    if (type === '*FILE') return { phase: 'Data objects', order: 10 };
    if (type === '*MODULE') return { phase: 'Modules', order: 20 };
    if (type === '*SRVPGM') return { phase: 'Service programs', order: 30 };
    if (type === '*PGM') return { phase: 'Programs', order: 40 };
    return { phase: 'Review only', order: 90 };
}

function topoSort(nodes: AnalysisObjectNode[], edges: DependencyEdge[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const inbound = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]));
    edges.forEach((edge) => {
        if (!byId.has(edge.from) || !byId.has(edge.to)) return;
        // If A depends on B, B precedes A. Retain unsupported/unresolved prerequisites.
        inbound.get(edge.from)!.add(edge.to);
        outgoing.get(edge.to)!.add(edge.from);
    });
    const compare = (left: string, right: string) => compilePhase(byId.get(left)!.type).order
        - compilePhase(byId.get(right)!.type).order || left.localeCompare(right);
    const ready = Array.from(byId.keys()).filter((id) => !inbound.get(id)!.size).sort(compare);
    const ordered: string[] = [];
    while (ready.length) {
        const id = ready.shift()!;
        ordered.push(id);
        outgoing.get(id)!.forEach((dependent) => {
            inbound.get(dependent)!.delete(id);
            if (!inbound.get(dependent)!.size) ready.push(dependent);
        });
        ready.sort(compare);
    }
    // Kahn's remainder includes cycles AND every dependent blocked by those cycles.
    const blocked = new Set(Array.from(byId.keys()).filter((id) => inbound.get(id)!.size));
    return { ordered: [...ordered, ...Array.from(blocked).sort(compare)].map((id) => byId.get(id)!), blocked };
}

function buildCl(plan: ObjectAnalysisCompilePlan) {
    const lines = [
        comment('iMonitor compile plan. Generated only; nothing is executed. Review compiler defaults and environment before use.'),
        comment(`Root object: ${plan.root.library}/${plan.root.name}`),
        comment(`Generated: ${plan.generatedAt}`),
        // The library list is context, not a generated change to the operator's job.
        comment(`Library list: ${plan.libraryList.join(' ') || '(missing)'}`),
        ''
    ];
    plan.steps.forEach((step) => {
        lines.push(comment(`${step.sequence}. ${step.phase}: ${step.object.library}/${step.object.name} ${step.object.type}`));
        lines.push(comment(step.reason), step.command, '');
    });
    if (plan.reviewItems.length) {
        lines.push(comment('Manual review items'));
        plan.reviewItems.forEach((item) => lines.push(comment(item)));
    }
    return `${lines.join('\n')}\n`;
}

export function buildObjectAnalysisCompilePlan(result: ObjectAnalysisResult): ObjectAnalysisCompilePlan {
    const nodes = result.nodes.some((node) => node.id === result.root.id) ? result.nodes : [result.root, ...result.nodes];
    const { ordered, blocked } = topoSort(nodes, result.edges);
    const reasons = new Map<string, string>();
    const commands = new Map<string, string>();
    const reviewItems = result.unresolvedReferences.map((reference) => `Resolve missing reference before compiling: ${reference}`);
    const libraries = result.scope?.libraries || [];
    const invalidScope = !libraries.length || libraries.some((library) => !objectName(library));
    const seen = new Set<string>();
    nodes.forEach((node) => {
        try { commands.set(node.id, compileCommandFor(node)); }
        catch (error) { reasons.set(node.id, (error as Error).message); }
        if (invalidScope) reasons.set(node.id, 'Missing or invalid library list; confirm the compile environment.');
        if (result.unresolvedReferences.length) reasons.set(node.id, 'Unresolved references have no complete prerequisite mapping; resolve them before compiling.');
        if (seen.has(node.id)) reasons.set(node.id, 'Duplicate object identity; reconcile the analysis before compiling.');
        seen.add(node.id);
    });
    result.edges.forEach((edge) => {
        if (!seen.has(edge.from)) {
            reviewItems.push(`Dependency has a missing origin: ${edge.from}.`);
            return;
        }
        if (!seen.has(edge.to)) reasons.set(edge.from, `Missing dependency node: ${edge.to}.`);
        else if (edge.confidence !== 'confirmed' || ['inferred', 'demo-fixture'].includes(edge.evidence)
            || ['unknown', 'references'].includes(edge.relationship)) {
            reasons.set(edge.from, `Unverified dependency on ${edge.to}; confirm the relationship before compiling.`);
        }
        if (edge.relationship === 'binds') reasons.set(edge.from, 'Binding dependency requires verified module/service-program lists and binding options.');
    });
    blocked.forEach((id) => reasons.set(id, 'Dependency cycle or blocked by a dependency cycle; no safe compile order.'));
    // Propagate every review requirement, including missing sources and unsupported objects.
    let changed = true;
    while (changed) {
        changed = false;
        result.edges.forEach((edge) => {
            if (seen.has(edge.from) && reasons.has(edge.to) && !reasons.has(edge.from)) {
                reasons.set(edge.from, `Blocked by prerequisite ${edge.to}: ${reasons.get(edge.to)}`);
                changed = true;
            }
        });
    }
    const steps: ObjectAnalysisCompilePlanStep[] = ordered.map((node, index) => {
        const review = reasons.get(node.id);
        if (review) reviewItems.push(`${node.library}/${node.name} ${node.type}: ${review}`);
        return {
            id: `compile-${index + 1}-${node.id}`, sequence: index + 1,
            phase: compilePhase(node.type).phase,
            object: { library: node.library, name: node.name, type: node.type, sourcePath: node.sourcePath, language: node.language },
            command: review ? comment(`Review only: ${review}`) : commands.get(node.id)!,
            reason: review || 'Command selected from source type and member location; review compiler defaults, options and target environment.',
            status: review ? 'review' : 'ready'
        };
    });
    const plan: ObjectAnalysisCompilePlan = {
        schema: 'imonitor-object-compile-plan', version: 1, generatedAt: new Date().toISOString(),
        root: { library: result.root.library, name: result.root.name, type: result.root.type, sourcePath: result.root.sourcePath, language: result.root.language },
        libraryList: libraries.map((library) => objectName(library) || library),
        steps, reviewItems, clCommands: '', artifact: undefined
    };
    plan.clCommands = buildCl(plan);
    return plan;
}

// Do not follow artifact symlinks or truncate a hard-linked file outside storage.
async function writeArtifact(file: string, content: string) {
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Artifact destination must be a regular, unlinked file.');
        await handle.truncate(0);
        await handle.writeFile(content, 'utf8');
    } finally { await handle.close(); }
}

export async function persistObjectAnalysisCompilePlan(
    rootDirectory: string,
    result: ObjectAnalysisResult,
    mode: ObjectAnalysisCompilePlanArtifact['mode'] = 'source-directory'
): Promise<ObjectAnalysisCompilePlan> {
    const plan = buildObjectAnalysisCompilePlan(result);
    const library = objectName(result.root.library);
    const member = objectName(result.root.name);
    const key = library && member ? `${library}/${member}` : 'INVALID';
    try {
        if (!library || !member) throw new Error('Invalid root library or object name; compile plan was not saved.');
        const root = await realpath(rootDirectory);
        let directory = root;
        for (const component of ['imonitor-analysis', 'build', library]) {
            directory = path.join(directory, component);
            try { await mkdir(directory); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            const stat = await lstat(directory);
            if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Artifact directory must be a real directory, not a symbolic link.');
        }
        const jsonFile = path.join(directory, `${member}.build.json`);
        const clFile = path.join(directory, `${member}.cl`);
        const relativeJson = path.relative(root, jsonFile);
        const relativeCl = path.relative(root, clFile);
        plan.artifact = {
            key, mode, relativePath: relativeJson, clPath: relativeCl,
            message: mode === 'source-directory'
                ? `Compile plan saved with the source directory at ${relativeJson}.`
                : `Compile plan saved in local app storage at ${relativeJson}.`
        };
        await writeArtifact(jsonFile, `${JSON.stringify(plan, null, 2)}\n`);
        await writeArtifact(clFile, plan.clCommands);
    } catch (error) {
        plan.artifact = {
            key, mode: 'error', message: 'Compile plan was generated, but could not be saved automatically.',
            error: error instanceof Error ? error.message : String(error)
        };
    }
    return plan;
}
