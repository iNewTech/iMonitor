import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
    classifyAnalysisFile,
    DEFAULT_OBJECT_ANALYSIS_SETTINGS,
    normalizeObjectAnalysisSettings,
    objectId,
    parseObjectAnalysisLibraryList,
    isValidIbmiName,
    type AnalysisFileNode,
    type AnalysisFileKind,
    type AnalysisObjectNode,
    type AnalysisObjectType,
    type AnalysisRelationship,
    type AnalyzeObjectRequest,
    type DependencyEdge,
    type ObjectAnalysisResult,
    type ObjectAnalysisSettings,
    type ObjectAnalysisWorkspace,
    type ObjectAnalysisLibraryListInfo
} from '../features/object-analysis/model';
import { parseRpgSource, type SourceReference } from '../features/object-analysis/rpg-parser';

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

interface SourceFile {
    library: string;
    name: string;
    relativePath: string;
    kind: AnalysisFileKind;
    language?: string;
    content: string;
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

function toRelativePath(value: string) {
    return value.split(path.sep).join('/');
}

function fileKindForNode(fileName: string) {
    return classifyAnalysisFile(fileName);
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

async function walkDirectory(
    directoryPath: string,
    relativePath: string,
    library?: string
): Promise<AnalysisFileNode[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
            return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
    });
    const nodes: AnalysisFileNode[] = [];

    for (const entry of sortedEntries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const childRelativePath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
        const childPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            const childLibrary = library || (['user-libraries', 'userlib'].includes(relativePath.toLowerCase())
                ? normalizeName(entry.name)
                : library);
            nodes.push({
                id: `directory:${childRelativePath}`,
                name: entry.name,
                relativePath: childRelativePath,
                kind: 'directory',
                library: childLibrary,
                children: await walkDirectory(childPath, childRelativePath, childLibrary)
            });
            continue;
        }

        const fileKind = fileKindForNode(entry.name);
        nodes.push({
            id: `file:${childRelativePath}`,
            name: entry.name,
            relativePath: childRelativePath,
            kind: fileKind.kind,
            library,
            language: fileKind.language,
            analyzable: fileKind.analyzable
        });
    }

    return nodes;
}

async function collectSourceFiles(directoryPath: string, library: string, relativePath = ''): Promise<SourceFile[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: SourceFile[] = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const childPath = path.join(directoryPath, entry.name);
        const childRelativePath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
        if (entry.isDirectory()) {
            files.push(...await collectSourceFiles(childPath, library, childRelativePath));
            continue;
        }

        const fileKind = fileKindForNode(entry.name);
        if (!fileKind.analyzable || fileKind.kind === 'metadata') {
            continue;
        }

        files.push({
            library,
            name: entry.name,
            relativePath: toRelativePath(childRelativePath),
            kind: fileKind.kind,
            language: fileKind.language,
            content: await readFile(childPath, 'utf8')
        });
    }

    return files;
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

    private async getLibraryRoot() {
        for (const directoryName of ['userlib', 'user-libraries']) {
            const nestedRoot = path.join(this.rootPath, directoryName);
            try {
                if ((await stat(nestedRoot)).isDirectory()) {
                    return { path: nestedRoot, prefix: directoryName };
                }
            } catch {
                // The selected local directory may use a flat library layout.
            }
        }

        return { path: this.rootPath, prefix: '' };
    }

    private async getLibraryList(): Promise<ObjectAnalysisLibraryListInfo> {
        for (const fileName of ['setup.json', 'settings.json', 'library-list.json']) {
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

    private async getLibraryManifests(libraries: string[], libraryRoot: string) {
        return Promise.all(libraries.map(async (library) => readJson<DemoLibraryManifest>(
            path.join(libraryRoot, library, 'objects.json'),
            { library, objects: [] }
        )));
    }

    private async getAvailableLibraries() {
        const libraryRoot = await this.getLibraryRoot();
        const list = await this.getLibraryList();
        const configured = list.libraries.map(normalizeName);
        if (configured.length) {
            return { list, libraries: Array.from(new Set(configured)), libraryRoot };
        }

        // A user may choose one library folder instead of its master root.
        // Treat that folder as the complete local scope rather than mistaking
        // source-file folders for library names. Folder names are intentionally
        // not prescribed: IBM i source files are identified by their members
        // and extensions, not by a required local directory convention.
        const selectedLibraryName = path.basename(this.rootPath);
        const selectedEntries = await readdir(this.rootPath, { withFileTypes: true }).catch(() => []);
        const looksLikeLibrary = selectedEntries.some((entry) => (
            entry.name.toLowerCase() === 'objects.json'
            || entry.isDirectory()
        ));
        if (!libraryRoot.prefix && looksLikeLibrary && selectedLibraryName) {
            return {
                list: { ...list, libraries: [selectedLibraryName] },
                libraries: [normalizeName(selectedLibraryName)],
                libraryRoot: { path: path.dirname(this.rootPath), prefix: '' }
            };
        }

        const entries = await readdir(libraryRoot.path, { withFileTypes: true });
        return {
            list,
            libraries: entries.filter((entry) => entry.isDirectory()).map((entry) => normalizeName(entry.name)),
            libraryRoot
        };
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

        const setupPath = path.join(this.rootPath, 'setup.json');
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
        return { fileName: 'setup.json', libraries };
    }

    async getWorkspace(candidate?: Partial<ObjectAnalysisSettings>): Promise<ObjectAnalysisWorkspace> {
        const settings = normalizeObjectAnalysisSettings(candidate || DEFAULT_OBJECT_ANALYSIS_SETTINGS);
        const { list, libraries, libraryRoot } = await this.getAvailableLibraries();
        const scanLibraries = settings.libraryList.filter((library) => libraries.includes(library));
        const missingLibraries = settings.libraryList.filter((library) => !libraries.includes(library));
        if (missingLibraries.length) {
            throw new Error(`These libraries were not found in the selected local directory: ${missingLibraries.join(', ')}.`);
        }
        if (!scanLibraries.length) {
            throw new Error('No configured libraries were found in the selected local directory.');
        }
        const manifests = await this.getLibraryManifests(scanLibraries, libraryRoot.path);
        const librarySummaries: ObjectAnalysisWorkspace['libraries'] = [];
        let sourceFileCount = 0;
        let databaseFileCount = 0;

        for (const library of scanLibraries) {
            const libraryPath = path.join(libraryRoot.path, library);
            const files = await collectSourceFiles(libraryPath, library);
            const sourceFiles = files.filter((file) => file.kind !== 'database').length;
            const databaseFiles = files.filter((file) => file.kind === 'database').length;
            const manifest = manifests.find((entry) => normalizeName(entry.library) === library);
            sourceFileCount += sourceFiles;
            databaseFileCount += databaseFiles;
            librarySummaries.push({
                name: library,
                relativePath: libraryRoot.prefix ? `${libraryRoot.prefix}/${library}` : library,
                sourceFiles,
                databaseFiles,
                objectCount: manifest?.objects?.length || 0,
                selected: true
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
                children: scanLibraries.length
                    ? libraryRoot.prefix
                        ? [{
                            id: `directory:${libraryRoot.prefix}`,
                            name: libraryRoot.prefix,
                            relativePath: libraryRoot.prefix,
                            kind: 'directory',
                            children: await Promise.all(scanLibraries.map((library) => (
                                walkDirectory(path.join(libraryRoot.path, library), `${libraryRoot.prefix}/${library}`, library)
                            ))).then((groups) => groups.flat())
                        }]
                        : await Promise.all(scanLibraries.map((library) => (
                            walkDirectory(path.join(libraryRoot.path, library), library, library)
                        ))).then((groups) => groups.flat())
                    : []
            },
            sourceFileCount,
            databaseFileCount
        };
    }

    async getSourceContent(
        request: AnalyzeObjectRequest,
        candidate?: Partial<ObjectAnalysisSettings>
    ) {
        const settings = normalizeObjectAnalysisSettings(candidate || DEFAULT_OBJECT_ANALYSIS_SETTINGS);
        const { libraries, libraryRoot } = await this.getAvailableLibraries();
        const scanLibraries = settings.libraryList.filter((library) => libraries.includes(library));
        const requestLibrary = normalizeName(request.library);
        if (!scanLibraries.includes(requestLibrary)) {
            throw new Error(`${requestLibrary} is outside the configured analysis library list.`);
        }

        const files = await collectSourceFiles(path.join(libraryRoot.path, requestLibrary), requestLibrary);
        const relativePathParts = request.relativePath.split('/').filter(Boolean);
        const libraryIndex = relativePathParts.findIndex((part) => normalizeName(part) === requestLibrary);
        const normalizedPath = toRelativePath(libraryIndex >= 0
            ? relativePathParts.slice(libraryIndex + 1).join('/')
            : request.relativePath);
        const selected = files.find((file) => toRelativePath(file.relativePath) === normalizedPath);
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
        const { libraries, libraryRoot } = await this.getAvailableLibraries();
        const scanLibraries = settings.libraryList.filter((library) => libraries.includes(library));
        const missingLibraries = settings.libraryList.filter((library) => !libraries.includes(library));
        if (missingLibraries.length) {
            throw new Error(`These libraries were not found in the selected local directory: ${missingLibraries.join(', ')}.`);
        }
        if (!scanLibraries.length) {
            throw new Error('No configured libraries were found in the selected local directory.');
        }
        const requestLibrary = normalizeName(request.library);
        if (!scanLibraries.includes(requestLibrary)) {
            throw new Error(`${requestLibrary} is outside the configured analysis library list.`);
        }
        const manifests = await this.getLibraryManifests(scanLibraries, libraryRoot.path);
        const sourceFiles = (await Promise.all(scanLibraries.map(async (library) => (
            collectSourceFiles(path.join(libraryRoot.path, library), library)
        )))).flat();
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
            const exactMatch = definitions.find((definition) => (
                normalizeName(definition.name) === name
                && (!library || definition.library === library)
                && (rawType === '*UNKNOWN' || normalizeType(definition.type) === rawType)
            ));
            if (exactMatch) {
                return exactMatch;
            }

            // Unqualified RPG references often rely on the IBM i library list.
            // If the source's current library did not contain the object, use a
            // matching object from the configured scan scope before marking it
            // unresolved. Ambiguous matches can be made explicit by the live
            // provider later when it has QSYS2 library-list metadata.
            return definitions.find((definition) => (
                normalizeName(definition.name) === name
                && (rawType === '*UNKNOWN' || normalizeType(definition.type) === rawType)
            ));
        };

        const ensureNode = (
            rawName: string,
            rawLibrary: string,
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

            const node: AnalysisObjectNode = {
                id: objectId(rawLibrary, rawName, rawType),
                name: normalizeName(rawName),
                library: normalizeName(rawLibrary),
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
                    reference.targetLibrary
                        || (['*SRVPGM', '*MODULE'].includes(reference.targetType) ? '' : definition.library),
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
        const selectedSource = sourceFiles.find((file) => (
            file.library === requestLibrary
            && toRelativePath(file.relativePath) === toRelativePath(
                request.relativePath
                    .split('/')
                    .slice((request.relativePath.split('/').findIndex((part) => normalizeName(part) === requestLibrary)) + 1)
                    .join('/')
            )
        ));
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
        if (selectedSource && !root.sourcePath) {
            root.sourcePath = selectedSource.relativePath;
        }
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
