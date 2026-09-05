import type { ObjectAnalysisProvider } from './object-analysis';
import {
    normalizeObjectAnalysisSettings,
    objectId,
    type AnalysisFileNode,
    type AnalysisObjectNode,
    type AnalysisObjectType,
    type AnalyzeObjectRequest,
    type DependencyEdge,
    type ObjectAnalysisResult,
    type ObjectAnalysisSettings,
    type ObjectAnalysisWorkspace
} from '../features/object-analysis/model';

/*
 * The live provider deliberately reads IBM i metadata and source members on
 * demand. It does not copy the connected system into the local demo tree.
 */
export interface IbmiObjectAnalysisClient {
    query<T>(statement: string, bindingsValues?: (number | string)[]): Promise<T>;
    executeClCommand?: (command: string) => Promise<unknown>;
}

interface QueryResult<T> {
    data?: T[];
}

interface LiveObjectDefinition {
    name: string;
    library: string;
    type: AnalysisObjectType;
    description?: string;
    attributes: Record<string, string | number | boolean | null>;
}

interface LiveSourceMember {
    library: string;
    sourceFile: string;
    member: string;
    sourceType: string;
    relativePath: string;
}

interface CollectedCommandEvidence {
    name: string;
    command: string;
    status: 'collected' | 'not-supported' | 'failed';
    rowCount: number;
    detail?: string;
}

function normalizeName(value: unknown) {
    return String(value || '').trim().toUpperCase();
}

function normalizeType(value: unknown): AnalysisObjectType {
    const type = normalizeName(value) as AnalysisObjectType;
    const known: AnalysisObjectType[] = [
        '*PGM', '*SRVPGM', '*MODULE', '*FILE', '*DTAQ', '*DTAARA', '*ENVVAR',
        '*JOBD', '*JOBQ', '*SBS', '*CMD', '*COPY', '*UNKNOWN'
    ];
    return known.includes(type) ? type : '*UNKNOWN';
}

function rowValue(row: Record<string, unknown>, name: string) {
    const key = Object.keys(row).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
    return key ? row[key] : undefined;
}

function rowsFrom<T>(result: QueryResult<T> | T[] | undefined) {
    if (Array.isArray(result)) {
        return result;
    }
    return Array.isArray(result?.data) ? result.data : [];
}

function quoteIdentifier(value: string) {
    const normalized = normalizeName(value);
    if (!/^[A-Z0-9_$#@]+$/.test(normalized)) {
        throw new Error(`Invalid IBM i identifier: ${value}`);
    }
    return `"${normalized.replace(/"/g, '""')}"`;
}

function sourceExtension(sourceType: string) {
    const normalized = sourceType.toUpperCase();
    if (normalized.includes('SQLRPGLE')) return 'sqlrpgle';
    if (normalized.includes('RPGLE')) return 'rpgle';
    if (normalized === 'RPG') return 'rpg';
    if (normalized.includes('CL')) return 'clle';
    if (normalized.includes('COBOL')) return 'cobol';
    if (normalized.includes('DSPF')) return 'dspf';
    if (normalized.includes('DDS')) return 'dds';
    if (normalized.includes('PF')) return 'pf';
    if (normalized.includes('LF')) return 'lf';
    if (normalized === 'SQL' || normalized === 'DDL') return 'sql';
    return 'txt';
}

function sourceKind(sourceType: string): AnalysisFileNode['kind'] {
    const normalized = sourceType.toUpperCase();
    return normalized.includes('SQLRPGLE') || normalized.includes('RPGLE')
        ? 'source'
        : /DDS|DSPF|PF|LF|SQL|DDL/.test(normalized) ? 'database' : 'source';
}

function createNode(
    name: string,
    library: string,
    type: AnalysisObjectType,
    status: AnalysisObjectNode['status'],
    details: Partial<LiveObjectDefinition> = {}
): AnalysisObjectNode {
    return {
        id: objectId(library, name, type),
        name: normalizeName(name),
        library: normalizeName(library),
        type,
        description: details.description,
        status,
        attributes: details.attributes || {}
    };
}

function addEdge(edges: Map<string, DependencyEdge>, from: AnalysisObjectNode, to: AnalysisObjectNode, input: Omit<DependencyEdge, 'id' | 'from' | 'to'>) {
    const id = `${from.id}->${to.id}|${input.relationship}|${input.line || 0}`;
    if (!edges.has(id)) {
        edges.set(id, { id, from: from.id, to: to.id, ...input });
    }
}

function makeSourcePath(member: LiveSourceMember) {
    return `libraries/${member.library}/${member.sourceFile}/${member.member}.${sourceExtension(member.sourceType)}`;
}

function parseMemberPath(relativePath: string) {
    const parts = relativePath.split('/').filter(Boolean);
    const sourcePfIndex = parts.findIndex((part) => part.toLowerCase() === 'source-pf');
    const libraryIndex = sourcePfIndex >= 0
        ? sourcePfIndex
        : parts.findIndex((part) => part.toLowerCase() === 'libraries') + 1;
    const sourceFileIndex = sourcePfIndex >= 0 ? sourcePfIndex + 1 : libraryIndex + 1;
    if (sourceFileIndex < 0 || parts.length < sourceFileIndex + 2) {
        return null;
    }
    const memberFile = parts[parts.length - 1];
    const sourceFile = parts[parts.length - 2];
    const member = memberFile.replace(/\.[^.]+$/, '');
    return { sourceFile, member };
}

function sourceTextFromRow(row: Record<string, unknown>) {
    const value = rowValue(row, 'SRCDTA')
        ?? rowValue(row, 'SOURCE_DATA')
        ?? rowValue(row, 'SOURCE_TEXT')
        ?? rowValue(row, 'TEXT');
    return value === null || value === undefined ? '' : String(value);
}

function objectTypeFromProgramReference(row: Record<string, unknown>): AnalysisObjectType {
    const explicitType = normalizeType(rowValue(row, 'WHOTYP'));
    if (explicitType !== '*UNKNOWN') return explicitType;
    const objectCode = normalizeName(rowValue(row, 'WHOBJT'));
    if (objectCode === 'P') return '*PGM';
    if (objectCode === 'D') return '*DTAARA';
    if (objectCode === 'F') return '*FILE';
    return '*UNKNOWN';
}

function fileRelationshipFromUsage(value: unknown) {
    const usage = Number(value);
    if (!Number.isFinite(usage) || usage === 0 || usage === 8) return 'uses' as const;
    if ((usage & 1) === 1 && (usage & 6) === 0) return 'reads' as const;
    return 'writes' as const;
}

function commandValue(row: Record<string, unknown>, ...names: string[]) {
    for (const name of names) {
        const value = rowValue(row, name);
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
}

/** Loads one configured IBM i library list and analyzes members on demand. */
export class IbmiObjectAnalysisService implements ObjectAnalysisProvider {
    constructor(private readonly client: IbmiObjectAnalysisClient) {}

    /** Reads the active IBM i library-list order without loading source members. */
    async getEnvironmentLibraryList() {
        let result: QueryResult<Record<string, unknown>> | Record<string, unknown>[];
        try {
            result = await this.client.query<QueryResult<Record<string, unknown>>>(`
                SELECT *
                FROM QSYS2.SYSLIBL
                ORDER BY ORDINAL_POSITION
            `);
        } catch (error) {
            // Older IBM i releases expose the same information through the
            // library-list service instead of the SYSLIBL view.
            result = await this.client.query<QueryResult<Record<string, unknown>>>(`
                SELECT *
                FROM TABLE(QSYS2.LIBRARY_LIST_INFO())
                ORDER BY ORDINAL_POSITION
            `);
            if (!result) {
                throw error;
            }
        }

        return Array.from(new Set(rowsFrom(result)
            .map((row) => normalizeName(
                rowValue(row, 'SYSTEM_SCHEMA_NAME')
                ?? rowValue(row, 'LIBRARY_NAME')
                ?? rowValue(row, 'SYSTEM_LIBRARY_NAME')
                ?? rowValue(row, 'SCHEMA_NAME')
            ))
            .filter(Boolean)));
    }

    private async getObjects(library: string) {
        const result = await this.client.query<QueryResult<Record<string, unknown>>>(`
            SELECT *
            FROM TABLE(QSYS2.OBJECT_STATISTICS(
                OBJECT_SCHEMA => ?,
                OBJECT_NAME => '*ALL',
                OBJECT_TYPE => '*ALL'))
            ORDER BY OBJECT_NAME, OBJECT_TYPE
        `, [library]);
        return rowsFrom(result);
    }

    private async getSourceMembers(library: string) {
        const result = await this.client.query<QueryResult<Record<string, unknown>>>(`
            SELECT *
            FROM QSYS2.SYSMEMBERSTAT
            WHERE SYSTEM_TABLE_SCHEMA = ?
              AND SOURCE_TYPE IS NOT NULL
            ORDER BY SYSTEM_TABLE_NAME, SYSTEM_TABLE_MEMBER
        `, [library]);
        return rowsFrom(result).map((row) => {
            const sourceFile = normalizeName(rowValue(row, 'SYSTEM_TABLE_NAME'));
            const member = normalizeName(rowValue(row, 'SYSTEM_TABLE_MEMBER'));
            const sourceType = normalizeName(rowValue(row, 'SOURCE_TYPE') || 'SOURCE');
            const memberRecord: LiveSourceMember = {
                library,
                sourceFile,
                member,
                sourceType,
                relativePath: ''
            };
            memberRecord.relativePath = makeSourcePath(memberRecord);
            return memberRecord;
        }).filter((member) => member.sourceFile && member.member);
    }

    async getWorkspace(candidate?: Partial<ObjectAnalysisSettings>): Promise<ObjectAnalysisWorkspace> {
        const settings = normalizeObjectAnalysisSettings(candidate);
        if (!settings.libraryList.length) {
            throw new Error('Enter at least one IBM i library to load.');
        }

        const libraries = settings.libraryList;
        const sourceLibrary = settings.sourceLibrary || libraries[0];
        if (!sourceLibrary) {
            throw new Error('Choose an IBM i source library before loading source members.');
        }
        const objectResults = await Promise.all(libraries.map(async (library) => ({
            library,
            objects: await this.getObjects(library)
        })));
        const sourceMembers = await this.getSourceMembers(sourceLibrary);

        const libraryNodes: AnalysisFileNode[] = [];
        const sourceFiles = sourceMembers.filter((member) => sourceKind(member.sourceType) === 'source');
        const databaseFiles = sourceMembers.filter((member) => sourceKind(member.sourceType) === 'database');
        const summaries: ObjectAnalysisWorkspace['libraries'] = [];

        for (const library of Array.from(new Set([...libraries, sourceLibrary]))) {
            const entry = objectResults.find((item) => item.library === library);
            const members = library === sourceLibrary ? sourceMembers : [];
            const librarySourceFiles = members.filter((member) => sourceKind(member.sourceType) === 'source');
            const libraryDatabaseFiles = members.filter((member) => sourceKind(member.sourceType) === 'database');
            summaries.push({
                name: library,
                relativePath: `libraries/${library}`,
                sourceFiles: librarySourceFiles.length,
                databaseFiles: libraryDatabaseFiles.length,
                objectCount: entry?.objects.length || 0,
                selected: true
            });

            if (library !== sourceLibrary) {
                continue;
            }

            const memberNode = (member: LiveSourceMember): AnalysisFileNode => ({
                id: `file:${member.relativePath}`,
                name: `${member.member}.${sourceExtension(member.sourceType)}`,
                relativePath: member.relativePath,
                kind: sourceKind(member.sourceType),
                library,
                language: member.sourceType,
                analyzable: true
            });
            const sourceFileGroups = new Map<string, LiveSourceMember[]>();
            [...sourceFiles, ...databaseFiles].forEach((member) => {
                const members = sourceFileGroups.get(member.sourceFile) || [];
                members.push(member);
                sourceFileGroups.set(member.sourceFile, members);
            });
            const sourceFileNodes: AnalysisFileNode[] = Array.from(sourceFileGroups.entries()).map(([sourceFile, members]) => ({
                id: `directory:${library}:${sourceFile}`,
                name: sourceFile,
                relativePath: `libraries/${library}/${sourceFile}`,
                kind: 'directory',
                library,
                children: members.map(memberNode)
            }));
            libraryNodes.push({
                id: `directory:${library}`,
                name: library,
                relativePath: `libraries/${library}`,
                kind: 'directory',
                library,
                children: sourceFileNodes
            });
        }

        return {
            source: 'live',
            rootLabel: 'IBM i source library',
            rootPath: 'Connected IBM i system',
            masterLibrary: sourceLibrary,
            scannedAt: new Date().toISOString(),
            libraries: summaries,
            tree: {
                id: 'directory:ibmi-library-list',
                name: 'IBM i library list',
                relativePath: '',
                kind: 'directory',
                children: libraryNodes
            },
            sourceFileCount: sourceFiles.length,
            databaseFileCount: databaseFiles.length
        };
    }

    private async getMemberSource(library: string, sourceFile: string, member: string) {
        const qualifiedSourceFile = `${quoteIdentifier(library)}.${quoteIdentifier(sourceFile)}`;
        const result = await this.client.query<QueryResult<Record<string, unknown>>>(`
            SELECT *
            FROM ${qualifiedSourceFile}
            WHERE SRCMBR = ?
            ORDER BY SRCSEQ
        `, [member]);
        return rowsFrom(result).map(sourceTextFromRow).filter(Boolean).join('\n');
    }

    async getSourceContent(request: AnalyzeObjectRequest, candidate?: Partial<ObjectAnalysisSettings>) {
        const settings = normalizeObjectAnalysisSettings(candidate);
        const library = normalizeName(request.library);
        const sourceLibrary = settings.sourceLibrary || settings.libraryList[0];
        if (!settings.libraryList.includes(library) && library !== sourceLibrary) {
            throw new Error(`${library} is outside the configured IBM i library list.`);
        }
        if (sourceLibrary && library !== sourceLibrary) {
            throw new Error(`${library} is not the selected IBM i source library.`);
        }
        const memberPath = parseMemberPath(request.relativePath);
        if (!memberPath) throw new Error('Choose a source member from the IBM i source tree.');
        const content = await this.getMemberSource(library, memberPath.sourceFile, memberPath.member);
        if (!content) throw new Error(`No source text was returned for ${library}/${memberPath.member}.`);
        return content;
    }

    private async collectCommandEvidence(
        library: string,
        root: AnalysisObjectNode,
        fileNames: string[],
        edges: Map<string, DependencyEdge>,
        nodes: Map<string, AnalysisObjectNode>
    ) {
        const commands: CollectedCommandEvidence[] = [];
        const notes: string[] = [];
        if (!this.client.executeClCommand) {
            return {
                commands: [{
                    name: 'IBM i command evidence',
                    command: 'DSPPGMREF / DSPDBR / DSPFD',
                    status: 'not-supported' as const,
                    rowCount: 0,
                    detail: 'The connected provider does not expose CL command execution.'
                }],
                notes: ['Source and catalog evidence was collected; IBM i command output was not available from this connection.']
            };
        }

        const runOutfileCommand = async (name: string, command: string, outfile: string) => {
            try {
                await this.client.executeClCommand?.(command);
                const result = await this.client.query<QueryResult<Record<string, unknown>>>(`SELECT * FROM QTEMP.${quoteIdentifier(outfile)}`);
                const rows = rowsFrom(result);
                commands.push({ name, command, status: 'collected', rowCount: rows.length });
                return rows;
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                commands.push({ name, command, status: 'failed', rowCount: 0, detail });
                return [];
            }
        };

        if (root.type === '*PGM') {
            const command = `DSPPGMREF PGM(${library}/${root.name}) OUTPUT(*OUTFILE) OBJTYPE(*ALL) OUTFILE(QTEMP/IMPGMREF) OUTMBR(*FIRST *REPLACE)`;
            const rows = await runOutfileCommand('DSPPGMREF', command, 'IMPGMREF');
            rows.forEach((row) => {
                const name = commandValue(row, 'WHFNAM');
                if (!name || name === '*EXPR') return;
                const type = objectTypeFromProgramReference(row);
                const targetLibrary = commandValue(row, 'WHLNAM');
                const target = createNode(name, targetLibrary && !targetLibrary.startsWith('*') ? targetLibrary : library, type, 'known', {
                    attributes: { source: 'DSPPGMREF' }
                });
                nodes.set(target.id, target);
                addEdge(edges, root, target, {
                    relationship: type === '*FILE' ? fileRelationshipFromUsage(rowValue(row, 'WHFUSG')) : type === '*SRVPGM' ? 'binds' : 'references',
                    evidence: 'compiled',
                    confidence: 'confirmed',
                    detail: 'IBM i DSPPGMREF output'
                });
            });
        } else {
            notes.push(`DSPPGMREF was not run because ${root.type} is not a compiled *PGM target.`);
        }

        const uniqueFiles = Array.from(new Set(fileNames.map(normalizeName).filter(Boolean))).slice(0, 12);
        if (fileNames.length > uniqueFiles.length) {
            notes.push('DSPDBR and DSPFD were limited to the first 12 referenced files to keep an analysis bounded.');
        }
        for (const fileName of uniqueFiles) {
            const dbrCommand = `DSPDBR FILE(${library}/${fileName}) OUTPUT(*OUTFILE) OUTFILE(QTEMP/IMDBR) OUTMBR(*FIRST *REPLACE)`;
            const dbrRows = await runOutfileCommand('DSPDBR', dbrCommand, 'IMDBR');
            dbrRows.forEach((row) => {
                const dependentName = commandValue(row, 'WHREFI', 'WHDEP', 'WHDFNM');
                const dependentLibrary = commandValue(row, 'WHRELI', 'WHDLIB', 'WHLIB');
                if (!dependentName || dependentName === fileName || dependentName === '*NONE') return;
                const target = createNode(dependentName, dependentLibrary && !dependentLibrary.startsWith('*') ? dependentLibrary : library, '*FILE', 'known', {
                    attributes: { sharingType: commandValue(row, 'WHTYPE'), source: 'DSPDBR' }
                });
                nodes.set(target.id, target);
                addEdge(edges, nodes.get(objectId(library, fileName, '*FILE')) || createNode(fileName, library, '*FILE', 'known'), target, {
                    relationship: 'uses',
                    evidence: 'compiled',
                    confidence: 'confirmed',
                    detail: `IBM i DSPDBR output${commandValue(row, 'WHTYPE') ? ` (${commandValue(row, 'WHTYPE')})` : ''}`
                });
            });

            const fdCommand = `DSPFD FILE(${library}/${fileName}) TYPE(*ALL) OUTPUT(*OUTFILE) OUTFILE(QTEMP/IMDSPFD) OUTMBR(*FIRST *REPLACE)`;
            await runOutfileCommand('DSPFD', fdCommand, 'IMDSPFD');
        }

        if (!commands.length) {
            notes.push('No IBM i command evidence was requested for this object.');
        }
        return { commands, notes };
    }

    async analyzeObject(request: AnalyzeObjectRequest, candidate?: Partial<ObjectAnalysisSettings>): Promise<ObjectAnalysisResult> {
        const settings = normalizeObjectAnalysisSettings(candidate);
        const library = normalizeName(request.library);
        const sourceLibrary = settings.sourceLibrary || settings.libraryList[0];
        if (!settings.libraryList.includes(library) && library !== sourceLibrary) {
            throw new Error(`${library} is outside the configured IBM i library list.`);
        }
        if (sourceLibrary && library !== sourceLibrary) {
            throw new Error(`${library} is not the selected IBM i source library.`);
        }
        const memberPath = parseMemberPath(request.relativePath);
        if (!memberPath) {
            throw new Error('Choose a source member from the IBM i source tree.');
        }

        const [content, objectRows] = await Promise.all([
            this.getMemberSource(library, memberPath.sourceFile, memberPath.member),
            Promise.all(settings.libraryList.map((item) => this.getObjects(item)))
        ]);
        if (!content) {
            throw new Error(`No source text was returned for ${library}/${memberPath.member}.`);
        }

        const definitions: LiveObjectDefinition[] = objectRows.flatMap((rows, index) => rows.map((row) => {
            const name = normalizeName(rowValue(row, 'OBJECT_NAME'));
            const itemLibrary = normalizeName(rowValue(row, 'OBJECT_SCHEMA')) || settings.libraryList[index];
            const type = normalizeType(rowValue(row, 'OBJECT_TYPE'));
            return {
                name,
                library: itemLibrary,
                type,
                description: rowValue(row, 'TEXT_DESCRIPTION') ? String(rowValue(row, 'TEXT_DESCRIPTION')) : undefined,
                attributes: {
                    attribute: rowValue(row, 'OBJECT_ATTRIBUTE') == null ? null : String(rowValue(row, 'OBJECT_ATTRIBUTE')),
                    status: rowValue(row, 'OBJECT_STATUS') == null ? null : String(rowValue(row, 'OBJECT_STATUS'))
                }
            };
        }).filter((definition) => definition.name));
        const findDefinition = (name: string, type: AnalysisObjectType, targetLibrary?: string) => {
            const normalizedTarget = targetLibrary ? normalizeName(targetLibrary) : undefined;
            return definitions.find((definition) => definition.name === normalizeName(name)
                && (!normalizedTarget || definition.library === normalizedTarget)
                && (type === '*UNKNOWN' || definition.type === type))
                || definitions.find((definition) => definition.name === normalizeName(name)
                    && (type === '*UNKNOWN' || definition.type === type));
        };

        const nodes = new Map<string, AnalysisObjectNode>();
        const edges = new Map<string, DependencyEdge>();
        const requestedName = normalizeName(request.objectName || memberPath.member);
        const rootDefinition = findDefinition(requestedName, request.objectType || '*UNKNOWN', library);
        const root = rootDefinition
            ? createNode(rootDefinition.name, rootDefinition.library, rootDefinition.type, 'known', rootDefinition)
            : createNode(requestedName, library, '*PGM', 'known');
        root.sourcePath = request.relativePath;
        nodes.set(root.id, root);

        const parsed = (await import('../features/object-analysis/rpg-parser')).parseRpgSource(content);
        const sourceSignals = new Set(parsed.signals);
        parsed.references.forEach((reference) => {
            const definition = findDefinition(reference.targetName, reference.targetType, reference.targetLibrary);
            const target = definition
                ? createNode(definition.name, definition.library, definition.type, 'known', definition)
                : createNode(reference.targetName, reference.targetLibrary || library, reference.targetType, 'unresolved');
            nodes.set(target.id, target);
            addEdge(edges, root, target, {
                relationship: reference.relationship,
                evidence: 'source',
                confidence: definition ? reference.confidence : 'unresolved',
                line: reference.line,
                detail: reference.detail
            });
        });

        const fileNames = Array.from(new Set([
            ...parsed.references.filter((reference) => reference.targetType === '*FILE').map((reference) => reference.targetName),
            ...Array.from(nodes.values()).filter((node) => node.type === '*FILE').map((node) => node.name)
        ]));
        const systemEvidence = await this.collectCommandEvidence(library, root, fileNames, edges, nodes);

        const visibleNodes = Array.from(nodes.values()).slice(0, settings.maxNodes);
        const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
        const visibleEdges = Array.from(edges.values()).filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
        const unresolvedReferences = visibleNodes.filter((node) => node.status === 'unresolved')
            .map((node) => `${node.library}/${node.name} (${node.type})`);
        const blockers = unresolvedReferences.length
            ? [`${unresolvedReferences.length} reference${unresolvedReferences.length === 1 ? '' : 's'} could not be resolved.`]
            : [];
        const warnings: string[] = [];
        if (sourceSignals.has('Dynamic CL command execution was found.')) warnings.push('Dynamic CL command execution needs human review.');
        if (sourceSignals.has('Embedded SQL was found.')) warnings.push('Embedded SQL must be preserved during conversion.');
        if (sourceSignals.has('Environment variables are used.')) warnings.push('Environment variables must be recreated in the target environment.');
        if (sourceSignals.has('Data queues are used.')) warnings.push('Data queues are part of the runtime contract and must be included.');
        const status: ObjectAnalysisResult['readiness']['status'] = blockers.length ? 'blocked' : warnings.length ? 'review' : 'ready';
        return {
            source: 'live',
            root,
            nodes: visibleNodes,
            edges: visibleEdges,
            directDependencies: new Set(visibleEdges.filter((edge) => edge.from === root.id).map((edge) => edge.to)).size,
            impactedObjects: new Set(visibleEdges.filter((edge) => edge.to === root.id).map((edge) => edge.from)).size,
            unresolvedReferences,
            sourceSignals: Array.from(sourceSignals),
            readiness: {
                status,
                label: status === 'blocked' ? 'Blocked' : status === 'review' ? 'Review needed' : 'Ready for review',
                score: Math.max(0, 100 - blockers.length * 25 - warnings.length * 8),
                blockers,
                warnings,
                confirmed: ['Source member was loaded directly from the connected IBM i system.']
            },
            systemEvidence: {
                source: 'ibmi-commands',
                collectedAt: new Date().toISOString(),
                commands: systemEvidence.commands,
                notes: [
                    'IBM i command output is the factual system evidence layer. Source parsing is shown separately for business intent.',
                    ...systemEvidence.notes
                ]
            },
            generatedAt: new Date().toISOString(),
            scope: {
                libraries: settings.libraryList,
                sourceLibrary: sourceLibrary || null,
                depth: settings.dependencyDepth,
                maxNodes: settings.maxNodes
            }
        };
    }
}
