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

interface ActivityLogEntry {
    id: string;
    timestamp: string;
    area: 'connection' | 'sql' | 'monitoring' | 'navigation' | 'storage';
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    detail?: string;
    sql?: string;
}

interface AlertSettings {
    desktopNotifications: boolean;
    watchHighCpu: boolean;
    highCpuThreshold: number;
    watchMessageWait: boolean;
    watchLockWait: boolean;
    watchFailedPolls: boolean;
    watchDisconnects: boolean;
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

interface MonitorAlert {
    id: string;
    kind: 'highCpu' | 'messageWait' | 'lockWait' | 'pollFailure';
    severity: 'critical' | 'warning';
    timestamp: string;
    lastSeenAt?: string;
    resolvedAt?: string;
    isActive?: boolean;
    title: string;
    message: string;
    detail?: string;
    jobName?: string;
    workflowStatus: 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'cleared';
    owner?: string;
    notes: Array<{
        id: string;
        timestamp: string;
        text: string;
    }>;
    timeline: Array<{
        id: string;
        timestamp: string;
        action: string;
        label: string;
        detail?: string;
    }>;
    workflowUpdatedAt: string;
    lastActionSummary?: string;
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

contextBridge.exposeInMainWorld('electronAPI', {
    navigateToMonitor: () => ipcRenderer.invoke('navigate-to-monitor'),
    navigateToConnection: () => ipcRenderer.invoke('navigate-to-connection'),

    getConnectionState: () => ipcRenderer.invoke('get-connection-state') as Promise<ConnectionState>,
    getAppFlags: () => ipcRenderer.invoke('get-app-flags') as Promise<{
        demoModeEnabled: boolean;
        demoModeReason?: string;
        themeId: ThemeOption['id'];
        themes: ThemeOption[];
    }>,
    getThemeSettings: () => ipcRenderer.invoke('get-theme-settings') as Promise<ThemeSettings>,
    saveThemeSettings: (themeId: ThemeOption['id']) => ipcRenderer.invoke('save-theme-settings', themeId) as Promise<ThemeSettings>,
    getMonitoringState: () => ipcRenderer.invoke('get-monitoring-state') as Promise<MonitoringState>,
    getActivityLog: () => ipcRenderer.invoke('get-activity-log') as Promise<ActivityLogEntry[]>,
    downloadActivityLog: () => ipcRenderer.invoke('download-activity-log') as Promise<{
        success: boolean;
        canceled?: boolean;
        filePath?: string;
    }>,
    shareActivityLog: () => ipcRenderer.invoke('share-activity-log') as Promise<{
        success: boolean;
        filePath?: string;
    }>,
    openLogsFolder: () => ipcRenderer.invoke('open-logs-folder') as Promise<{
        success: boolean;
        directoryPath?: string;
    }>,
    getMonitoringHistory: () => ipcRenderer.invoke('get-monitoring-history') as Promise<MonitoringSnapshot[]>,
    getActiveAlerts: () => ipcRenderer.invoke('get-active-alerts') as Promise<MonitorAlert[]>,
    clearAlert: (alertId: string) => ipcRenderer.invoke('clear-alert', alertId) as Promise<{
        success: boolean;
    }>,
    updateAlertWorkflow: (payload: {
        alertId: string;
        action: 'acknowledge' | 'start' | 'resolve' | 'clear' | 'note';
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
    runJobAction: (payload: {
        kind: 'replyMessage' | 'holdJob' | 'releaseJob' | 'endJob' | 'inspectLocks';
        jobName: string;
        replyText?: string;
        endOption?: 'controlled' | 'immediate';
    }) => ipcRenderer.invoke('run-job-action', payload) as Promise<{
        success: boolean;
        error?: string;
        message?: string;
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
    onActivityLog: (callback: (entry: ActivityLogEntry) => void) => {
        ipcRenderer.on('activity-log', (_event, entry) => callback(entry));
    },
    onMonitoringHistoryUpdated: (callback: (history: MonitoringSnapshot[]) => void) => {
        ipcRenderer.on('monitoring-history-updated', (_event, history) => callback(history));
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
