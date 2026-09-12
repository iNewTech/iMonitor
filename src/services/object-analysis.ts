import { readFile, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
    DEFAULT_OBJECT_ANALYSIS_SETTINGS,
    normalizeObjectAnalysisSettings,
    objectId,
    parseObjectAnalysisLibraryList,
    isValidIbmiName,
    type AnalysisObjectNode,
    type AnalysisObjectType,
    type AnalyzeObjectRequest,
    type DependencyEdge,
    type ObjectAnalysisResult,
    type ObjectAnalysisSettings,
    type ObjectAnalysisWorkspace,
    type ObjectAnalysisLibraryListInfo
} from '../features/object-analysis/model';
import { parseRpgSource } from '../features/object-analysis/rpg-parser';
import { collectSourceFiles, discoverLocalLibraries, selectLocalSource, walkDirectory, type LocalSourceLibrary, type SourceFile } from '../features/object-analysis/local-source';

interface DemoObjectDefinition {
    name: string;
    type: AnalysisObjectType;
    language?: string;
    sourcePath?: string;
    sourceFile?: string;
    sourceMember?: string;
    description?: string;
    attributes?: Record<string, string | number | boolean | null>;
}

interface DemoLibraryManifest {
    library: string;
    objects: DemoObjectDefinition[];
}

interface DemoLibraryList {
    masterLibrary?: string;
    libraries?: string[];
    libraryList?: string[];
    librarylist?: string[];
}

interface InternalGraph {
    nodes: Map<string, AnalysisObjectNode>;
    edges: Map<string, DependencyEdge>;
}

function normalizeName(value: string) {
    return value.trim().toUpperCase();
}

function normalizeType(value: string | undefined): AnalysisObjectType {
    const normalized = normalizeName(value || '*UNKNOWN') as AnalysisObjectType;
    const known: AnalysisObjectType[] = [
        '*PGM', '*SRVPGM', '*MODULE', '*FILE', '*DTAQ', '*DTAARA', '*ENVVAR',
        '*JOBD', '*JOBQ', '*SBS', '*CMD', '*COPY', '*UNKNOWN'
    ];
    return known.includes(normalized) ? normalized : '*UNKNOWN';
}

function objectNameFromFile(fileName: string) {
    return fileName.replace(/\.(sqlrpgle|rpgle|rpg|clle|cl|cobol|cbl|dds|dspf|pf|lf|sql|ddl|table|file)$/i, '').toUpperCase();
}

function objectTypeForSourceFile(sourceFile: SourceFile): AnalysisObjectType {
    if (sourceFile.kind === 'database') {
        return '*FILE';
    }
    return '*PGM';
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(filePath, 'utf8')) as T;
    } catch {
        return fallback;
    }
}

function createNode(definition: DemoObjectDefinition, library: string): AnalysisObjectNode {
    const type = normalizeType(definition.type);
    return {
        id: objectId(library, definition.name, type),
        name: normalizeName(definition.name),
        library: normalizeName(library),
        type,
        language: definition.language,
        sourcePath: definition.sourcePath,
        description: definition.description,
        status: 'known',
        attributes: {
            ...(definition.attributes || {}),
            sourceFile: definition.sourceFile || null,
            sourceMember: definition.sourceMember || null
        }
    };
}

function addEdge(
    graph: InternalGraph,
    from: AnalysisObjectNode,
    to: AnalysisObjectNode,
    input: Omit<DependencyEdge, 'id' | 'from' | 'to'>
) {
    const id = `${from.id}->${to.id}|${input.relationship}|${input.line || 0}`;
    if (!graph.edges.has(id)) {
        graph.edges.set(id, {
            id,
            from: from.id,
            to: to.id,
            ...input
        });
    }
}

export interface ObjectAnalysisProvider {
    getWorkspace(settings?: Partial<ObjectAnalysisSettings>): Promise<ObjectAnalysisWorkspace>;
    getSourceContent(request: AnalyzeObjectRequest, settings?: Partial<ObjectAnalysisSettings>): Promise<string>;
    analyzeObject(
        request: AnalyzeObjectRequest,
        settings?: Partial<ObjectAnalysisSettings>
    ): Promise<ObjectAnalysisResult>;
}

/** Reads one local IBM i-shaped directory using the same contract as the live provider. */
export class DemoObjectAnalysisService implements ObjectAnalysisProvider {
    constructor(private readonly rootPath: string) {}

    private async getLibraryList(): Promise<ObjectAnalysisLibraryListInfo> {
        const entries = await readdir(this.rootPath, { withFileTypes: true });
        for (const name of ['setup.json', 'settings.json', 'library-list.json']) {
            const fileName = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === name)?.name;
            if (!fileName) continue;
            const candidate = await readJson<DemoLibraryList>(
                path.join(this.rootPath, fileName),
                {}
            );
            const configuredLibraries = candidate.libraryList
                ?? candidate.librarylist
                ?? candidate.libraries
                ?? [];
            if (configuredLibraries.length || candidate.masterLibrary) {
                return {
                    masterLibrary: candidate.masterLibrary || 'DEMO',
                    libraries: parseObjectAnalysisLibraryList(configuredLibraries),
                    source: 'setup-file',
                    fileName
                };
            }
        }

        return { masterLibrary: 'DEMO', libraries: [], source: 'detected' };
    }

    private async getLibraryManifests(libraries: LocalSourceLibrary[]) {
        return Promise.all(libraries.map(async (library) => {
            const entries = await readdir(library.path, { withFileTypes: true });
            const fileName = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === 'objects.json')?.name;
            const manifest = fileName
                ? await readJson<DemoLibraryManifest>(path.join(library.path, fileName), { library: library.name, objects: [] })
                : { library: library.name, objects: [] };
            return { ...manifest, library: library.name };
        }));
    }

    private async getAvailableLibraries() {
        const [list, physicalLibraries] = await Promise.all([
            this.getLibraryList(), discoverLocalLibraries(this.rootPath)
        ]);
        const libraries = list.source === 'setup-file'
            ? list.libraries
            : physicalLibraries.map((library) => library.name);
        return { list, libraries, physicalLibraries };
    }

    /** Returns the configured or inferred libraries for the selected local root. */
    async getConfiguredLibraries() {
        const { libraries } = await this.getAvailableLibraries();
        return libraries;
    }

    /** Returns the saved setup list, or the libraries detected when no setup exists yet. */
    async getLibraryListInfo(): Promise<ObjectAnalysisLibraryListInfo> {
        const { list, libraries } = await this.getAvailableLibraries();
        return {
            masterLibrary: list.masterLibrary || 'DEMO',
            libraries,
            source: list.source,
            fileName: list.fileName
        };
    }

    /** Creates or updates the local setup file only when the operator explicitly saves it. */
    async saveLibraryList(value: string[]): Promise<{ fileName: string; libraries: string[] }> {
        const libraries = parseObjectAnalysisLibraryList(value);
        if (!libraries.length) {
            throw new Error('Add at least one library before saving the setup file.');
        }
        const invalidLibraries = libraries.filter((library) => !isValidIbmiName(library));
        if (invalidLibraries.length) {
            throw new Error(`IBM i library names must be 1–10 letters or numbers: ${invalidLibraries.join(', ')}.`);
        }

        const entries = await readdir(this.rootPath, { withFileTypes: true });
        const fileName = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === 'setup.json')?.name || 'setup.json';
        const setupPath = path.join(this.rootPath, fileName);
        const existing = await readJson<Record<string, unknown>>(setupPath, {});
        const current = await this.getLibraryList();
        const setup = {
            ...existing,
            masterLibrary: typeof existing.masterLibrary === 'string'
                ? existing.masterLibrary
                : current.masterLibrary || 'DEMO',
            libraryList: libraries
        };
        await writeFile(setupPath, `${JSON.stringify(setup, null, 2)}\n`, 'utf8');
        return { fileName, libraries };
    }

    async getWorkspace(candidate?: Partial<ObjectAnalysisSettings>): Promise<ObjectAnalysisWorkspace> {
        const settings = normalizeObjectAnalysisSettings(candidate || DEFAULT_OBJECT_ANALYSIS_SETTINGS);
        const { list, physicalLibraries } = await this.getAvailableLibraries();
        const browseLibraries = physicalLibraries;
        const manifests = await this.getLibraryManifests(browseLibraries);
        const librarySummaries: ObjectAnalysisWorkspace['libraries'] = [];
        let sourceFileCount = 0;
        let databaseFileCount = 0;

        for (const sourceLibrary of browseLibraries) {
            const library = sourceLibrary.name;
            const files = await collectSourceFiles(sourceLibrary.path, library);
            const sourceFiles = files.filter((file) => file.kind !== 'database').length;
            const databaseFiles = files.filter((file) => file.kind === 'database').length;
            const manifest = manifests.find((entry) => normalizeName(entry.library) === library);
            sourceFileCount += sourceFiles;
            databaseFileCount += databaseFiles;
            librarySummaries.push({
                name: library,
                relativePath: sourceLibrary.relativePath,
                sourceFiles,
                databaseFiles,
                objectCount: manifest?.objects?.length || 0,
                selected: settings.libraryList.includes(library)
            });
        }

        return {
            source: 'demo',
            rootLabel: 'Demo master library',
            rootPath: this.rootPath,
            masterLibrary: list.masterLibrary || 'DEMO',
            scannedAt: new Date().toISOString(),
            libraries: librarySummaries,
            tree: {
                id: 'directory:master-library',
                name: path.basename(this.rootPath),
                relativePath: '',
                kind: 'directory',
                children: (await Promise.all(browseLibraries.map(async (library) => {
                    const children = await walkDirectory(library.path, library.relativePath, library.name);
                    return library.relativePath ? [{
                        id: `directory:${library.relativePath}`,
                        name: path.basename(library.path),
                        relativePath: library.relativePath,
                        kind: 'directory' as const,
                        library: library.name,
                        children
                    }] : children;
                }))).flat()
            },
            sourceFileCount,
            databaseFileCount
        };
    }

    async getSourceContent(
        request: AnalyzeObjectRequest,
        candidate?: Partial<ObjectAnalysisSettings>
    ) {
        const libraries = await discoverLocalLibraries(this.rootPath);
        const library = libraries.find((entry) => entry.name === normalizeName(request.library));
        const requestLibrary = normalizeName(request.library);
        const files = library ? await collectSourceFiles(library.path, library.name) : [];
        const selected = library && selectLocalSource(files, library, request.relativePath);
        if (!selected) {
            throw new Error(`Source text was not found for ${requestLibrary}/${path.basename(request.relativePath)}.`);
        }
        return selected.content;
    }

    async analyzeObject(
        request: AnalyzeObjectRequest,
        candidate?: Partial<ObjectAnalysisSettings>
    ): Promise<ObjectAnalysisResult> {
        const settings = normalizeObjectAnalysisSettings(candidate || DEFAULT_OBJECT_ANALYSIS_SETTINGS);
        const physicalLibraries = await discoverLocalLibraries(this.rootPath);
        const scanLibraries = settings.libraryList;
        const requestLibrary = normalizeName(request.library);
        const sourceLibrary = physicalLibraries.find((library) => library.name === requestLibrary);
        if (!sourceLibrary) {
            throw new Error(`Source library ${requestLibrary} was not found in the selected local directory.`);
        }
        const analysisLibraries = physicalLibraries.filter((library) => (
            scanLibraries.includes(library.name) || library.name === requestLibrary
        ));
        const manifests = await this.getLibraryManifests(analysisLibraries);
        const sourceFiles = (await Promise.all(analysisLibraries.map((library) => (
            collectSourceFiles(library.path, library.name)
        )))).flat();
        const selectedSource = selectLocalSource(sourceFiles, sourceLibrary, request.relativePath);
        if (!selectedSource) {
            throw new Error(`Source text was not found for ${requestLibrary}/${path.basename(request.relativePath)}.`);
        }
        const graph: InternalGraph = { nodes: new Map(), edges: new Map() };
        const definitions: Array<DemoObjectDefinition & { library: string }> = [];

        manifests.forEach((manifest) => {
            const library = normalizeName(manifest.library);
            manifest.objects.forEach((definition) => {
                definitions.push({ ...definition, library });
                const node = createNode(definition, library);
                graph.nodes.set(node.id, node);
            });
        });

        // A local directory may be a source export without an objects.json
        // catalog. Add source members as object definitions so their actual
        // contents can still drive the analysis. Catalog entries remain useful
        // for resolving objects that have no source member in the export.
        sourceFiles.forEach((sourceFile) => {
            const name = objectNameFromFile(sourceFile.name);
            const type = objectTypeForSourceFile(sourceFile);
            if (definitions.some((definition) => (
                normalizeName(definition.name) === name
                && definition.library === normalizeName(sourceFile.library)
            ))) {
                return;
            }
            const definition: DemoObjectDefinition & { library: string } = {
                name,
                type,
                language: sourceFile.language,
                sourcePath: sourceFile.relativePath,
                sourceFile: sourceFile.relativePath.split('/')[0],
                sourceMember: name,
                description: `${sourceFile.language || 'Source'} member ${name}`,
                library: normalizeName(sourceFile.library)
            };
            definitions.push(definition);
            const node = createNode(definition, definition.library);
            graph.nodes.set(node.id, node);
        });

        const findDefinition = (
            rawName: string,
            rawLibrary: string | undefined,
            rawType: AnalysisObjectType
        ) => {
            const name = normalizeName(rawName);
            const library = rawLibrary ? normalizeName(rawLibrary) : undefined;
            const lookupLibraries = library ? [library] : scanLibraries;
            for (const lookupLibrary of lookupLibraries) {
                const match = definitions.find((definition) => (
                    definition.library === lookupLibrary
                    && normalizeName(definition.name) === name
                    && (rawType === '*UNKNOWN' || normalizeType(definition.type) === rawType)
                ));
                if (match) return match;
            }
            return undefined;
        };

        const ensureNode = (
            rawName: string,
            rawLibrary: string | undefined,
            rawType: AnalysisObjectType,
            status: AnalysisObjectNode['status'] = 'known'
        ) => {
            const definition = findDefinition(rawName, rawLibrary, rawType);
            if (definition) {
                const node = graph.nodes.get(objectId(definition.library, definition.name, normalizeType(definition.type)))
                    || createNode(definition, definition.library);
                graph.nodes.set(node.id, node);
                return node;
            }

            const unresolvedLibrary = rawLibrary || '*LIBL';
            const node: AnalysisObjectNode = {
                id: objectId(unresolvedLibrary, rawName, rawType),
                name: normalizeName(rawName),
                library: normalizeName(unresolvedLibrary),
                type: rawType,
                status,
                attributes: {}
            };
            const existing = graph.nodes.get(node.id);
            if (existing) {
                if (status === 'unresolved') {
                    existing.status = status;
                }
                return existing;
            }
            graph.nodes.set(node.id, node);
            return node;
        };

        const sourceSignalsByNode = new Map<string, Set<string>>();
        sourceFiles.forEach((sourceFile) => {
            const definition = findDefinition(
                objectNameFromFile(sourceFile.name),
                sourceFile.library,
                '*UNKNOWN'
            );
            if (!definition) {
                return;
            }
            const from = ensureNode(definition.name, definition.library, normalizeType(definition.type));
            const parsed = parseRpgSource(sourceFile.content);
            sourceSignalsByNode.set(from.id, new Set(parsed.signals));
            parsed.references.forEach((reference) => {
                const to = ensureNode(
                    reference.targetName,
                    reference.targetLibrary === '*LIBL' ? undefined : reference.targetLibrary,
                    reference.targetType,
                    'unresolved'
                );
                addEdge(graph, from, to, {
                    relationship: reference.relationship,
                    evidence: 'source',
                    confidence: reference.confidence,
                    line: reference.line,
                    detail: reference.detail
                });
            });
        });

        const requestName = normalizeName(request.objectName || objectNameFromFile(path.basename(request.relativePath)));
        const requestedDefinition = findDefinition(requestName, requestLibrary, request.objectType || '*UNKNOWN');
        const inferredType: AnalysisObjectType = selectedSource?.language === 'RPGLE'
            ? '*PGM'
            : selectedSource?.language === 'CLLE'
                ? '*PGM'
                : selectedSource?.kind === 'database'
                    ? '*FILE'
                : request.objectType || '*UNKNOWN';
        const root = requestedDefinition
            ? ensureNode(requestedDefinition.name, requestedDefinition.library, normalizeType(requestedDefinition.type))
            : ensureNode(requestName, requestLibrary, inferredType, selectedSource ? 'known' : 'unresolved');
        root.sourcePath = selectedSource.relativePath;
        if (root.type === '*PGM' && !root.sourcePath) {
            root.status = 'unresolved';
        }
        const sourceSignals = sourceSignalsByNode.get(root.id) || new Set<string>();

        const distances = new Map<string, number>([[root.id, 0]]);
        const visibleEdgeIds = new Set<string>();
        const pending = [root.id];
        while (pending.length && distances.size < settings.maxNodes) {
            const currentId = pending.shift() as string;
            const currentDepth = distances.get(currentId) || 0;
            if (currentDepth >= settings.dependencyDepth) {
                continue;
            }

            graph.edges.forEach((edge) => {
                // A dependency tree follows what the selected object uses.
                // Reverse edges are reported separately as impacted objects;
                // traversing them here makes a small copybook look like it
                // depends on every program that includes it.
                if (edge.from !== currentId) {
                    return;
                }
                const neighbor = edge.to;
                if (distances.has(neighbor)) {
                    visibleEdgeIds.add(edge.id);
                    return;
                }
                if (distances.size >= settings.maxNodes) {
                    return;
                }
                distances.set(neighbor, currentDepth + 1);
                pending.push(neighbor);
                visibleEdgeIds.add(edge.id);
            });
        }

        const visibleNodes = Array.from(distances.keys())
            .map((id) => graph.nodes.get(id))
            .filter((node): node is AnalysisObjectNode => Boolean(node));
        const visibleEdges = Array.from(visibleEdgeIds)
            .map((id) => graph.edges.get(id))
            .filter((edge): edge is DependencyEdge => Boolean(edge));
        const directDependencies = new Set(
            visibleEdges.filter((edge) => edge.from === root.id).map((edge) => edge.to)
        ).size;
        const impactedObjects = new Set(
            Array.from(graph.edges.values()).filter((edge) => edge.to === root.id).map((edge) => edge.from)
        ).size;
        const unresolvedReferences = Array.from(new Set(
            visibleNodes
                .filter((node) => node.status === 'unresolved')
                .map((node) => `${node.library}/${node.name} (${node.type})`)
        ));
        const blockers: string[] = [];
        const warnings: string[] = [];
        const confirmed: string[] = [];
        if (!root.sourcePath && ['*PGM', '*SRVPGM', '*MODULE'].includes(root.type)) {
            blockers.push('Source member was not found for this object.');
        } else if (root.sourcePath) {
            confirmed.push('Source member is available for analysis.');
        }
        if (unresolvedReferences.length) {
            blockers.push(`${unresolvedReferences.length} reference${unresolvedReferences.length === 1 ? '' : 's'} could not be resolved.`);
        } else {
            confirmed.push('All discovered references were matched to known local catalog objects.');
        }
        if (sourceSignals.has('Dynamic CL command execution was found.')) {
            warnings.push('Dynamic CL command execution needs human review.');
        }
        if (sourceSignals.has('Embedded SQL was found.')) {
            warnings.push('Embedded SQL must be preserved during conversion.');
        }
        if (sourceSignals.has('Commitment control or transaction boundaries were found.')) {
            warnings.push('Transaction boundaries need behavioral-equivalence tests.');
        }
        if (sourceSignals.has('Environment variables are used.')) {
            warnings.push('Environment variables must be recreated in the target environment.');
        }
        if (sourceSignals.has('Data queues are used.')) {
            warnings.push('Data queues are part of the runtime contract and must be included.');
        }
        const score = Math.max(
            0,
            100
            - blockers.length * 25
            - warnings.length * 8
            - Math.min(20, visibleEdges.filter((edge) => edge.confidence === 'possible').length * 5)
        );
        const status: ObjectAnalysisResult['readiness']['status'] = blockers.length
            ? 'blocked'
            : warnings.length
                ? 'review'
                : root.status === 'unresolved'
                    ? 'insufficient-evidence'
                    : 'ready';

        return {
            source: 'demo',
            root,
            nodes: visibleNodes,
            edges: visibleEdges,
            directDependencies,
            impactedObjects,
            unresolvedReferences,
            sourceSignals: Array.from(sourceSignals),
            readiness: {
                status,
                label: status === 'blocked'
                    ? 'Blocked'
                    : status === 'review'
                        ? 'Review needed'
                        : status === 'ready'
                            ? 'Ready for review'
                            : 'Insufficient evidence',
                score,
                blockers,
                warnings,
                confirmed
            },
            systemEvidence: {
                source: 'local-source',
                collectedAt: new Date().toISOString(),
                commands: [],
                notes: [
                    'This local analysis reads source members and the local object catalog only.',
                    'No IBM i commands were executed. Run the same object against a connected IBM i system for command-backed evidence.'
                ]
            },
            generatedAt: new Date().toISOString(),
            scope: {
                libraries: scanLibraries,
                sourceLibrary: settings.sourceLibrary,
                depth: settings.dependencyDepth,
                maxNodes: settings.maxNodes
            }
        };
    }
}
