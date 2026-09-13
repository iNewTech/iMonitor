import { contextBridge, ipcRenderer } from 'electron';

interface IBMiConfig {
    id?: string;
    name: string;
    host: string;
    user: string;
    password: string;
    port: number;
    mode?: 'live' | 'dummy';
}

interface SavedConnection {
    id: string;
    name: string;
    host: string;
    user: string;
    password?: string;
    port?: number;
}

interface ConnectionState {
    isConnected: boolean;
    currentConnection: SavedConnection | null;
}

interface MonitoringState {
    active: boolean;
    interval: number;
}

interface CollectorSettings {
    enabled: boolean;
    startWithSystem: boolean;
    connectionId: string;
    intervalMs: number;
    retentionDays: number;
    maxStorageMb: number;
}

interface CollectionInventory {
    rootPath: string;
    recordCount: number;
    byteCount: number;
    oldestAt: string | null;
    newestAt: string | null;
    files: number;
    categories: Record<string, number>;
    systems: Record<string, number>;
}

interface CollectorStatus {
    state: 'disabled' | 'stopped' | 'starting' | 'running' | 'degraded';
    settings: CollectorSettings;
    health: {
        collectorStartedAt: string | null;
        lastSuccessfulPollAt: string | null;
        lastSuccessfulWriteAt: string | null;
        consecutiveWriteFailures: number;
        lastError: string | null;
    };
    lastError: string | null;
}

interface AlertSettings {
    desktopNotifications: boolean;
    watchHighCpu: boolean;
    highCpuThreshold: number;
    highCpuRecoveryPolls: number;
    watchMessageWait: boolean;
    watchLockWait: boolean;
    watchDelayWait: boolean;
    watchDequeueWait: boolean;
    watchFailedPolls: boolean;
    watchDisconnects: boolean;
    createClickUpForHighCpu: boolean;
    createClickUpForMessageWait: boolean;
    createClickUpForLockWait: boolean;
    createClickUpForDelayWait: boolean;
    createClickUpForDequeueWait: boolean;
    createClickUpForPollFailure: boolean;
}

interface EmailNotificationSettings {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    password: string;
    fromAddress: string;
    toAddresses: string;
}

interface SlackSettings {
    enabled: boolean;
    webhookUrl: string;
    channelName: string;
}

interface SmsNotificationSettings {
    enabled: boolean;
    providerName: string;
    endpoint: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'GET';
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    apiKey: string;
    apiKeyHeader: string;
    username: string;
    password: string;
    recipients: string;
    bodyFormat: 'json' | 'form' | 'text' | 'none';
    requestBodyTemplate: string;
    customHeaders: string;
    responseIdPath: string;
}

interface JiraSettings {
    enabled: boolean;
    baseUrl: string;
    username: string;
    apiToken: string;
    projectKey: string;
    issueType: string;
}

type SupportAccessPermission = 'read' | 'investigate' | 'execute';
type SupportAccessStatus = 'pending' | 'active' | 'revoked' | 'expired';

interface SupportAccessGrant {
    id: string;
    organizationId: string;
    operatorId: string;
    displayName: string;
    systemIds: string[];
    permissions: SupportAccessPermission[];
    createdBy: string;
    createdAt: string;
    expiresAt: string;
    status: SupportAccessStatus;
    acceptedAt?: string;
    revokedAt?: string;
}

interface IncidentHandoff {
    schema: 'imonitor-incident-handoff';
    version: 1;
    id: string;
    incidentId: string;
    fromOperator: string;
    toOperator: string;
    reason: string;
    pendingChecks: string[];
    responseTargetAt?: string;
    createdAt: string;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled';
    acceptedAt?: string;
    acceptedBy?: string;
}

interface MonitorAlert {
    id: string;
    incidentId?: string;
    systemId?: string;
    systemLabel?: string;
    resourceId?: string;
    occurrence?: number;
    recordVersion?: number;
    evidence?: {
        version: number;
        capturedAt: string;
        source: 'ibmi' | 'demo';
        systemId?: string;
        systemLabel?: string;
        trigger: IncidentEvidenceSnapshot;
        job: IncidentEvidenceSnapshot;
        jobLog: IncidentEvidenceSnapshot;
        messages: IncidentEvidenceSnapshot;
        queue: IncidentEvidenceSnapshot;
        subsystem: IncidentEvidenceSnapshot;
    };
    correlation?: {
        fingerprint: string;
        groupReason: string;
        suggested: boolean;
        relatedSignals: string[];
        priority: {
            score: number;
            band: 'critical' | 'high' | 'normal';
            reasons: string[];
            factors: {
                technicalSeverity: number;
                affectedJobs: number;
                workloadImpact: number;
                recurrence: number;
                workflow: number;
                businessImpact: number;
            };
            businessImpactMapped: boolean;
        };
    };
    lifecyclePhase?: 'detected' | 'acknowledged' | 'investigating' | 'awaiting_escalation' | 'verifying' | 'resolved' | 'reopened';
    kind: 'highCpu' | 'messageWait' | 'lockWait' | 'delayWait' | 'dequeueWait' | 'pollFailure';
    severity: 'critical' | 'warning';
    timestamp: string;
    lastSeenAt?: string;
    resolvedAt?: string;
    resolutionSource?: 'automatic' | 'manual_recheck';
    recoveryPollCount?: number;
    isActive?: boolean;
    title: string;
    message: string;
    detail?: string;
    jobName?: string;
    workflowStatus: 'new' | 'acknowledged' | 'claimed' | 'work_done' | 'system_cleared';
    owner?: string;
    notes: Array<{
        id: string;
        timestamp: string;
        author?: string;
        text: string;
    }>;
    timeline: Array<{
        id: string;
        version?: number;
        timestamp: string;
        action: string;
        label: string;
        actor?: string;
        detail?: string;
    }>;
    workflowUpdatedAt: string;
    lastActionSummary?: string;
    clickUpTask?: {
        id: string;
        url?: string;
        name?: string;
    };
    jiraIssue?: {
        id: string;
        key: string;
        url: string;
    };
    handoff?: IncidentHandoff;
}

interface IncidentEvidenceSnapshot {
    status: 'captured' | 'missing' | 'stale' | 'permission-denied' | 'unavailable';
    collectedAt: string;
    source: 'ibmi' | 'demo' | 'monitoring-poll';
    recordCount: number;
    records: Array<Record<string, unknown>>;
    detail?: string;
}

interface MonitoringSnapshot {
    timestamp: string;
    totalJobs: number;
    peakCpu: number;
    runningJobs: number;
    waitingJobs: number;
    messageWaitJobs: number;
    lockWaitJobs: number;
    highCpuJobs: number;
}

interface JobDetailsPayload {
    job: Record<string, unknown>;
    statusHistory: Array<{
        timestamp: string;
        status: string;
        label: string;
    }>;
    waitReason: string;
    response: {
        schema: 'imonitor-incident-response';
        version: 1;
        generatedAt: string;
        incidentKey: string;
        jobName: string;
        incidentTitle: string;
        step: 'respond' | 'investigate' | 'resolve';
        impactLabel: 'Critical' | 'High' | 'Normal';
        impactSummary: string;
        owner: string;
        status: string;
        nextCheck: string;
        evidence: Array<{ label: string; status: string; recordCount: number }>;
        completedChecks: string[];
        unsuccessfulAttempts: string[];
        unresolvedQuestions: string[];
        escalationReason: string;
        businessImpact: {
            mapped: boolean;
            serviceName?: string;
            owner?: string;
            mappingId?: string;
            matchedBy?: string;
            deadlineState: 'on_track' | 'at_risk' | 'overdue' | 'not_configured' | 'unknown';
            deadlineAt?: string;
            scheduleState: 'expected' | 'outside_expected_window' | 'not_configured' | 'unknown';
            summary: string;
        };
        runbook?: {
            schema: 'imonitor-runbook-policy';
            version: 1;
            id: string;
            scenario: 'messageWait' | 'lockWait' | 'highCpu' | 'disconnect';
            title: string;
            requiredEvidence: string[];
            safeActions: string[];
            verification: string;
            escalation: string;
        };
        handoff?: IncidentHandoff;
        routing?: {
            rule: {
                id: string;
                incidentKinds: Array<'highCpu' | 'messageWait' | 'lockWait' | 'delayWait' | 'dequeueWait' | 'pollFailure'>;
                minimumSeverity: 'critical' | 'warning';
                requiredSkills: string[];
                slaMinutes: number;
                priority: number;
            };
            recommendedOperator?: { operatorId: string; displayName: string };
            eligibleOperatorCount: number;
            sla: {
                state: 'on_track' | 'at_risk' | 'overdue';
                startedAt: string;
                dueAt: string;
                minutesRemaining: number;
                targetMinutes: number;
            };
            reasons: string[];
            escalationReasons: string[];
        };
    } | null;
    guidance: {
        severity: 'info' | 'warning' | 'critical';
        headline: string;
        impact: string;
        likelyCause: string;
        nextSteps: string[];
        technicalSummary: string;
    };
    actions: Array<{
        kind: 'replyMessage' | 'holdJob' | 'releaseJob' | 'endJob' | 'inspectLocks';
        label: string;
        enabled: boolean;
        dangerous?: boolean;
        reason?: string;
    }>;
}

interface RunbookDefinitionPayload {
    schema: 'imonitor-runbook';
    version: 1;
    id: string;
    policyId: string;
    scenario: 'messageWait' | 'lockWait' | 'highCpu' | 'disconnect';
    title: string;
    systemId: string;
    jobName: string;
    incidentKey: string;
    evidenceVersion: number;
    requiredPermission: 'job-action';
    rollback: string;
    steps: Array<{
        id: string;
        title: string;
        kind: 'check' | 'action' | 'verify';
        requiredEvidence: string[];
        action?: string;
        confirmationRequired: boolean;
        expectedOutcome: string;
        stopCondition: string;
    }>;
}

interface RunbookExecutionPayload {
    schema: 'imonitor-runbook-execution';
    version: 1;
    id: string;
    runbookId: string;
    systemId: string;
    jobName: string;
    incidentKey: string;
    evidenceVersion: number;
    operator: string;
    status: 'ready' | 'running' | 'paused' | 'succeeded' | 'failed' | 'escalated';
    currentStepIndex: number;
    steps: Array<{
        stepId: string;
        status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
        operator?: string;
        startedAt?: string;
        completedAt?: string;
        input?: Record<string, string>;
        output?: string;
        outcome?: 'recovered' | 'still-blocked' | 'failed' | 'unknown' | 'succeeded';
    }>;
    createdAt: string;
    updatedAt: string;
    outcome?: {
        status: 'recovered' | 'still-blocked' | 'failed' | 'unknown';
        summary: string;
        observedAt: string;
        evidence: string[];
    };
}

interface JobContextPayload {
    success: boolean;
    error?: string;
    jobInfo?: Record<string, unknown> | null;
    jobQueue?: Record<string, unknown> | null;
    subsystem?: Record<string, unknown> | null;
}

interface BusinessServiceSettingsPayload {
    mappings: Array<{
        id: string;
        serviceName: string;
        owner: string;
        systemIds: string[];
        alertKinds: string[];
        jobPattern?: string;
        resourcePattern?: string;
        queuePattern?: string;
        subsystemPattern?: string;
        priority: number;
        deadlineMinutes?: number;
        expectedSchedule?: { timezone: string; days: number[]; startMinute: number; endMinute: number };
    }>;
}

interface ResolutionMemoryEntryPayload {
    id: string;
    procedureKey: string;
    version: number;
    status: 'draft' | 'approved' | 'retired';
    systemId: string;
    serviceName?: string;
    incidentKind: string;
    incidentFingerprint?: string;
    jobPattern?: string;
    title: string;
    symptoms: string[];
    evidenceRefs: string[];
    failedAttempts: string[];
    successfulAction: string;
    verifiedOutcome: string;
    environment: { systemLabel?: string; jobType?: string; subsystem?: string };
    reviewer?: string;
    createdAt: string;
    approvedAt?: string;
    retiredAt?: string;
    reviewDueAt?: string;
    supersedesId?: string;
}

interface ProblemRecordPayload {
    schema: 'imonitor-problem-record';
    version: 1;
    id: string;
    systemId: string;
    systemLabel?: string;
    status: 'candidate' | 'confirmed' | 'resolved' | 'reopened';
    title: string;
    incidentKind: string;
    jobPattern: string;
    environment: { jobType?: string; subsystem?: string };
    occurrences: Array<{
        incidentId: string;
        occurrence: number;
        jobName: string;
        title: string;
        kind: string;
        fingerprint?: string;
        timestamp: string;
        evidence: string[];
        environment: { jobType?: string; subsystem?: string };
    }>;
    rootCause?: string;
    workaround?: string;
    linkedTicket?: { provider: string; key: string; url?: string };
    createdAt: string;
    updatedAt: string;
    confirmedBy?: string;
    confirmedAt?: string;
    resolvedBy?: string;
    resolvedAt?: string;
}

interface ProblemMatchPayload {
    recordId: string;
    score: number;
    reasons: string[];
}

interface ReplayScenarioPayload {
    schema: 'imonitor-replay-scenario';
    version: 1;
    id: string;
    title: string;
    kind: string;
    description: string;
    evidence: Array<{ source: string; status: 'captured' | 'missing' | 'stale'; summary: string }>;
    checks: Array<{ id: string; label: string; expected: string }>;
    permittedResponses: string[];
    expectedOutcome: string;
    expectedSummary: string;
}

interface ReplayResultPayload {
    schema: 'imonitor-replay-result';
    version: 1;
    scenarioId: string;
    response: string;
    outcome: string;
    checks: Array<{ id: string; label: string; status: 'passed' | 'failed' | 'blocked'; detail: string }>;
    evidence: ReplayScenarioPayload['evidence'];
    summary: string;
    trainingOnly: true;
    executedLiveAction: false;
}

interface ResourceGraphPayload {
    success: boolean;
    error?: string;
    graph?: {
        schema: 'imonitor-resource-graph';
        version: 1;
        observedAt: string;
        stale: boolean;
        nodes: Array<{ id: string; label: string; kind: string; detail?: string; evidence: Array<{ kind: string; label: string; observedAt: string }> }>;
        edges: Array<{ id: string; from: string; to: string; relationship: string; confidence: 'observed'; evidence: Array<{ kind: string; label: string; observedAt: string }> }>;
        notes: string[];
    } | null;
}

interface JobLogPayload {
    success: boolean;
    error?: string;
    records: Array<Record<string, unknown>>;
}

interface JobQueueRecord {
    JOB_QUEUE_NAME: string;
    JOB_QUEUE_LIBRARY: string;
    JOB_QUEUE_STATUS: string;
    SUBSYSTEM_NAME: string | null;
    SUBSYSTEM_LIBRARY_NAME: string | null;
    SEQUENCE_NUMBER: number | null;
    OPERATOR_CONTROLLED: string | null;
    WAITING_JOBS: number;
    ACTIVE_JOBS: number | null;
    MAX_ACTIVE_JOBS: number | null;
    HELD_JOBS: number | null;
    TEXT_DESCRIPTION: string | null;
    OLDEST_WAIT_TIME: string | null;
}

interface QueuedJobRecord {
    JOB_NAME: string;
    JOB_NAME_SHORT: string | null;
    JOB_NUMBER: string | null;
    JOB_USER: string | null;
    JOB_STATUS: string | null;
    JOB_TYPE: string | null;
    JOB_TYPE_ENHANCED: string | null;
    JOB_QUEUE_NAME: string;
    JOB_QUEUE_LIBRARY: string;
    JOB_QUEUE_STATUS: string | null;
    JOB_QUEUE_PRIORITY: number | string | null;
    JOB_QUEUE_TIME: string | null;
    JOB_ENTERED_SYSTEM_TIME: string | null;
    SUBSYSTEM: string | null;
    SUBSYSTEM_LIBRARY_NAME: string | null;
}

interface JobQueuePage<T> {
    success: boolean;
    data: T[];
    hasMore: boolean;
    nextCursor: string | null;
    error?: string;
}

interface QueueTriageResult {
    queueKey: string;
    queueName: string;
    queueLibrary: string;
    status: 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | 'clear';
    updatedAt: string;
    waitingJobs: number;
    subsystemName: string | null;
    checks: Array<{ id: string; status: string; summary: string; recordCount: number; }>;
    expectedOutcome: string;
    stopReason: string;
    proposedNextSteps: string[];
}

interface RecoveryVerificationResult {
    status: 'recovered' | 'still-blocked' | 'failed' | 'unknown';
    summary: string;
    observedAt: string;
    evidence: string[];
}

interface ConnectionTestStatus {
    status: 'testing' | 'success' | 'failed';
    message: string;
    detail?: string;
}

interface DeploymentStatus {
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    detail?: string;
}

interface ConnectionActionStatus {
    message: string;
    detail?: string;
}

interface ThemeOption {
    id: 'operator-light' | 'night-console' | 'paper-terminal';
    label: string;
    description: string;
}

interface ThemeSettings {
    themeId: ThemeOption['id'];
    themes: ThemeOption[];
}

type AnalysisFileKind = 'directory' | 'source' | 'database' | 'metadata' | 'other';
type AnalysisObjectType = '*PGM' | '*SRVPGM' | '*MODULE' | '*FILE' | '*DTAQ' | '*DTAARA' | '*ENVVAR' | '*JOBD' | '*JOBQ' | '*SBS' | '*CMD' | '*COPY' | '*UNKNOWN';
type AnalysisRelationship = 'calls' | 'uses' | 'reads' | 'writes' | 'includes' | 'submits' | 'binds' | 'runs-in' | 'references' | 'configured-by' | 'unknown';

interface ObjectAnalysisSettings {
    source: 'local' | 'ibmi';
    localDirectory: string;
    libraryList: string[];
    libraries: string[];
    sourceLibrary: string | null;
    dependencyDepth: number;
    maxNodes: number;
    cacheSourceLocally: boolean;
}

interface AnalysisFileNode {
    id: string;
    name: string;
    relativePath: string;
    kind: AnalysisFileKind;
    library?: string;
    language?: string;
    analyzable?: boolean;
    children?: AnalysisFileNode[];
}

interface ObjectAnalysisWorkspace {
    source: 'demo' | 'live';
    rootLabel: string;
    rootPath: string;
    masterLibrary: string;
    scannedAt: string;
    libraries: Array<{
        name: string;
        relativePath: string;
        sourceFiles: number;
        databaseFiles: number;
        objectCount: number;
        selected: boolean;
    }>;
    tree: AnalysisFileNode;
    sourceFileCount: number;
    databaseFileCount: number;
}

interface ObjectAnalysisNode {
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

interface ObjectAnalysisResult {
    source: 'demo' | 'live';
    root: ObjectAnalysisNode;
    nodes: ObjectAnalysisNode[];
    edges: Array<{
        id: string;
        from: string;
        to: string;
        relationship: AnalysisRelationship;
        evidence: 'catalog' | 'compiled' | 'source' | 'runtime' | 'demo-fixture' | 'inferred';
        confidence: 'confirmed' | 'likely' | 'possible' | 'unresolved';
        line?: number;
        detail?: string;
    }>;
    directDependencies: number;
    impactedObjects: number;
    unresolvedReferences: string[];
    sourceSignals: string[];
    readiness: {
        status: 'ready' | 'review' | 'blocked' | 'insufficient-evidence';
        label: string;
        score: number;
        blockers: string[];
        warnings: string[];
        confirmed: string[];
    };
    systemEvidence?: {
        source: 'ibmi-commands' | 'local-source';
        collectedAt: string;
        commands: Array<{
            name: string;
            command: string;
            status: 'collected' | 'not-supported' | 'failed';
            rowCount: number;
            detail?: string;
        }>;
        notes: string[];
    };
    aiReport?: {
        content: string;
        providerLabel: string;
        model: string;
        generatedAt: string;
    };
    businessLogic?: {
        summary: string;
        findings: Array<{
            id: string;
            category: 'validation' | 'input-output' | 'decision' | 'data-rule' | 'calculation' | 'transaction' | 'integration' | 'screen-behavior' | 'batch-flow' | 'error-handling';
            title: string;
            detail: string;
            confidence: 'confirmed' | 'likely' | 'possible' | 'unresolved';
            evidence: 'source' | 'compiled' | 'runtime';
            line?: number;
            sourceText?: string;
        }>;
    };
    programFlow?: Array<{
        id: string;
        sequence: number;
        kind: 'entry' | 'procedure' | 'condition' | 'loop' | 'data-read' | 'data-write' | 'program-call' | 'service-call' | 'batch-submit' | 'runtime-resource' | 'screen-io' | 'error-path' | 'transaction' | 'exit';
        title: string;
        detail: string;
        line?: number;
        sourceText?: string;
        target?: string;
    }>;
    conversionPlan?: Array<{
        id: string;
        order: number;
        phase: 'Discover' | 'Design' | 'Build' | 'Verify' | 'Cutover';
        priority: 'critical' | 'high' | 'medium' | 'low';
        title: string;
        action: string;
        reason: string;
        status: 'required' | 'review';
    }>;
    approval?: {
        status: 'draft' | 'approved';
        approvedAt?: string;
        approvedBy?: string;
    };
    reportArtifact?: {
        key: string;
        mode: 'source-directory' | 'app-storage' | 'error';
        relativePath?: string;
        markdownPath?: string;
        mapPath?: string;
        sourceHash?: string;
        message: string;
        error?: string;
    };
    compilePlan?: {
        schema: 'imonitor-object-compile-plan';
        version: 1;
        generatedAt: string;
        root: { library: string; name: string; type: AnalysisObjectType; sourcePath?: string; language?: string; };
        libraryList: string[];
        steps: Array<{
            id: string;
            sequence: number;
            phase: string;
            object: { library: string; name: string; type: AnalysisObjectType; sourcePath?: string; language?: string; };
            command: string;
            reason: string;
            status: 'ready' | 'review';
        }>;
        reviewItems: string[];
        clCommands: string;
        artifact?: {
            key: string;
            mode: 'source-directory' | 'app-storage' | 'error';
            relativePath?: string;
            clPath?: string;
            message: string;
            error?: string;
        };
    };
    generatedAt: string;
    scope: { libraries: string[]; sourceLibrary: string | null; depth: number; maxNodes: number; };
}

interface AnalyzeObjectRequest {
    library: string;
    relativePath: string;
    objectName?: string;
    objectType?: AnalysisObjectType;
}

interface AiAssistantSettings {
    enabled: boolean;
    provider: 'ollama' | 'openai' | 'anthropic' | 'grok';
    endpoint: string;
    model: string;
    apiKey: string;
    temperature: number;
    replyStyle: string;
    historyLimit: number;
    activityLimit: number;
    jobLimit: number;
    alertLimit: number;
}

interface AiAssistantAvailability {
    enabled: boolean;
    provider: AiAssistantSettings['provider'];
    providerLabel: string;
    providerFamily: 'ollama' | 'openai-compatible' | 'anthropic';
    endpoint: string;
    selectedModel: string | null;
    availableModels: string[];
    healthy: boolean;
    featureAccess: 'included';
    message: string;
}

interface AiAssistantMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface AiProviderCatalogEntry {
    id: AiAssistantSettings['provider'];
    label: string;
    family: AiAssistantAvailability['providerFamily'];
    defaultEndpoint: string;
    requiresApiKey: boolean;
    description: string;
    setupTitle: string;
    symbol: string;
    docsLabel: string;
    authLabel: string;
    endpointLabel: string;
    apiKeyLabel: string;
    modelLabel: string;
    helper: string;
    setupSteps: string[];
    suggestedModels: string[];
    defaultModel: string;
}

interface AppInfo {
    appName: string;
    appVersion: string;
    supportEmail: string;
}

interface EntitlementState {
    plan: 'free' | 'premium';
    source: 'free' | 'development-license' | 'development-override';
    licenseKey?: string;
    expiresAt?: string;
    features: Record<string, boolean>;
}

contextBridge.exposeInMainWorld('electronAPI', {
    navigateToMonitor: () => ipcRenderer.invoke('navigate-to-monitor'),
    navigateToConnection: () => ipcRenderer.invoke('navigate-to-connection'),
    navigateToKnowledge: () => ipcRenderer.invoke('navigate-to-knowledge'),
    navigateToSettings: () => ipcRenderer.invoke('navigate-to-settings'),
    navigateToObjectAnalysis: () => ipcRenderer.invoke('navigate-to-object-analysis'),
    getKnowledgeLibrary: () => ipcRenderer.invoke('get-knowledge-library') as Promise<{
        success: boolean;
        records: Array<Record<string, unknown>>;
        excluded: Array<{ recordId: string; reason: string }>;
        stats?: Record<string, unknown>;
        error?: string;
    }>,
    searchKnowledge: (query: string, limit?: number) => ipcRenderer.invoke('search-knowledge', query, limit) as Promise<{
        success: boolean;
        records: Array<Record<string, unknown>>;
        excluded: Array<{ recordId: string; reason: string }>;
        error?: string;
    }>,
    getKnowledgeRecord: (recordId: string) => ipcRenderer.invoke('get-knowledge-record', recordId) as Promise<{
        success: boolean;
        record?: Record<string, unknown>;
        history?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    addKnowledgeSource: (payload: {
        sourceName: string;
        sourceType?: 'incident' | 'evidence' | 'job' | 'runbook' | 'resolution' | 'object-analysis' | 'operator-guide' | 'integration-history';
        fileName?: string;
        content: string;
    }) => ipcRenderer.invoke('add-knowledge-source', payload) as Promise<{
        success: boolean;
        result?: Record<string, unknown>;
        stats?: Record<string, unknown>;
        error?: string;
    }>,
    deleteKnowledgeRecord: (recordId: string) => ipcRenderer.invoke('delete-knowledge-record', recordId) as Promise<{
        success: boolean;
        deletedCount?: number;
        stats?: Record<string, unknown>;
        error?: string;
    }>,
    reindexKnowledge: () => ipcRenderer.invoke('reindex-knowledge') as Promise<{
        success: boolean;
        stats?: Record<string, unknown>;
        error?: string;
    }>,
    getKnowledgeStats: () => ipcRenderer.invoke('get-knowledge-stats') as Promise<{
        success: boolean;
        stats?: Record<string, unknown>;
        error?: string;
    }>,
    getKnowledgeIndexSettings: () => ipcRenderer.invoke('get-knowledge-index-settings') as Promise<{
        success: boolean;
        settings?: { backend: string; endpoint: string; collection: string; apiKeyConfigured: boolean };
        catalog?: Array<{ backend: string; label: string; description: string; available: boolean }>;
        health?: { backend: string; state: string; message: string; checkedAt: string; fallbackUsed?: boolean };
        error?: string;
    }>,
    saveKnowledgeIndexSettings: (settings: { backend: string; endpoint: string; collection: string; apiKey?: string }) => (
        ipcRenderer.invoke('save-knowledge-index-settings', settings) as Promise<{
            success: boolean;
            settings?: { backend: string; endpoint: string; collection: string; apiKeyConfigured: boolean };
            catalog?: Array<{ backend: string; label: string; description: string; available: boolean }>;
            health?: { backend: string; state: string; message: string; checkedAt: string; fallbackUsed?: boolean };
            error?: string;
        }>
    ),
    testKnowledgeIndexConnection: () => ipcRenderer.invoke('test-knowledge-index-connection') as Promise<{
        success: boolean;
        health?: { backend: string; state: string; message: string; checkedAt: string; fallbackUsed?: boolean };
        error?: string;
    }>,
    getMcpRegistry: () => ipcRenderer.invoke('get-mcp-registry') as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    installMcpCapability: (manifest: Record<string, unknown>) => ipcRenderer.invoke('install-mcp-capability', manifest) as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    configureMcpCapability: (payload: { id: string; endpoint: string }) => ipcRenderer.invoke('configure-mcp-capability', payload) as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    setMcpCapabilityEnabled: (payload: { id: string; enabled: boolean }) => ipcRenderer.invoke('set-mcp-capability-enabled', payload) as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    testMcpCapability: (id: string) => ipcRenderer.invoke('test-mcp-capability', id) as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    revokeMcpCapability: (id: string) => ipcRenderer.invoke('revoke-mcp-capability', id) as Promise<{
        success: boolean;
        installed?: Array<Record<string, unknown>>;
        available?: Array<Record<string, unknown>>;
        error?: string;
    }>,
    readMcpResource: (payload: { capabilityId: string; kind: 'resource' | 'prompt'; name: string; input?: string; jobName?: string; timeoutMs?: number }) => ipcRenderer.invoke('read-mcp-resource', payload) as Promise<{
        success: boolean;
        requestId: string;
        kind?: 'resource' | 'prompt';
        name?: string;
        items: Array<Record<string, unknown>>;
        scope?: { customerScope: string; systemScope: string; jobName?: string };
        truncated?: boolean;
        error?: string;
    }>,
    openJobTaskWindow: (jobName: string) => ipcRenderer.invoke('open-job-task-window', jobName) as Promise<{ success: boolean; }>,
    openExternalUrl: (target: string) => ipcRenderer.invoke('open-external-url', target) as Promise<{ success: boolean; }>,

    getConnectionState: () => ipcRenderer.invoke('get-connection-state') as Promise<ConnectionState>,
    getAppInfo: () => ipcRenderer.invoke('get-app-info') as Promise<AppInfo>,
    getEntitlements: () => ipcRenderer.invoke('get-entitlements') as Promise<EntitlementState>,
    activateDevelopmentLicense: (key: string) => ipcRenderer.invoke('activate-development-license', key) as Promise<EntitlementState>,
    setDevelopmentPlan: (plan: 'free' | 'premium') => ipcRenderer.invoke('set-development-plan', plan) as Promise<EntitlementState>,
    getAppFlags: () => ipcRenderer.invoke('get-app-flags') as Promise<{
        demoModeEnabled: boolean;
        demoModeReason?: string;
        operatorName?: string;
        themeId: ThemeOption['id'];
        themes: ThemeOption[];
    }>,
    getThemeSettings: () => ipcRenderer.invoke('get-theme-settings') as Promise<ThemeSettings>,
    saveThemeSettings: (themeId: ThemeOption['id']) => ipcRenderer.invoke('save-theme-settings', themeId) as Promise<ThemeSettings>,
    getObjectAnalysisSettings: () => ipcRenderer.invoke('get-object-analysis-settings') as Promise<ObjectAnalysisSettings>,
    saveObjectAnalysisSettings: (settings: Partial<ObjectAnalysisSettings>) => (
        ipcRenderer.invoke('save-object-analysis-settings', settings) as Promise<ObjectAnalysisSettings>
    ),
    saveObjectAnalysisLibraryList: (libraries: string[]) => (
        ipcRenderer.invoke('save-object-analysis-library-list', libraries) as Promise<{
            success: boolean;
            fileName?: string;
            libraries?: string[];
            settings?: ObjectAnalysisSettings;
            error?: string;
        }>
    ),
    selectObjectAnalysisDirectory: () => (
        ipcRenderer.invoke('select-object-analysis-directory') as Promise<string | null>
    ),
    getObjectAnalysisLibraryList: (options?: {
        source?: ObjectAnalysisSettings['source'];
        localDirectory?: string;
    }) => ipcRenderer.invoke('get-object-analysis-library-list', options || {}) as Promise<{
        success: boolean;
        libraries?: string[];
        masterLibrary?: string;
        source?: 'setup-file' | 'detected' | 'environment';
        fileName?: string;
        error?: string;
    }>,
    getObjectAnalysisWorkspace: () => ipcRenderer.invoke('get-object-analysis-workspace') as Promise<{
        success: boolean;
        error?: string;
        source?: ObjectAnalysisWorkspace['source'];
        rootLabel?: string;
        rootPath?: string;
        masterLibrary?: string;
        scannedAt?: string;
        libraries?: ObjectAnalysisWorkspace['libraries'];
        tree?: AnalysisFileNode;
        sourceFileCount?: number;
        databaseFileCount?: number;
    }>,
    loadObjectAnalysisSource: (request: AnalyzeObjectRequest) => ipcRenderer.invoke('load-object-analysis-source', request) as Promise<{
        success: boolean;
        content?: string;
        lineCount?: number;
        error?: string;
    }>,
    analyzeObject: (request: AnalyzeObjectRequest) => ipcRenderer.invoke('analyze-object', request) as Promise<{
        success: boolean;
        result?: ObjectAnalysisResult;
        error?: string;
    }>,
    analyzeObjectWithAi: (request: AnalyzeObjectRequest, result?: ObjectAnalysisResult) => (
        ipcRenderer.invoke('analyze-object-with-ai', request, result) as Promise<{
            success: boolean;
            reply?: string;
            availability?: AiAssistantAvailability;
            result?: ObjectAnalysisResult;
            error?: string;
        }>
    ),
    approveObjectAnalysis: (request: AnalyzeObjectRequest, result: ObjectAnalysisResult) => (
        ipcRenderer.invoke('approve-object-analysis', request, result) as Promise<{
            success: boolean;
            result?: ObjectAnalysisResult;
            artifact?: ObjectAnalysisResult['reportArtifact'];
            error?: string;
        }>
    ),
    saveObjectAnalysisReport: (result: ObjectAnalysisResult) => (
        ipcRenderer.invoke('save-object-analysis-report', result) as Promise<{
            success: boolean;
            filePath?: string;
            error?: string;
        }>
    ),
    generateObjectAnalysisCompilePlan: (request: AnalyzeObjectRequest, result: ObjectAnalysisResult) => (
        ipcRenderer.invoke('generate-object-analysis-compile-plan', request, result) as Promise<{
            success: boolean;
            result?: ObjectAnalysisResult;
            compilePlan?: ObjectAnalysisResult['compilePlan'];
            error?: string;
        }>
    ),
    getAiProviderCatalog: () => ipcRenderer.invoke('get-ai-provider-catalog') as Promise<AiProviderCatalogEntry[]>,
    getAiSettings: () => ipcRenderer.invoke('get-ai-settings') as Promise<AiAssistantSettings>,
    saveAiSettings: (settings: Partial<AiAssistantSettings>) => (
        ipcRenderer.invoke('save-ai-settings', settings) as Promise<AiAssistantSettings>
    ),
    getAiAvailability: () => ipcRenderer.invoke('get-ai-availability') as Promise<AiAssistantAvailability>,
    askAiAssistant: (payload: {
        message: string;
        selectedJobName?: string;
        conversation?: AiAssistantMessage[];
        additionalContext?: string;
        scope?: 'monitor' | 'job';
    }) => ipcRenderer.invoke('ask-ai-assistant', payload) as Promise<{
        success: boolean;
        reply?: string;
        supportContext?: Record<string, unknown>;
        retrievalHealth?: {
            backend?: string;
            state?: string;
            message?: string;
            checkedAt?: string;
            fallbackUsed?: boolean;
        };
        citations?: Array<Record<string, unknown>>;
        contextPack?: {
            scope?: Record<string, unknown>;
            citations?: Array<Record<string, unknown>>;
            relevanceReasons?: Array<Record<string, unknown>>;
            freshness?: string;
            missingEvidence?: string[];
        };
        availability?: AiAssistantAvailability;
        validation?: { valid: boolean; missingSections: string[]; missingCitations?: string[]; redacted: boolean };
        error?: string;
    }>,
    getMonitoringState: () => ipcRenderer.invoke('get-monitoring-state') as Promise<MonitoringState>,
    getCollectorSettings: () => ipcRenderer.invoke('get-collector-settings') as Promise<CollectorSettings>,
    saveCollectorSettings: (settings: Partial<CollectorSettings>) => (
        ipcRenderer.invoke('save-collector-settings', settings) as Promise<CollectorStatus>
    ),
    getCollectorStatus: () => ipcRenderer.invoke('get-collector-status') as Promise<CollectorStatus>,
    getCollectionInventory: () => ipcRenderer.invoke('get-collection-inventory') as Promise<CollectionInventory>,
    previewCollectionPurge: () => ipcRenderer.invoke('preview-collection-purge') as Promise<CollectionInventory & { matchingRecordCount: number; matchingByteCount: number }>,
    purgeCollection: (confirmed: boolean) => ipcRenderer.invoke('purge-collection', { query: {}, confirmed }) as Promise<{
        success: boolean;
        error?: string;
        summary?: CollectionInventory & { matchingRecordCount: number; matchingByteCount: number };
    }>,
    contactSupport: () => ipcRenderer.invoke('contact-support') as Promise<{
        success: boolean;
        mailtoUrl?: string;
        error?: string;
    }>,
    sendSupportDiagnostics: () => ipcRenderer.invoke('send-support-diagnostics') as Promise<{
        success: boolean;
        filePath?: string;
        mailtoUrl?: string;
        error?: string;
    }>,
    getMonitoringHistory: () => ipcRenderer.invoke('get-monitoring-history') as Promise<MonitoringSnapshot[]>,
    getActiveAlerts: () => ipcRenderer.invoke('get-active-alerts') as Promise<MonitorAlert[]>,
    getSupportMetrics: (payload?: { from?: string; to?: string; timeZone?: string }) => (
        ipcRenderer.invoke('get-support-metrics', payload || {}) as Promise<{
            success: boolean;
            report: import('./features/history/support-metrics').SupportMetricsReport | null;
            error?: string;
        }>
    ),
    exportSupportMetrics: (payload?: { from?: string; to?: string; timeZone?: string }) => (
        ipcRenderer.invoke('export-support-metrics', payload || {}) as Promise<{
            success: boolean;
            canceled?: boolean;
            filePath?: string;
            error?: string;
        }>
    ),
    getClickUpSettings: () => ipcRenderer.invoke('get-clickup-settings') as Promise<{
        enabled: boolean;
        apiToken: string;
        workspaceId: string;
        workspaceName: string;
        spaceId: string;
        spaceName: string;
        listId: string;
        listName: string;
        syncComments: boolean;
        handoffStatus: string;
        activeStatus: string;
        userEmail: string;
        memberId: string;
        assigneeUserId: string;
    }>,
    saveClickUpSettings: (settings: {
        enabled?: boolean;
        apiToken?: string;
        workspaceId?: string;
        workspaceName?: string;
        spaceId?: string;
        spaceName?: string;
        listId?: string;
        listName?: string;
        syncComments?: boolean;
        handoffStatus?: string;
        activeStatus?: string;
        userEmail?: string;
        memberId?: string;
        assigneeUserId?: string;
    }) => ipcRenderer.invoke('save-clickup-settings', settings) as Promise<{
        enabled: boolean;
        apiToken: string;
        workspaceId: string;
        workspaceName: string;
        spaceId: string;
        spaceName: string;
        listId: string;
        listName: string;
        syncComments: boolean;
        handoffStatus: string;
        activeStatus: string;
        userEmail: string;
        memberId: string;
        assigneeUserId: string;
    }>,
    loadClickUpTargetOptions: () => ipcRenderer.invoke('load-clickup-target-options') as Promise<{
        workspaces: Array<{ id: string; name: string; }>;
        spaces: Array<{ id: string; name: string; }>;
        lists: Array<{ id: string; name: string; source: 'folder' | 'folderless'; folderName?: string; }>;
    }>,
    resolveClickUpAssignee: () => ipcRenderer.invoke('resolve-clickup-assignee') as Promise<{
        success: boolean;
        memberId?: string;
        userEmail?: string;
        error?: string;
    }>,
    createClickUpTaskForAlert: (alertId: string) => ipcRenderer.invoke('create-clickup-task-for-alert', alertId) as Promise<{
        success: boolean;
        reused?: boolean;
        task?: { id: string; url?: string; name?: string; };
    }>,
    updateAlertWorkflow: (payload: {
        alertId: string;
        action: 'acknowledge' | 'claim' | 'release' | 'workDone' | 'note';
        note?: string;
        owner?: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => ipcRenderer.invoke('update-alert-workflow', payload) as Promise<{
        success: boolean;
        error?: string;
    }>,
    createIncidentHandoff: (payload: {
        alertId: string;
        toOperator: string;
        reason?: string;
        pendingChecks?: string[];
        responseTargetAt?: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => ipcRenderer.invoke('create-incident-handoff', payload) as Promise<{
        success: boolean;
        handoff?: IncidentHandoff;
        updatedAt?: string;
        error?: string;
    }>,
    acceptIncidentHandoff: (payload: {
        alertId: string;
        executionId?: string;
        systemId?: string;
        expectedUpdatedAt?: string;
    }) => ipcRenderer.invoke('accept-incident-handoff', payload) as Promise<{
        success: boolean;
        handoff?: IncidentHandoff;
        updatedAt?: string;
        error?: string;
    }>,
    getAlertSettings: () => ipcRenderer.invoke('get-alert-settings') as Promise<AlertSettings>,
    getBusinessServiceSettings: () => ipcRenderer.invoke('get-business-service-settings') as Promise<BusinessServiceSettingsPayload>,
    saveBusinessServiceSettings: (settings: Partial<BusinessServiceSettingsPayload>) => (
        ipcRenderer.invoke('save-business-service-settings', settings) as Promise<BusinessServiceSettingsPayload>
    ),
    getResolutionMemory: () => ipcRenderer.invoke('get-resolution-memory') as Promise<{ success: boolean; entries: ResolutionMemoryEntryPayload[]; error?: string }>,
    saveResolutionMemoryDraft: (jobName: string) => ipcRenderer.invoke('save-resolution-memory-draft', jobName) as Promise<{ success: boolean; entry?: ResolutionMemoryEntryPayload; entries?: ResolutionMemoryEntryPayload[]; error?: string }>,
    approveResolutionMemory: (entryId: string) => ipcRenderer.invoke('approve-resolution-memory', entryId) as Promise<{ success: boolean; entry?: ResolutionMemoryEntryPayload; entries?: ResolutionMemoryEntryPayload[]; error?: string }>,
    retireResolutionMemory: (entryId: string) => ipcRenderer.invoke('retire-resolution-memory', entryId) as Promise<{ success: boolean; entry?: ResolutionMemoryEntryPayload; entries?: ResolutionMemoryEntryPayload[]; error?: string }>,
    exportResolutionMemory: () => ipcRenderer.invoke('export-resolution-memory') as Promise<{ success: boolean; export?: unknown; error?: string }>,
    getProblemWorkspace: (jobName: string) => ipcRenderer.invoke('get-problem-workspace', jobName) as Promise<{
        success: boolean;
        records: ProblemRecordPayload[];
        matches: ProblemMatchPayload[];
        currentOccurrence?: ProblemRecordPayload['occurrences'][number] | null;
        recurringSignal?: boolean;
        error?: string;
    }>,
    createProblemCandidate: (jobName: string) => ipcRenderer.invoke('create-problem-candidate', { jobName }) as Promise<{
        success: boolean; record?: ProblemRecordPayload; records?: ProblemRecordPayload[]; error?: string;
    }>,
    recordProblemOccurrence: (jobName: string, problemId: string) => ipcRenderer.invoke('record-problem-occurrence', { jobName, problemId }) as Promise<{
        success: boolean; record?: ProblemRecordPayload; records?: ProblemRecordPayload[]; error?: string;
    }>,
    confirmProblemRecord: (payload: {
        jobName: string;
        problemId: string;
        rootCause: string;
        workaround: string;
        ticketProvider?: 'clickup' | 'jira' | 'vendor' | 'github' | 'other';
        ticketKey?: string;
        ticketUrl?: string;
    }) => ipcRenderer.invoke('confirm-problem-record', payload) as Promise<{
        success: boolean; record?: ProblemRecordPayload; records?: ProblemRecordPayload[]; error?: string;
    }>,
    resolveProblemRecord: (jobName: string, problemId: string) => ipcRenderer.invoke('resolve-problem-record', { jobName, problemId }) as Promise<{
        success: boolean; record?: ProblemRecordPayload; records?: ProblemRecordPayload[]; error?: string;
    }>,
    getIncidentReplayCatalog: () => ipcRenderer.invoke('get-incident-replay-catalog') as Promise<{
        success: boolean; scenarios: ReplayScenarioPayload[]; error?: string;
    }>,
    runIncidentReplay: (scenarioId: string, response: string) => ipcRenderer.invoke('run-incident-replay', { scenarioId, response }) as Promise<{
        success: boolean; result?: ReplayResultPayload; error?: string;
    }>,
    saveAlertSettings: (settings: Partial<AlertSettings>) => (
        ipcRenderer.invoke('save-alert-settings', settings) as Promise<AlertSettings>
    ),
    getEmailNotificationSettings: () => (
        ipcRenderer.invoke('get-email-notification-settings') as Promise<EmailNotificationSettings>
    ),
    saveEmailNotificationSettings: (settings: Partial<EmailNotificationSettings>) => (
        ipcRenderer.invoke('save-email-notification-settings', settings) as Promise<EmailNotificationSettings>
    ),
    sendTestEmailNotification: () => (
        ipcRenderer.invoke('send-test-email-notification') as Promise<{ success: boolean; error?: string; }>
    ),
    getSlackSettings: () => ipcRenderer.invoke('get-slack-settings') as Promise<SlackSettings>,
    saveSlackSettings: (settings: Partial<SlackSettings>) => (
        ipcRenderer.invoke('save-slack-settings', settings) as Promise<SlackSettings>
    ),
    sendTestSlackMessage: () => (
        ipcRenderer.invoke('send-test-slack-message') as Promise<{ success: boolean; error?: string; }>
    ),
    getSmsSettings: () => ipcRenderer.invoke('get-sms-settings') as Promise<SmsNotificationSettings>,
    saveSmsSettings: (settings: Partial<SmsNotificationSettings>) => (
        ipcRenderer.invoke('save-sms-settings', settings) as Promise<SmsNotificationSettings>
    ),
    sendTestSms: () => (
        ipcRenderer.invoke('send-test-sms') as Promise<{ success: boolean; error?: string; message?: string; }>
    ),
    getJiraSettings: () => ipcRenderer.invoke('get-jira-settings') as Promise<JiraSettings>,
    saveJiraSettings: (settings: Partial<JiraSettings>) => (
        ipcRenderer.invoke('save-jira-settings', settings) as Promise<JiraSettings>
    ),
    sendTestJiraMessage: () => (
        ipcRenderer.invoke('send-test-jira-message') as Promise<{
            success: boolean;
            issue?: { id: string; key: string; url: string };
            error?: string;
        }>
    ),
    getSupportAccessGrants: () => ipcRenderer.invoke('get-support-access-grants') as Promise<{
        success: boolean;
        grants: SupportAccessGrant[];
        error?: string;
    }>,
    createSupportAccessGrant: (payload: {
        organizationId?: string;
        operatorId: string;
        displayName: string;
        systemIds: string[];
        permissions: SupportAccessPermission[];
        expiresAt: string;
    }) => ipcRenderer.invoke('create-support-access-grant', payload) as Promise<{
        success: boolean;
        grant?: SupportAccessGrant;
        error?: string;
    }>,
    acceptSupportAccessGrant: (grantId: string) => ipcRenderer.invoke('accept-support-access-grant', grantId) as Promise<{
        success: boolean;
        grant?: SupportAccessGrant;
        error?: string;
    }>,
    revokeSupportAccessGrant: (grantId: string) => ipcRenderer.invoke('revoke-support-access-grant', grantId) as Promise<{
        success: boolean;
        grant?: SupportAccessGrant;
        error?: string;
    }>,
    deployMapepire: (config: {
        host: string;
        user: string;
        password: string;
        sshPort: number;
        preferredPort: number;
        mode: 'rpm' | 'manual';
    }) => ipcRenderer.invoke('deploy-mapepire', config) as Promise<{
        success: boolean;
        port?: number;
        installPath?: string;
        logPath?: string;
        mode?: 'rpm' | 'manual';
        error?: string;
        detail?: string;
    }>,
    getJobDetails: (jobName: string) => ipcRenderer.invoke('get-job-details', jobName) as Promise<JobDetailsPayload | null>,
    getJobContext: (jobName: string) => ipcRenderer.invoke('get-job-context', jobName) as Promise<JobContextPayload>,
    getJobResourceGraph: (jobName: string) => ipcRenderer.invoke('get-job-resource-graph', jobName) as Promise<ResourceGraphPayload>,
    getJobLog: (jobName: string) => ipcRenderer.invoke('get-job-log', jobName) as Promise<JobLogPayload>,
    getJobMessages: (jobName: string) => ipcRenderer.invoke('get-job-messages', jobName) as Promise<JobLogPayload>,
    getJobQueues: (options?: {
        search?: string;
        status?: string;
        limit?: number;
        cursor?: string;
    }) => ipcRenderer.invoke('get-job-queues', options || {}) as Promise<JobQueuePage<JobQueueRecord>>,
    getJobQueueDetails: (queueName: string, queueLibrary: string) => ipcRenderer.invoke(
        'get-job-queue-details',
        { queueName, queueLibrary }
    ) as Promise<{
        success: boolean;
        queue?: Record<string, unknown> | null;
        subsystem?: Record<string, unknown> | null;
        error?: string;
    }>,
    getQueuedJobs: (options?: {
        queueName?: string;
        queueLibrary?: string;
        search?: string;
        status?: string;
        limit?: number;
        cursor?: string;
    }) => ipcRenderer.invoke('get-queued-jobs', options || {}) as Promise<JobQueuePage<QueuedJobRecord>>,
    getQueueTriage: () => ipcRenderer.invoke('get-queue-triage') as Promise<{
        success: boolean;
        results: QueueTriageResult[];
        error?: string;
    }>,
    runJobQueueAction: (payload: {
        kind: 'holdQueue' | 'releaseQueue' | 'holdQueuedJob' | 'releaseQueuedJob';
        queueName: string;
        queueLibrary: string;
        jobName?: string;
        confirmed?: boolean;
        executionId?: string;
        systemId?: string;
    }) => ipcRenderer.invoke('run-job-queue-action', payload) as Promise<{
        success: boolean;
        error?: string;
        message?: string;
        verification?: RecoveryVerificationResult;
    }>,
    runJobAction: (payload: {
        kind: 'replyMessage' | 'holdJob' | 'releaseJob' | 'endJob' | 'inspectLocks';
        jobName: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        endOption?: 'controlled' | 'immediate';
        confirmed?: boolean;
        executionId?: string;
        systemId?: string;
    }) => ipcRenderer.invoke('run-job-action', payload) as Promise<{
        success: boolean;
        error?: string;
        message?: string;
    }>,
    getVerifiedRunbook: (jobName: string) => ipcRenderer.invoke('get-verified-runbook', jobName) as Promise<{
        success: boolean;
        definition: RunbookDefinitionPayload | null;
        execution: RunbookExecutionPayload | null;
        error?: string;
    }>,
    startVerifiedRunbook: (payload: { jobName: string }) => ipcRenderer.invoke('start-verified-runbook', payload) as Promise<{
        success: boolean;
        definition?: RunbookDefinitionPayload;
        execution?: RunbookExecutionPayload;
        error?: string;
    }>,
    runVerifiedRunbookStep: (payload: {
        jobName: string;
        executionId?: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        confirmed?: boolean;
    }) => ipcRenderer.invoke('run-verified-runbook-step', payload) as Promise<{
        success: boolean;
        definition?: RunbookDefinitionPayload;
        execution?: RunbookExecutionPayload;
        message?: string;
        error?: string;
    }>,
    recheckAlert: (alertId: string) => ipcRenderer.invoke('recheck-alert', alertId) as Promise<{
        success: boolean;
        status: 'active' | 'cleared' | 'unavailable';
        alert?: MonitorAlert;
        error?: string;
    }>,
    getSystemMessages: () => ipcRenderer.invoke('get-system-messages') as Promise<{
        success: boolean;
        records: Array<Record<string, unknown>>;
        error?: string;
    }>,
    connectToSystem: (config: IBMiConfig) => ipcRenderer.invoke('connect-to-system', config),
    disconnect: () => ipcRenderer.invoke('disconnect'),
    saveConnection: (connection: IBMiConfig) => ipcRenderer.invoke('save-connection', connection),
    loadConnections: () => ipcRenderer.invoke('load-connections'),
    deleteConnection: (id: string) => ipcRenderer.invoke('delete-connection', id),

    getSystemStatus: () => ipcRenderer.invoke('get-system-status'),
    startMonitoring: (interval: number) => ipcRenderer.send('start-monitoring', interval),
    stopMonitoring: () => ipcRenderer.send('stop-monitoring'),

    onStatusUpdate: (callback: (data: any) => void) => {
        ipcRenderer.on('status-update', (_event, data) => callback(data));
    },
    onMonitoringError: (callback: (error: string) => void) => {
        ipcRenderer.on('monitoring-error', (_event, error) => callback(error));
    },
    onConnectionTestStatus: (
        callback: (status: ConnectionTestStatus) => void
    ) => {
        ipcRenderer.on('connection-test-status', (_event, status) => callback(status));
    },
    onConnectionActionStatus: (callback: (status: ConnectionActionStatus) => void) => {
        ipcRenderer.on('connection-action-status', (_event, status) => callback(status));
    },
    onConnectionsUpdated: (callback: (connections: SavedConnection[]) => void) => {
        ipcRenderer.on('connections-updated', (_event, connections) => callback(connections));
    },
    onMonitoringHistoryUpdated: (callback: (history: MonitoringSnapshot[]) => void) => {
        ipcRenderer.on('monitoring-history-updated', (_event, history) => callback(history));
    },
    onJobQueuesUpdated: (callback: (payload: {
        queueName: string;
        queueLibrary: string;
        jobName?: string;
        action: string;
    }) => void) => {
        ipcRenderer.on('job-queues-updated', (_event, payload) => callback(payload));
    },
    onQueueTriageUpdated: (callback: (results: QueueTriageResult[]) => void) => {
        ipcRenderer.on('job-queue-triage-updated', (_event, results) => callback(results));
    },
    onJobQueueActionVerification: (callback: (result: RecoveryVerificationResult) => void) => {
        ipcRenderer.on('job-queue-action-verification', (_event, result) => callback(result));
    },
    onAlertsUpdated: (callback: (alerts: MonitorAlert[]) => void) => {
        ipcRenderer.on('alerts-updated', (_event, alerts) => callback(alerts));
    },
    onAlertSettingsUpdated: (callback: (settings: AlertSettings) => void) => {
        ipcRenderer.on('alert-settings-updated', (_event, settings) => callback(settings));
    },
    onDeploymentStatus: (callback: (status: DeploymentStatus) => void) => {
        ipcRenderer.on('deployment-status', (_event, status) => callback(status));
    },
    onCollectorStatusUpdated: (callback: (status: CollectorStatus) => void) => {
        ipcRenderer.on('collector-status-updated', (_event, status) => callback(status));
    }
});
