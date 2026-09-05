import { contextBridge, ipcRenderer } from 'electron';

interface IBMiConfig {
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

interface MonitorAlert {
    id: string;
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

interface JobContextPayload {
    success: boolean;
    error?: string;
    jobInfo?: Record<string, unknown> | null;
    jobQueue?: Record<string, unknown> | null;
    subsystem?: Record<string, unknown> | null;
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
    navigateToSettings: () => ipcRenderer.invoke('navigate-to-settings'),
    navigateToObjectAnalysis: () => ipcRenderer.invoke('navigate-to-object-analysis'),
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
    }) => ipcRenderer.invoke('ask-ai-assistant', payload) as Promise<{
        success: boolean;
        reply?: string;
        availability?: AiAssistantAvailability;
        error?: string;
    }>,
    getMonitoringState: () => ipcRenderer.invoke('get-monitoring-state') as Promise<MonitoringState>,
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
    }) => ipcRenderer.invoke('update-alert-workflow', payload) as Promise<{
        success: boolean;
    }>,
    getAlertSettings: () => ipcRenderer.invoke('get-alert-settings') as Promise<AlertSettings>,
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
    runJobQueueAction: (payload: {
        kind: 'holdQueue' | 'releaseQueue' | 'holdQueuedJob' | 'releaseQueuedJob';
        queueName: string;
        queueLibrary: string;
        jobName?: string;
        confirmed?: boolean;
    }) => ipcRenderer.invoke('run-job-queue-action', payload) as Promise<{
        success: boolean;
        error?: string;
        message?: string;
    }>,
    runJobAction: (payload: {
        kind: 'replyMessage' | 'holdJob' | 'releaseJob' | 'endJob' | 'inspectLocks';
        jobName: string;
        replyText?: string;
        messageKey?: string;
        messageQueue?: string;
        endOption?: 'controlled' | 'immediate';
        confirmed?: boolean;
    }) => ipcRenderer.invoke('run-job-action', payload) as Promise<{
        success: boolean;
        error?: string;
        message?: string;
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
    onAlertsUpdated: (callback: (alerts: MonitorAlert[]) => void) => {
        ipcRenderer.on('alerts-updated', (_event, alerts) => callback(alerts));
    },
    onAlertSettingsUpdated: (callback: (settings: AlertSettings) => void) => {
        ipcRenderer.on('alert-settings-updated', (_event, settings) => callback(settings));
    },
    onDeploymentStatus: (callback: (status: DeploymentStatus) => void) => {
        ipcRenderer.on('deployment-status', (_event, status) => callback(status));
    }
});
