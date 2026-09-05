export type AnalysisObjectType =
    | '*PGM'
    | '*SRVPGM'
    | '*MODULE'
    | '*FILE'
    | '*DTAQ'
    | '*DTAARA'
    | '*ENVVAR'
    | '*JOBD'
    | '*JOBQ'
    | '*SBS'
    | '*CMD'
    | '*COPY'
    | '*UNKNOWN';

export type AnalysisRelationship =
    | 'calls'
    | 'uses'
    | 'reads'
    | 'writes'
    | 'includes'
    | 'submits'
    | 'binds'
    | 'runs-in'
    | 'references'
    | 'configured-by'
    | 'unknown';

export type AnalysisEvidence = 'catalog' | 'compiled' | 'source' | 'runtime' | 'demo-fixture' | 'inferred';
export type AnalysisConfidence = 'confirmed' | 'likely' | 'possible' | 'unresolved';
export type AnalysisFileKind = 'directory' | 'source' | 'database' | 'metadata' | 'other';
export type ObjectAnalysisSource = 'local' | 'ibmi';
export type ObjectAnalysisLibraryListSource = 'setup-file' | 'detected' | 'environment';
export const IBM_I_NAME_MAX_LENGTH = 10;

export interface ObjectAnalysisLibraryListInfo {
    libraries: string[];
    masterLibrary?: string;
    source: ObjectAnalysisLibraryListSource;
    fileName?: string;
}

export interface ObjectAnalysisSettings {
    source: ObjectAnalysisSource;
    localDirectory: string;
    /** Ordered object lookup precedence. The first library wins for an unqualified reference. */
    libraryList: string[];
    /** Backward-compatible alias retained for older persisted settings and callers. */
    libraries: string[];
    /** Source library used to load members on a live IBM i connection. */
    sourceLibrary: string | null;
    dependencyDepth: number;
    maxNodes: number;
    cacheSourceLocally: boolean;
}

export const DEFAULT_OBJECT_ANALYSIS_SETTINGS: ObjectAnalysisSettings = {
    source: 'local',
    localDirectory: '',
    libraryList: ['ORDERLIB', 'COMMONLIB', 'INVENTORY'],
    libraries: ['ORDERLIB', 'COMMONLIB', 'INVENTORY'],
    sourceLibrary: null,
    dependencyDepth: 2,
    maxNodes: 100,
    cacheSourceLocally: false
};

/** Converts the compact library-list input into a normalized, unique scope. */
export function parseObjectAnalysisLibraryList(value: string | string[]) {
    const entries = Array.isArray(value) ? value : value.split(',');
    return Array.from(new Set(
        entries
            .map((library) => String(library || '').trim().toUpperCase())
            .filter(Boolean)
    ));
}

/** IBM i library, source-file, and member names are limited to ten characters. */
export function isValidIbmiName(value: string) {
    return /^[A-Z0-9_$#@]{1,10}$/i.test(value.trim());
}

export interface AnalysisFileNode {
    id: string;
    name: string;
    relativePath: string;
    kind: AnalysisFileKind;
    library?: string;
    language?: string;
    analyzable?: boolean;
    children?: AnalysisFileNode[];
}

export interface AnalysisLibrarySummary {
    name: string;
    relativePath: string;
    sourceFiles: number;
    databaseFiles: number;
    objectCount: number;
    selected: boolean;
}

export interface ObjectAnalysisWorkspace {
    source: 'demo' | 'live';
    rootLabel: string;
    rootPath: string;
    masterLibrary: string;
    scannedAt: string;
    libraries: AnalysisLibrarySummary[];
    tree: AnalysisFileNode;
    sourceFileCount: number;
    databaseFileCount: number;
}

export interface AnalysisObjectNode {
    id: string;
    name: string;
    library: string;
    type: AnalysisObjectType;
    language?: string;
    sourcePath?: string;
    description?: string;
    status: 'known' | 'unresolved' | 'not-observed';
    attributes: Record<string, string | number | boolean | null>;
}

export interface DependencyEdge {
    id: string;
    from: string;
    to: string;
    relationship: AnalysisRelationship;
    evidence: AnalysisEvidence;
    confidence: AnalysisConfidence;
    line?: number;
    detail?: string;
}

export interface AnalysisReadiness {
    status: 'ready' | 'review' | 'blocked' | 'insufficient-evidence';
    label: string;
    score: number;
    blockers: string[];
    warnings: string[];
    confirmed: string[];
}

export type ObjectAnalysisCommandStatus = 'collected' | 'not-supported' | 'failed';

export interface ObjectAnalysisCommandEvidence {
    name: string;
    command: string;
    status: ObjectAnalysisCommandStatus;
    rowCount: number;
    detail?: string;
}

/** Describes where the factual dependency evidence in a report came from. */
export interface ObjectAnalysisSystemEvidence {
    source: 'ibmi-commands' | 'local-source';
    collectedAt: string;
    commands: ObjectAnalysisCommandEvidence[];
    notes: string[];
}

export interface ObjectAnalysisAiReport {
    content: string;
    providerLabel: string;
    model: string;
    generatedAt: string;
}

export type ProgramFlowKind =
    | 'entry'
    | 'procedure'
    | 'condition'
    | 'loop'
    | 'data-read'
    | 'data-write'
    | 'program-call'
    | 'service-call'
    | 'batch-submit'
    | 'runtime-resource'
    | 'screen-io'
    | 'error-path'
    | 'transaction'
    | 'exit';

export interface ProgramFlowStep {
    id: string;
    sequence: number;
    kind: ProgramFlowKind;
    title: string;
    detail: string;
    line?: number;
    sourceText?: string;
    target?: string;
}

export type BusinessLogicCategory =
    | 'validation'
    | 'input-output'
    | 'decision'
    | 'data-rule'
    | 'calculation'
    | 'transaction'
    | 'integration'
    | 'screen-behavior'
    | 'batch-flow'
    | 'error-handling';

export interface BusinessLogicFinding {
    id: string;
    category: BusinessLogicCategory;
    title: string;
    detail: string;
    confidence: AnalysisConfidence;
    evidence: 'source' | 'compiled' | 'runtime';
    line?: number;
    sourceText?: string;
}

export interface ProgramBusinessLogic {
    summary: string;
    findings: BusinessLogicFinding[];
}

export type ConversionPlanPriority = 'critical' | 'high' | 'medium' | 'low';

export interface ConversionPlanItem {
    id: string;
    order: number;
    phase: 'Discover' | 'Design' | 'Build' | 'Verify' | 'Cutover';
    priority: ConversionPlanPriority;
    title: string;
    action: string;
    reason: string;
    status: 'required' | 'review';
}

export interface ObjectAnalysisReportArtifact {
    key: string;
    mode: 'source-directory' | 'app-storage' | 'error';
    relativePath?: string;
    markdownPath?: string;
    mapPath?: string;
    sourceHash?: string;
    message: string;
    error?: string;
}

export interface ObjectAnalysisApproval {
    status: 'draft' | 'approved';
    approvedAt?: string;
    approvedBy?: string;
}

export interface ObjectAnalysisResult {
    source: 'demo' | 'live';
    root: AnalysisObjectNode;
    nodes: AnalysisObjectNode[];
    edges: DependencyEdge[];
    directDependencies: number;
    impactedObjects: number;
    unresolvedReferences: string[];
    sourceSignals: string[];
    readiness: AnalysisReadiness;
    businessLogic?: ProgramBusinessLogic;
    programFlow?: ProgramFlowStep[];
    conversionPlan?: ConversionPlanItem[];
    approval?: ObjectAnalysisApproval;
    reportArtifact?: ObjectAnalysisReportArtifact;
    systemEvidence?: ObjectAnalysisSystemEvidence;
    aiReport?: ObjectAnalysisAiReport;
    generatedAt: string;
    scope: {
        libraries: string[];
        sourceLibrary: string | null;
        depth: number;
        maxNodes: number;
    };
}

export type DependencyCategory =
    | 'Programs'
    | 'Service programs'
    | 'Modules'
    | 'Files'
    | 'Data queues'
    | 'Data areas'
    | 'Environment variables'
    | 'Jobs & subsystems'
    | 'Commands & copybooks'
    | 'Other';

export interface AnalyzeObjectRequest {
    library: string;
    relativePath: string;
    objectName?: string;
    objectType?: AnalysisObjectType;
}

export function normalizeObjectAnalysisSettings(
    candidate?: Partial<ObjectAnalysisSettings> | null
): ObjectAnalysisSettings {
    const libraryList = Array.isArray(candidate?.libraryList)
        ? parseObjectAnalysisLibraryList(candidate.libraryList)
        : Array.isArray(candidate?.libraries)
            ? parseObjectAnalysisLibraryList(candidate.libraries)
            : DEFAULT_OBJECT_ANALYSIS_SETTINGS.libraryList;
    const sourceLibrary = typeof candidate?.sourceLibrary === 'string'
        ? candidate.sourceLibrary.trim().toUpperCase() || null
        : DEFAULT_OBJECT_ANALYSIS_SETTINGS.sourceLibrary;
    const depth = Number(candidate?.dependencyDepth);
    const maxNodes = Number(candidate?.maxNodes);

    return {
        source: candidate?.source === 'ibmi' ? 'ibmi' : 'local',
        localDirectory: typeof candidate?.localDirectory === 'string'
            ? candidate.localDirectory.trim()
            : DEFAULT_OBJECT_ANALYSIS_SETTINGS.localDirectory,
        libraryList,
        libraries: libraryList,
        sourceLibrary,
        dependencyDepth: Number.isFinite(depth)
            ? Math.min(5, Math.max(1, Math.floor(depth)))
            : DEFAULT_OBJECT_ANALYSIS_SETTINGS.dependencyDepth,
        maxNodes: Number.isFinite(maxNodes)
            ? Math.min(500, Math.max(20, Math.floor(maxNodes)))
            : DEFAULT_OBJECT_ANALYSIS_SETTINGS.maxNodes,
        cacheSourceLocally: candidate?.cacheSourceLocally === true
    };
}

export function objectId(library: string, name: string, type: AnalysisObjectType) {
    return `${library.trim().toUpperCase()}/${name.trim().toUpperCase()}|${type}`;
}

export function classifyAnalysisFile(fileName: string): {
    kind: AnalysisFileKind;
    language?: string;
    analyzable: boolean;
} {
    const normalized = fileName.trim().toLowerCase();
    if (/\.(rpgle|sqlrpgle|rpg|rpgle)$/.test(normalized)) {
        return { kind: 'source', language: 'RPGLE', analyzable: true };
    }
    if (/\.(cl|clle)$/.test(normalized)) {
        return { kind: 'source', language: 'CLLE', analyzable: true };
    }
    if (/\.(cbl|cobol)$/.test(normalized)) {
        return { kind: 'source', language: 'COBOL', analyzable: true };
    }
    if (/\.(dds|dspf|pf|lf|sql|ddl|table|file)$/.test(normalized)) {
        const extension = normalized.split('.').pop() || 'FILE';
        return { kind: 'database', language: extension.toUpperCase(), analyzable: true };
    }
    if (/\.json$/.test(normalized)) {
        return { kind: 'metadata', analyzable: false };
    }

    return { kind: 'other', analyzable: false };
}

/** Keeps dependency reports readable by grouping IBM i object types by operator meaning. */
export function classifyDependencyCategory(type: AnalysisObjectType): DependencyCategory {
    switch (type) {
        case '*PGM': return 'Programs';
        case '*SRVPGM': return 'Service programs';
        case '*MODULE': return 'Modules';
        case '*FILE': return 'Files';
        case '*DTAQ': return 'Data queues';
        case '*DTAARA': return 'Data areas';
        case '*ENVVAR': return 'Environment variables';
        case '*JOBD':
        case '*JOBQ':
        case '*SBS': return 'Jobs & subsystems';
        case '*CMD':
        case '*COPY': return 'Commands & copybooks';
        default: return 'Other';
    }
}

export function formatObjectAnalysisReport(result: ObjectAnalysisResult) {
    const lines = [
        '# iMonitor Object Analysis',
        '',
        `- Root object: **${result.root.library}/${result.root.name}** (${result.root.type})`,
        `- Source: **${result.source === 'demo' ? 'Demo library' : 'IBM i'}**`,
        `- Generated: ${result.generatedAt}`,
        `- Libraries scanned: ${result.scope.libraries.join(', ') || 'None'}`,
        `- Source library: ${result.scope.sourceLibrary || 'Selected source member'}`,
        `- Dependency depth: ${result.scope.depth}`,
        `- Approval: **${result.approval?.status === 'approved' ? `Approved by ${result.approval.approvedBy || 'operator'}` : 'Draft — not approved'}**`,
        ...(result.approval?.approvedAt ? [`- Approved: ${result.approval.approvedAt}`] : []),
        ...(result.reportArtifact ? [
            `- Report map key: **${result.reportArtifact.key}**`,
            `- Structured report: ${result.reportArtifact.relativePath || 'Automatic save unavailable'}`,
            `- Source fingerprint: ${result.reportArtifact.sourceHash || 'Unavailable'}`
        ] : []),
        '',
        '## Summary',
        '',
        `- Readiness: **${result.readiness.label}** (${result.readiness.score}/100)`,
        `- Direct dependencies: ${result.directDependencies}`,
        `- Impacted objects: ${result.impactedObjects}`,
        `- Unresolved references: ${result.unresolvedReferences.length}`,
        ''
    ];

    if (result.systemEvidence) {
        lines.push(
            '## Evidence sources',
            '',
            `- Evidence mode: **${result.systemEvidence.source === 'ibmi-commands' ? 'IBM i command-backed' : 'Local source-only'}**`,
            `- Collected: ${result.systemEvidence.collectedAt}`,
            ...result.systemEvidence.notes.map((note) => `- ${note}`),
            '',
            '| Command | Status | Rows | Detail |',
            '| --- | --- | ---: | --- |',
            ...(result.systemEvidence.commands.length
                ? result.systemEvidence.commands.map((command) => `| ${command.name} | ${command.status} | ${command.rowCount} | ${command.detail || command.command} |`)
                : ['| No IBM i commands executed | not-supported | 0 | Local source analysis does not execute remote commands. |']),
            ''
        );
    }

    if (result.readiness.blockers.length) {
        lines.push('## Blockers', '', ...result.readiness.blockers.map((item) => `- ${item}`), '');
    }
    if (result.readiness.warnings.length) {
        lines.push('## Warnings', '', ...result.readiness.warnings.map((item) => `- ${item}`), '');
    }

    if (result.businessLogic) {
        lines.push(
            '## Business logic',
            '',
            result.businessLogic.summary,
            '',
            '| Category | Rule or behavior | Evidence | Confidence | Source |',
            '| --- | --- | --- | --- | --- |',
            ...(result.businessLogic.findings.length
                ? result.businessLogic.findings.map((finding) => `| ${finding.category} | ${finding.title}: ${finding.detail.replace(/\|/g, '\\|')} | ${finding.evidence} | ${finding.confidence} | ${finding.line ? `Line ${finding.line}` : 'Object evidence'} |`)
                : ['| — | No deterministic business rules were found. | source | possible | Review source manually |']),
            ''
        );
    }

    if (result.programFlow?.length) {
        lines.push(
            '## Program flow',
            '',
            '| Step | Kind | Operation | Detail | Source |',
            '| ---: | --- | --- | --- | --- |',
            ...result.programFlow.map((step) => `| ${step.sequence} | ${step.kind} | ${step.title} | ${step.detail.replace(/\|/g, '\\|')} | ${step.line ? `Line ${step.line}` : 'Program entry'} |`),
            ''
        );
    }

    const nodesById = new Map(result.nodes.map((node) => [node.id, node]));
    const groupedEdges = new Map<DependencyCategory, DependencyEdge[]>();
    result.edges.forEach((edge) => {
        const category = classifyDependencyCategory(nodesById.get(edge.to)?.type || '*UNKNOWN');
        const group = groupedEdges.get(category) || [];
        group.push(edge);
        groupedEdges.set(category, group);
    });
    const categoryOrder: DependencyCategory[] = [
        'Programs', 'Service programs', 'Modules', 'Files', 'Data queues',
        'Data areas', 'Environment variables', 'Jobs & subsystems',
        'Commands & copybooks', 'Other'
    ];
    lines.push('## Dependency inventory by category', '');
    categoryOrder.forEach((category) => {
        const edges = groupedEdges.get(category);
        if (!edges?.length) return;
        lines.push(
            `### ${category} (${edges.length})`,
            '',
            '| Object | Type | Relationship | Evidence | Confidence |',
            '| --- | --- | --- | --- | --- |',
            ...edges.map((edge) => {
                const from = nodesById.get(edge.from);
                const to = nodesById.get(edge.to);
                return `| ${from?.library}/${from?.name} → ${to?.library}/${to?.name} | ${to?.type} | ${edge.relationship} | ${edge.evidence} | ${edge.confidence} |`;
            }),
            ''
        );
    });
    if (!result.edges.length) lines.push('- No dependencies were found in the selected scope.', '');

    if (result.unresolvedReferences.length) {
        lines.push('## Unresolved references', '', ...result.unresolvedReferences.map((item) => `- ${item}`), '');
    }

    if (result.conversionPlan?.length) {
        lines.push(
            '## Conversion plan',
            '',
            '| Order | Phase | Priority | Work item | Required action | Why it matters |',
            '| ---: | --- | --- | --- | --- | --- |',
            ...result.conversionPlan.map((item) => `| ${item.order} | ${item.phase} | ${item.priority} | ${item.title} | ${item.action.replace(/\|/g, '\\|')} | ${item.reason.replace(/\|/g, '\\|')} |`),
            ''
        );
    }

    lines.push(
        '## Source signals',
        '',
        ...(result.sourceSignals.length ? result.sourceSignals.map((item) => `- ${item}`) : ['- No source signals detected.']),
        ''
    );

    if (result.aiReport?.content) {
        lines.push(
            '## Business logic · IBMEye AI',
            '',
            `- Provider: ${result.aiReport.providerLabel}`,
            `- Model: ${result.aiReport.model}`,
            `- Generated: ${result.aiReport.generatedAt}`,
            '',
            result.aiReport.content,
            ''
        );
    }

    lines.push('Generated by iMonitor from source and IBM i evidence. Confirm likely, possible, and unresolved findings before conversion.');

    return lines.join('\n');
}
