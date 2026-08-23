import { app, BrowserWindow, ipcMain } from 'electron/main';
import { Notification, clipboard, dialog, safeStorage, shell } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DaemonServer } from '@ibm/mapepire-js';
import Store from 'electron-store';
import dB, {
    type ActiveJobRecord,
    type QueryResult,
    type ServiceLogEntry
} from './services/ibmi';
import {
    getDemoAvailability,
    isDemoRequest
} from './features/demo/demo-runtime';
import {
    acknowledgeAlertWorkflow,
    addAlertWorkflowNote,
    clearAlertWorkflow,
    normalizeAlertWorkflowState,
    resolveAlertWorkflow as resolveOperatorAlertWorkflow,
    startAlertWorkflow
} from './features/alerts/alert-operator-workflow';
import {
    createPollFailureAlert,
    evaluateAlertRules as evaluateAlertQueue,
    clearAlertById as dismissAlertById,
    resolveAlertById
} from './features/alerts/alert-workflow';
import {
    DEFAULT_ALERT_SETTINGS,
    normalizeAlertSettings,
    sortAlerts,
    type AlertSettings,
    type MonitorAlert,
    type StoredAlertWorkflowState
} from './features/alerts/alert-model';
import {
    WAITING_STATUSES,
    buildWaitReason,
    createMonitoringSnapshot,
    describeStatus,
    getJobKey,
    getJobTitle,
    refreshTrackedJobs as buildTrackedJobs,
    toNumber,
    type JobStatusHistoryEntry,
    type MonitoringSnapshot
} from './features/monitoring/monitoring-model';
import {
    DEFAULT_THEME_ID,
    THEME_OPTIONS,
    normalizeThemeId,
    type ThemeId
} from './features/theme/theme-model';
import {
    deployMapepire,
    type DeployMode,
    ensureMapepireAvailable,
    type MapepireDeployStatus
} from './utils/mapepire-deploy';
import {
    getDemoDataFilePath,
    readDemoSnapshot,
    writeDemoSnapshot
} from './utils/demo-system';
import {
    DEFAULT_PORT,
    findDuplicateHostUserConnection,
    hasDuplicateConnectionName,
    removeConnectionById,
    toPublicConnection,
    toRenderableConnection,
    type StoredConnection
} from './utils/connections';
import {
    needsCredentialMigration,
    protectPassword,
    revealPassword
} from './utils/password-store';

interface StoreSchema {
    connections: StoredConnection[];
    alertSettings: AlertSettings;
    alertWorkflowState: Record<string, StoredAlertWorkflowState>;
    themeId: ThemeId;
}

interface ConnectionState {
    isConnected: boolean;
    currentConnection: StoredConnection | null;
}

type MonitorMode = 'live' | 'dummy';

type ActivityLogArea = ServiceLogEntry['area'] | 'monitoring' | 'navigation' | 'storage';
interface ActivityLogEntry {
    id: string;
    timestamp: string;
    area: ActivityLogArea;
    level: ServiceLogEntry['level'];
    message: string;
    detail?: string;
    sql?: string;
}

interface JobDetailsPayload {
    job: ActiveJobRecord;
    statusHistory: JobStatusHistoryEntry[];
    waitReason: string;
}

interface ConnectionErrorPayload {
    summary: string;
    detail: string;
}

interface MapepireDeployPayload {
    host: string;
    user: string;
    password: string;
    sshPort: number;
    preferredPort: number;
    mode: DeployMode;
}

interface PersistentLogRecord {
    schemaVersion: 1;
    type: 'activity' | 'poll';
    timestamp: string;
    monitorMode: MonitorMode;
    connection: {
        name: string | null;
        host: string | null;
        user: string | null;
        port: number | null;
    };
    payload: Record<string, unknown>;
}

const DEFAULT_MONITORING_INTERVAL = 5000;
const MAX_ACTIVITY_LOG_ENTRIES = 200;
const MAX_MONITORING_HISTORY = 90;
const MAX_JOB_STATUS_HISTORY = 12;
const NOTIFICATION_COOLDOWN_MS = 120000;

const storeName = app.isPackaged ? 'connections-prod' : 'connections-dev';
const storeDirectoryOverride = process.env.IBM_EYE_STORE_DIR?.trim();

const store = new Store<StoreSchema>({
    name: storeName,
    cwd: storeDirectoryOverride || undefined,
    defaults: {
        connections: [],
        alertSettings: DEFAULT_ALERT_SETTINGS,
        alertWorkflowState: {},
        themeId: DEFAULT_THEME_ID
    }
}) as Store<StoreSchema> & {
    get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
    set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
};

let mainWindow: BrowserWindow | null = null;
let ibmiService: dB | null = null;
let monitorMode: MonitorMode = 'live';
let monitoringInterval: NodeJS.Timeout | null = null;
let lastMonitoringInterval = DEFAULT_MONITORING_INTERVAL;
let activitySequence = 0;
let dummyPollCount = 0;
let demoDataFilePath: string | null = null;
let persistentLogWriteQueue = Promise.resolve();
const dismissedAlertIds = new Set<string>();
const activityLog: ActivityLogEntry[] = [];
const notificationLedger = new Map<string, number>();
const latestJobIndex = new Map<string, ActiveJobRecord>();
const jobStatusHistory = new Map<string, JobStatusHistoryEntry[]>();
let latestJobs: ActiveJobRecord[] = [];
let monitoringHistory: MonitoringSnapshot[] = [];
let activeAlerts: MonitorAlert[] = [];
let alertWorkflowStateByAlertId = store.get('alertWorkflowState') ?? {};
let connectionState: ConnectionState = {
    isConnected: false,
    currentConnection: null
};

function getCredentialOptions() {
    return {
        safeStorage,
        encryptionKey: process.env.ENCRYPTION_KEY
    };
}

function protectStoredPassword(password: string) {
    return protectPassword(password, getCredentialOptions());
}

function decryptStoredPassword(encryptedPassword: string) {
    try {
        return revealPassword(encryptedPassword, getCredentialOptions());
    } catch (error) {
        console.warn('Unable to decrypt a saved connection password. The password field will be blank.', error);
        return '';
    }
}

function setConnectionState(connection: StoredConnection | null) {
    connectionState = {
        isConnected: Boolean(connection),
        currentConnection: connection
    };
}

function getAlertSettings() {
    const storedSettings = store.get('alertSettings');
    const normalized = normalizeAlertSettings(storedSettings);

    if (JSON.stringify(storedSettings) !== JSON.stringify(normalized)) {
        store.set('alertSettings', normalized);
    }

    return normalized;
}

function getThemeId() {
    const storedThemeId = store.get('themeId');
    const normalizedThemeId = normalizeThemeId(storedThemeId);

    if (storedThemeId !== normalizedThemeId) {
        store.set('themeId', normalizedThemeId);
    }

    return normalizedThemeId;
}

function emitAlertSettings() {
    sendToWindow('alert-settings-updated', getAlertSettings());
}

function emitDeploymentStatus(status: MapepireDeployStatus) {
    sendToWindow('deployment-status', status);
    recordActivity({
        area: 'connection',
        level: status.level === 'warning' ? 'warning' : status.level === 'error' ? 'error' : 'info',
        message: `Mapepire deploy: ${status.message}`,
        detail: status.detail
    });
}

function emitConnectionAction(message: string, detail?: string) {
    sendToWindow('connection-action-status', {
        message,
        detail
    });
}

function createIbmiService() {
    return new dB((entry: ServiceLogEntry) => {
        recordActivity(entry);
    });
}

function getLogsDirectoryPath() {
    return path.join(app.getPath('userData'), 'logs');
}

function getCurrentLogDateSegment() {
    return new Date().toISOString().slice(0, 10);
}

function getDailyLogFilePath(dateSegment = getCurrentLogDateSegment()) {
    return path.join(getLogsDirectoryPath(), `ibm-eye-${dateSegment}.log.jsonl`);
}

function getDailyReadableLogFilePath(dateSegment = getCurrentLogDateSegment()) {
    return path.join(getLogsDirectoryPath(), `ibm-eye-${dateSegment}.log`);
}

function getPersistentLogConnectionContext() {
    return {
        name: connectionState.currentConnection?.name ?? null,
        host: connectionState.currentConnection?.host ?? null,
        user: connectionState.currentConnection?.user ?? null,
        port: connectionState.currentConnection?.port ?? null
    };
}

function formatPersistentLogConnection(connection: PersistentLogRecord['connection']) {
    if (!connection.host || !connection.user) {
        return connection.name || 'no-active-connection';
    }

    const nameSegment = connection.name ? `${connection.name} ` : '';
    const portSegment = connection.port ? `:${connection.port}` : '';
    return `${nameSegment}(${connection.user}@${connection.host}${portSegment})`;
}

function buildReadableLogRecord(record: PersistentLogRecord) {
    const header = [
        `[${formatLogTimestamp(record.timestamp)}]`,
        `[${record.type.toUpperCase()}]`,
        `[${record.monitorMode.toUpperCase()}]`,
        `[${formatPersistentLogConnection(record.connection)}]`
    ].join(' ');

    if (record.type === 'activity') {
        const area = String(record.payload.area || 'unknown').toUpperCase();
        const level = String(record.payload.level || 'info').toUpperCase();
        const message = String(record.payload.message || '');
        const detail = record.payload.detail ? `\n  detail: ${String(record.payload.detail)}` : '';
        const sql = record.payload.sql
            ? `\n  sql:\n${String(record.payload.sql).split('\n').map((line) => `    ${line}`).join('\n')}`
            : '';

        return `${header} [${level}] [${area}] ${message}${detail}${sql}\n`;
    }

    const totalJobs = Number(record.payload.totalJobs || 0);
    const peakCpu = Number(record.payload.peakCpu || 0).toFixed(2);
    const waitingJobs = Number(record.payload.waitingJobs || 0);
    const messageWaitJobs = Number(record.payload.messageWaitJobs || 0);
    const lockWaitJobs = Number(record.payload.lockWaitJobs || 0);
    const intervalMs = Number(record.payload.intervalMs || 0);
    const jobs = Array.isArray(record.payload.jobs) ? record.payload.jobs as ActiveJobRecord[] : [];
    const summary = `${header} polled ${totalJobs} jobs intervalMs=${intervalMs} peakCpu=${peakCpu} waitingJobs=${waitingJobs} msgw=${messageWaitJobs} lckw=${lockWaitJobs}`;
    const topJobs = jobs.slice(0, 5).map((job) => (
        `  job: ${job.SUBSYSTEM_JOB || getJobKey(job)} status=${job.STATUS || 'UNKNOWN'} cpu=${toNumber(job.CPU).toFixed(2)} function=${job.FUNCTION_NAME || 'Unknown'}`
    ));

    return `${summary}${topJobs.length ? `\n${topJobs.join('\n')}` : ''}\n`;
}

function queuePersistentLogRecord(record: PersistentLogRecord) {
    persistentLogWriteQueue = persistentLogWriteQueue
        .then(async () => {
            const dateSegment = record.timestamp.slice(0, 10);
            const structuredLogFilePath = getDailyLogFilePath(dateSegment);
            const readableLogFilePath = getDailyReadableLogFilePath(dateSegment);
            await fs.mkdir(path.dirname(structuredLogFilePath), { recursive: true });
            await Promise.all([
                fs.appendFile(structuredLogFilePath, `${JSON.stringify(record)}\n`, 'utf8'),
                fs.appendFile(readableLogFilePath, buildReadableLogRecord(record), 'utf8')
            ]);
        })
        .catch((error) => {
            console.error('Unable to persist IBMEye log record.', error);
        });
}

function recordActivity(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
    activitySequence += 1;

    const activityEntry: ActivityLogEntry = {
        id: `${Date.now()}-${activitySequence}`,
        timestamp: new Date().toISOString(),
        ...entry
    };

    activityLog.unshift(activityEntry);
    if (activityLog.length > MAX_ACTIVITY_LOG_ENTRIES) {
        activityLog.length = MAX_ACTIVITY_LOG_ENTRIES;
    }

    sendToWindow('activity-log', activityEntry);

    queuePersistentLogRecord({
        schemaVersion: 1,
        type: 'activity',
        timestamp: activityEntry.timestamp,
        monitorMode,
        connection: getPersistentLogConnectionContext(),
        payload: {
            id: activityEntry.id,
            area: activityEntry.area,
            level: activityEntry.level,
            message: activityEntry.message,
            detail: activityEntry.detail ?? null,
            sql: activityEntry.sql ?? null
        }
    });
}

function sendToWindow(channel: string, payload: unknown) {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send(channel, payload);
}

function emitMonitoringHistory() {
    sendToWindow('monitoring-history-updated', monitoringHistory.slice());
}

function emitActiveAlerts() {
    sendToWindow('alerts-updated', activeAlerts.slice());
}

function persistAlertWorkflowState() {
    store.set('alertWorkflowState', alertWorkflowStateByAlertId);
}

function setActiveAlerts(nextAlerts: MonitorAlert[]) {
    activeAlerts = sortAlerts([...nextAlerts]);
    emitActiveAlerts();
}

function resolveAlert(alertId: string, timestamp: string, detail?: string) {
    setActiveAlerts(resolveAlertById(alertId, activeAlerts, dismissedAlertIds, timestamp, detail));
}

function clearAlertById(alertId: string) {
    setActiveAlerts(dismissAlertById(alertId, activeAlerts, dismissedAlertIds));
}

function mutateAlertWorkflow(
    alertId: string,
    mutation: (state: StoredAlertWorkflowState) => StoredAlertWorkflowState
) {
    const timestamp = new Date().toISOString();
    const currentState = normalizeAlertWorkflowState(alertWorkflowStateByAlertId[alertId], timestamp);
    const nextState = mutation(currentState);
    alertWorkflowStateByAlertId = {
        ...alertWorkflowStateByAlertId,
        [alertId]: nextState
    };
    persistAlertWorkflowState();

    setActiveAlerts(activeAlerts.map((alert) => (
        alert.id === alertId
            ? {
                ...alert,
                workflowStatus: nextState.status,
                owner: nextState.owner,
                notes: nextState.notes,
                timeline: nextState.timeline,
                workflowUpdatedAt: nextState.updatedAt,
                lastActionSummary: nextState.lastActionSummary
            }
            : alert
    )));

    return nextState;
}

function clearMonitoringTimer() {
    if (!monitoringInterval) {
        return false;
    }

    clearInterval(monitoringInterval);
    monitoringInterval = null;
    return true;
}

function normalizeRefreshInterval(interval: unknown) {
    const requestedInterval = typeof interval === 'number' ? interval : Number(interval);
    if (Number.isFinite(requestedInterval) && requestedInterval >= 1000) {
        return requestedInterval;
    }

    return DEFAULT_MONITORING_INTERVAL;
}

function describeRefreshInterval(interval: number) {
    if (interval % 60000 === 0) {
        const minutes = interval / 60000;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    const seconds = interval / 1000;
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function describeConnectionTarget(config: Pick<DaemonServer, 'host' | 'user' | 'port'>) {
    return `${config.user}@${config.host}:${config.port ?? DEFAULT_PORT}`;
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }

    return typeof error === 'string' ? error : 'Unknown error occurred';
}

function buildConnectionErrorPayload(
    error: unknown,
    context: Pick<DaemonServer, 'host' | 'user' | 'port'>
): ConnectionErrorPayload {
    const rawMessage = getErrorMessage(error);
    const normalizedMessage = rawMessage.toLowerCase();
    const target = describeConnectionTarget(context);
    let summary = 'IBMEye could not open a session to the remote IBM i system.';
    let hint = 'Review the raw error below and confirm the remote service is reachable.';

    if (normalizedMessage.includes('econnrefused') || normalizedMessage.includes('connection refused')) {
        summary = 'The remote Mapepire service refused the connection.';
        hint = 'Confirm the Mapepire daemon is running and listening on the configured port.';
    } else if (normalizedMessage.includes('timed out') || normalizedMessage.includes('etimedout')) {
        summary = 'The connection attempt timed out before the remote system responded.';
        hint = 'Check host reachability, firewall rules, VPN state, and the configured port.';
    } else if (
        normalizedMessage.includes('certificate')
        || normalizedMessage.includes('self signed')
        || normalizedMessage.includes('unable to verify')
        || normalizedMessage.includes('hostname/ip does not match certificate')
    ) {
        summary = 'TLS certificate validation failed for the remote Mapepire service.';
        hint = 'Verify the host name and confirm the remote certificate is valid for that endpoint.';
    } else if (
        normalizedMessage.includes('password')
        || normalizedMessage.includes('not authorized')
        || normalizedMessage.includes('authentication')
        || normalizedMessage.includes('credential')
        || normalizedMessage.includes('user profile')
        || normalizedMessage.includes('signon')
    ) {
        summary = 'Authentication or IBM i authority checks failed for this connection.';
        hint = 'Confirm the user profile, password, and required IBM i monitoring authority.';
    }

    return {
        summary,
        detail: [
            `Target: ${target}`,
            `Raw error: ${rawMessage}`,
            `Hint: ${hint}`
        ].join('\n')
    };
}

function truncateForNotification(value: string, maxLength = 180) {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength - 1)}…`;
}

function maybeShowNotification(key: string, title: string, body: string) {
    const settings = getAlertSettings();
    if (!settings.desktopNotifications || !Notification.isSupported()) {
        return;
    }

    const previousTimestamp = notificationLedger.get(key) ?? 0;
    const now = Date.now();
    if (now - previousTimestamp < NOTIFICATION_COOLDOWN_MS) {
        return;
    }

    notificationLedger.set(key, now);

    try {
        const notification = new Notification({
            title: truncateForNotification(title, 64),
            body: truncateForNotification(body, 200)
        });
        notification.show();
    } catch (error) {
        console.warn('Unable to show desktop notification.', error);
    }
}

function appendMonitoringSnapshot(jobs: ActiveJobRecord[], timestamp: string) {
    monitoringHistory.push(createMonitoringSnapshot(jobs, timestamp, getAlertSettings().highCpuThreshold));

    if (monitoringHistory.length > MAX_MONITORING_HISTORY) {
        monitoringHistory = monitoringHistory.slice(-MAX_MONITORING_HISTORY);
    }

    emitMonitoringHistory();
}

function persistFetchedPoll(jobs: ActiveJobRecord[], timestamp: string) {
    const peakCpu = jobs.reduce((highest, job) => Math.max(highest, toNumber(job.CPU)), 0);
    const runningJobs = jobs.filter((job) => job.STATUS === 'RUN').length;
    const waitingJobs = jobs.filter((job) => WAITING_STATUSES.has(job.STATUS || '')).length;
    const messageWaitJobs = jobs.filter((job) => job.STATUS === 'MSGW').length;
    const lockWaitJobs = jobs.filter((job) => job.STATUS === 'LCKW').length;

    queuePersistentLogRecord({
        schemaVersion: 1,
        type: 'poll',
        timestamp,
        monitorMode,
        connection: getPersistentLogConnectionContext(),
        payload: {
            intervalMs: lastMonitoringInterval,
            totalJobs: jobs.length,
            peakCpu,
            runningJobs,
            waitingJobs,
            messageWaitJobs,
            lockWaitJobs,
            jobs
        }
    });
}

function refreshTrackedJobs(jobs: ActiveJobRecord[], timestamp: string) {
    latestJobs = jobs;
    const nextTracking = buildTrackedJobs(jobs, timestamp, jobStatusHistory, MAX_JOB_STATUS_HISTORY);
    latestJobIndex.clear();
    nextTracking.latestJobIndex.forEach((job, jobKey) => {
        latestJobIndex.set(jobKey, job);
    });
    jobStatusHistory.clear();
    nextTracking.jobStatusHistory.forEach((history, jobKey) => {
        jobStatusHistory.set(jobKey, history);
    });
}

function evaluateAlertRules(jobs: ActiveJobRecord[], timestamp: string) {
    const result = evaluateAlertQueue(jobs, {
        activeAlerts,
        dismissedAlertIds,
        workflowStateByAlertId: alertWorkflowStateByAlertId,
        settings: getAlertSettings(),
        timestamp,
        notify: maybeShowNotification
    });

    alertWorkflowStateByAlertId = result.workflowStateByAlertId;
    persistAlertWorkflowState();
    setActiveAlerts(result.alerts);
}

function setPollFailureAlert(errorMessage: string) {
    const settings = getAlertSettings();
    const nextFailureAlert = createPollFailureAlert(
        errorMessage,
        activeAlerts,
        dismissedAlertIds,
        alertWorkflowStateByAlertId
    );
    if (!nextFailureAlert) {
        return;
    }
    const { alert: nextAlert, isNew, workflowState } = nextFailureAlert;

    const remainingAlerts = activeAlerts.filter((alert) => alert.id !== nextAlert.id);
    alertWorkflowStateByAlertId = {
        ...alertWorkflowStateByAlertId,
        [nextAlert.id]: workflowState
    };
    persistAlertWorkflowState();
    setActiveAlerts([nextAlert, ...remainingAlerts]);

    if (isNew && settings.watchFailedPolls) {
        maybeShowNotification(nextAlert.id, nextAlert.title, `${nextAlert.message} ${errorMessage}`);
    }
}

function clearRuntimeMonitoringState() {
    latestJobs = [];
    monitoringHistory = [];
    activeAlerts = [];
    monitorMode = 'live';
    dummyPollCount = 0;
    demoDataFilePath = null;
    latestJobIndex.clear();
    jobStatusHistory.clear();
    notificationLedger.clear();
    emitMonitoringHistory();
    emitActiveAlerts();
}

function formatLogTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toISOString();
}

function sanitizeFileSegment(value: string) {
    return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'ibm-eye';
}

function buildLogFileName() {
    const baseName = connectionState.currentConnection?.name || 'ibm-eye-session';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${sanitizeFileSegment(baseName)}-${timestamp}.log`;
}

function buildOperatorLogText() {
    const connectionLabel = connectionState.currentConnection
        ? `${connectionState.currentConnection.name} (${connectionState.currentConnection.user}@${connectionState.currentConnection.host}:${connectionState.currentConnection.port})`
        : 'No active connection';
    const logsDirectory = getLogsDirectoryPath();
    const dailyReadableLogFile = getDailyReadableLogFilePath();
    const dailyStructuredLogFile = getDailyLogFilePath();
    const historyLines = monitoringHistory.slice(-10).map((snapshot) => (
        `${formatLogTimestamp(snapshot.timestamp)} totalJobs=${snapshot.totalJobs} peakCpu=${snapshot.peakCpu.toFixed(2)} waitingJobs=${snapshot.waitingJobs} msgw=${snapshot.messageWaitJobs} lckw=${snapshot.lockWaitJobs}`
    ));

    const entryLines = activityLog.slice().reverse().flatMap((entry) => {
        const lines = [
            `[${formatLogTimestamp(entry.timestamp)}] [${entry.level.toUpperCase()}] [${entry.area.toUpperCase()}] ${entry.message}`
        ];

        if (entry.detail) {
            lines.push(`  detail: ${entry.detail}`);
        }

        if (entry.sql) {
            lines.push('  sql:');
            entry.sql.split('\n').forEach((line) => {
                lines.push(`    ${line}`);
            });
        }

        return lines;
    });

    return [
        'IBMEye Operator Log',
        `Generated: ${new Date().toISOString()}`,
        `Connection: ${connectionLabel}`,
        `Monitor mode: ${monitorMode}`,
        `Daily logs directory: ${logsDirectory}`,
        `Today readable log file: ${dailyReadableLogFile}`,
        `Today structured log file: ${dailyStructuredLogFile}`,
        `Tracked alerts: ${activeAlerts.length}`,
        `Tracked snapshots: ${monitoringHistory.length}`,
        '',
        'Recent snapshot summary:',
        ...(historyLines.length ? historyLines : ['No monitoring snapshots collected yet.']),
        '',
        'Activity entries:',
        ...(entryLines.length ? entryLines : ['No operator activity recorded yet.']),
        ''
    ].join('\n');
}

async function writeOperatorLogFile(filePath: string) {
    const logText = buildOperatorLogText();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, logText, 'utf8');
    return logText;
}

function loadConnectionPage() {
    mainWindow?.loadFile(path.join(__dirname, '../public/index.html'));
}

function loadMonitorPage() {
    mainWindow?.loadFile(path.join(__dirname, '../public/monitor.html'));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    loadConnectionPage();

    mainWindow.on('closed', () => {
        clearMonitoringTimer();
        if (ibmiService) {
            ibmiService.close();
            ibmiService = null;
        }
        setConnectionState(null);
        clearRuntimeMonitoringState();
        mainWindow = null;
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

function migrateStoredConnections() {
    const currentConnections = store.get('connections');
    let hasChanges = false;

    const migratedConnections = currentConnections.map((connection) => {
        if (!needsCredentialMigration(connection.encryptedPassword, getCredentialOptions())) {
            return connection;
        }

        const password = decryptStoredPassword(connection.encryptedPassword);
        if (!password) {
            return connection;
        }

        try {
            const nextEncryptedPassword = protectStoredPassword(password);
            if (nextEncryptedPassword === connection.encryptedPassword) {
                return connection;
            }

            hasChanges = true;
            return {
                ...connection,
                encryptedPassword: nextEncryptedPassword
            };
        } catch (error) {
            console.warn(`Unable to migrate saved credentials for "${connection.name}".`, error);
            return connection;
        }
    });

    if (hasChanges) {
        store.set('connections', migratedConnections);
    }
}

async function testConnection(config: DaemonServer) {
    const testService = createIbmiService();

    try {
        await testService.connect({
            host: config.host,
            user: config.user,
            password: config.password,
            port: config.port || DEFAULT_PORT,
            rejectUnauthorized: true
        });

        await testService.query('SELECT CURRENT_TIMESTAMP FROM SYSIBM.SYSDUMMY1');
        return { success: true as const };
    } catch (error) {
        console.error('Connection test failed:', error);
        return {
            success: false as const,
            error: buildConnectionErrorPayload(error, {
                host: config.host,
                user: config.user,
                port: config.port || DEFAULT_PORT
            })
        };
    } finally {
        testService.close();
    }
}

async function getDummySystemStatus(): Promise<QueryResult<ActiveJobRecord>> {
    if (!demoDataFilePath) {
        demoDataFilePath = getDemoDataFilePath(app.getPath('userData'));
    }

    dummyPollCount += 1;
    await writeDemoSnapshot(demoDataFilePath, dummyPollCount);
    const result = await readDemoSnapshot(demoDataFilePath);
    const jobs = Array.isArray(result.data) ? result.data : [];
    const msgwCount = jobs.filter((job) => job.STATUS === 'MSGW').length;
    const lckwCount = jobs.filter((job) => job.STATUS === 'LCKW').length;

    recordActivity({
        area: 'sql',
        level: 'info',
        message: 'Generated demo snapshot JSON for IBMEye.',
        detail: `Demo poll ${dummyPollCount} read ${jobs.length} jobs from ${demoDataFilePath}. MSGW jobs: ${msgwCount}. LCKW jobs: ${lckwCount}.`,
        sql: `-- demo mode reads generated snapshot JSON\n-- ${demoDataFilePath}`
    });

    return result;
}

async function publishSystemStatus() {
    if (monitorMode === 'dummy') {
        const result = await getDummySystemStatus();
        const jobs = Array.isArray(result.data) ? result.data : [];
        const timestamp = new Date().toISOString();

        refreshTrackedJobs(jobs, timestamp);
        appendMonitoringSnapshot(jobs, timestamp);
        persistFetchedPoll(jobs, timestamp);
        evaluateAlertRules(jobs, timestamp);
        resolveAlert('poll-failure', timestamp, 'A later monitoring poll completed successfully.');
        sendToWindow('status-update', result);
        return;
    }

    if (!ibmiService) {
        throw new Error('Not connected to IBM i');
    }

    const result = await ibmiService.getActiveJobs();
    const jobs = Array.isArray(result.data) ? result.data : [];
    const timestamp = new Date().toISOString();

    refreshTrackedJobs(jobs, timestamp);
    appendMonitoringSnapshot(jobs, timestamp);
    persistFetchedPoll(jobs, timestamp);
    evaluateAlertRules(jobs, timestamp);
    resolveAlert('poll-failure', timestamp, 'A later monitoring poll completed successfully.');
    sendToWindow('status-update', result);
}

ipcMain.handle('save-connection', async (_event, connection) => {
    try {
        const existingConnections = store.get('connections');
        const nameExists = hasDuplicateConnectionName(existingConnections, connection.name);
        if (nameExists) {
            throw new Error(`Connection name "${connection.name}" is already in use. Please choose a different name.`);
        }

        const existingConnection = findDuplicateHostUserConnection(
            existingConnections,
            connection.host,
            connection.user
        );
        if (existingConnection) {
            throw new Error(`A connection to ${connection.host} with user ${connection.user} already exists as "${existingConnection.name}".`);
        }

        sendToWindow('connection-test-status', {
            status: 'testing',
            message: 'Testing connection...'
        });

        recordActivity({
            area: 'storage',
            level: 'info',
            message: `Validating profile "${connection.name}" before saving.`,
            detail: describeConnectionTarget({
                host: connection.host,
                user: connection.user,
                port: connection.port || DEFAULT_PORT
            })
        });

        const connectionTestResult = await testConnection({
            host: connection.host,
            user: connection.user,
            password: connection.password,
            port: connection.port
        });

        if (!connectionTestResult.success) {
            sendToWindow('connection-test-status', {
                status: 'failed',
                message: connectionTestResult.error.summary,
                detail: connectionTestResult.error.detail
            });
            return {
                success: false,
                error: connectionTestResult.error.summary,
                detail: connectionTestResult.error.detail
            };
        }

        sendToWindow('connection-test-status', {
            status: 'success',
            message: 'Connection test successful. Saving connection...'
        });

        const id = Date.now().toString();
        const storedConnection: StoredConnection = {
            id,
            name: `${connection.name}`,
            host: connection.host,
            user: connection.user,
            encryptedPassword: protectStoredPassword(connection.password),
            port: connection.port || DEFAULT_PORT
        };

        const currentConnections = store.get('connections');
        const updatedConnections = [...currentConnections, storedConnection];
        store.set('connections', updatedConnections);

        recordActivity({
            area: 'storage',
            level: 'success',
            message: `Saved profile "${storedConnection.name}".`,
            detail: describeConnectionTarget(storedConnection)
        });

        const connectionList = updatedConnections.map((conn: StoredConnection) => toPublicConnection(conn));
        sendToWindow('connections-updated', connectionList);

        return { success: true, id };
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error('Error saving connection:', errorMessage);
        recordActivity({
            area: 'storage',
            level: 'error',
            message: 'Failed to save connection profile.',
            detail: errorMessage
        });
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('load-connections', () => {
    const connections = store.get('connections');
    return connections.map((conn: StoredConnection) =>
        toRenderableConnection(conn, decryptStoredPassword(conn.encryptedPassword))
    );
});

ipcMain.handle('delete-connection', (_event, id) => {
    try {
        const currentConnections = store.get('connections');
        const deletedConnection = currentConnections.find((connection) => connection.id === id) ?? null;
        const updatedConnections = removeConnectionById(currentConnections, id);
        store.set('connections', updatedConnections);

        recordActivity({
            area: 'storage',
            level: 'warning',
            message: deletedConnection
                ? `Deleted profile "${deletedConnection.name}".`
                : 'Deleted a saved profile.',
            detail: deletedConnection ? describeConnectionTarget(deletedConnection) : undefined
        });

        const connectionList = updatedConnections.map((conn: StoredConnection) => toPublicConnection(conn));
        sendToWindow('connections-updated', connectionList);

        return { success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        recordActivity({
            area: 'storage',
            level: 'error',
            message: 'Failed to delete a saved profile.',
            detail: errorMessage
        });
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('deploy-mapepire', async (_event, payload: MapepireDeployPayload) => {
    try {
        emitDeploymentStatus({
            level: 'info',
            message: `Starting ${payload.mode === 'rpm' ? 'RPM' : 'manual'} Mapepire deployment.`
        });

        const result = await deployMapepire(payload, (status) => {
            emitDeploymentStatus(status);
        });

        emitDeploymentStatus({
            level: 'success',
            message: `Mapepire deployment completed on port ${result.port}.`,
            detail: `Install path: ${result.installPath}\nRemote log: ${result.logPath}`
        });

        return {
            success: true,
            port: result.port,
            installPath: result.installPath,
            logPath: result.logPath,
            mode: result.mode
        };
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        emitDeploymentStatus({
            level: 'error',
            message: 'Mapepire deployment failed.',
            detail: errorMessage
        });
        return {
            success: false,
            error: 'Mapepire deployment failed.',
            detail: errorMessage
        };
    }
});

ipcMain.handle('connect-to-system', async (_event, config: DaemonServer & { name?: string; mode?: MonitorMode }) => {
    try {
        if (isDemoRequest(config)) {
            const demoAvailability = getDemoAvailability(app.isPackaged);
            if (!demoAvailability.enabled) {
                return {
                    success: false,
                    error: 'Demo mode is unavailable in this build.',
                    detail: demoAvailability.reason
                };
            }

            emitConnectionAction('Launching demo system.');
            if (clearMonitoringTimer()) {
                recordActivity({
                    area: 'monitoring',
                    level: 'warning',
                    message: 'Stopped the previous monitoring loop before switching systems.'
                });
            }

            ibmiService?.close();
            ibmiService = null;
            clearRuntimeMonitoringState();
            monitorMode = 'dummy';
            demoDataFilePath = getDemoDataFilePath(app.getPath('userData'));
            await writeDemoSnapshot(demoDataFilePath, dummyPollCount);
            setConnectionState({
                id: `demo-${Date.now()}`,
                name: config.name?.trim() || 'IBMEye Demo System',
                host: 'dummy.local',
                user: 'DEMO',
                encryptedPassword: '',
                port: DEFAULT_PORT
            });

            recordActivity({
                area: 'connection',
                level: 'success',
                message: 'Connected to IBMEye demo system.',
                detail: `Using generated JSON data at ${demoDataFilePath} with rotating RUN, LCKW, DLYW, and MSGW states.`
            });

            emitConnectionAction('Demo system ready.');
            return { success: true, port: DEFAULT_PORT };
        }

        emitConnectionAction('Checking Mapepire service.');
        const requestedPort = config.port ?? DEFAULT_PORT;
        const mapepireSetup = await ensureMapepireAvailable({
            host: config.host,
            user: config.user,
            password: config.password,
            sshPort: 22,
            preferredPort: requestedPort
        }, (status) => {
            emitConnectionAction(status.message, status.detail);
        });

        const connectionConfig: DaemonServer = {
            ...config,
            port: mapepireSetup.port,
            rejectUnauthorized: true
        };

        emitConnectionAction(`Opening IBMEye session on port ${connectionConfig.port}.`);
        recordActivity({
            area: 'connection',
            level: 'info',
            message: 'Opening IBMEye system session.',
            detail: describeConnectionTarget(connectionConfig)
        });

        const nextService = createIbmiService();
        await nextService.connect(connectionConfig);

        if (clearMonitoringTimer()) {
            recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'Stopped the previous monitoring loop before switching systems.'
            });
        }

        ibmiService?.close();
        ibmiService = nextService;
        clearRuntimeMonitoringState();
        monitorMode = 'live';
        setConnectionState({
            id: `session-${Date.now()}`,
            name: config.name?.trim() || `${config.host}:${connectionConfig.port}`,
            host: config.host,
            user: config.user,
            encryptedPassword: '',
            port: connectionConfig.port
        });

        recordActivity({
            area: 'connection',
            level: 'success',
            message: 'Connected to remote IBM i system.',
            detail: 'Monitoring will start automatically when the dashboard opens.'
        });

        emitConnectionAction('Connection ready.');
        return { success: true, port: connectionConfig.port };
    } catch (error: unknown) {
        setConnectionState(null);
        clearRuntimeMonitoringState();
        const connectionError = buildConnectionErrorPayload(error, {
            host: config.host,
            user: config.user,
            port: config.port ?? DEFAULT_PORT
        });
        console.error('Connection error:', connectionError.detail);
        recordActivity({
            area: 'connection',
            level: 'error',
            message: 'Remote system connection failed.',
            detail: connectionError.detail
        });
        emitConnectionAction(connectionError.summary, connectionError.detail);
        return {
            success: false,
            error: connectionError.summary,
            detail: connectionError.detail
        };
    }
});

ipcMain.handle('get-app-flags', () => {
    const demoAvailability = getDemoAvailability(app.isPackaged);
    return {
        demoModeEnabled: demoAvailability.enabled,
        demoModeReason: demoAvailability.reason,
        themeId: getThemeId(),
        themes: THEME_OPTIONS
    };
});

ipcMain.handle('get-system-status', async () => {
    try {
        if (monitorMode === 'dummy') {
            return getDummySystemStatus();
        }

        if (!ibmiService) {
            throw new Error('Not connected to IBM i');
        }
        return ibmiService.getActiveJobs();
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get system status';
        console.error('Error getting system status:', errorMessage);
        throw new Error(errorMessage);
    }
});

ipcMain.handle('disconnect', async () => {
    try {
        if (ibmiService) {
            ibmiService.close();
            ibmiService = null;
        }
        monitorMode = 'live';
        if (clearMonitoringTimer()) {
            recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'Monitoring stopped because the session was disconnected.'
            });
        }

        const settings = getAlertSettings();
        if (settings.watchDisconnects) {
            maybeShowNotification(
                'disconnect',
                'IBMEye disconnected',
                'The active IBM i session was disconnected.'
            );
        }

        setConnectionState(null);
        clearRuntimeMonitoringState();
        loadConnectionPage();
        recordActivity({
            area: 'connection',
            level: 'success',
            message: 'Disconnected from the remote IBM i system.'
        });
        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Disconnect error:', errorMessage);
        recordActivity({
            area: 'connection',
            level: 'error',
            message: 'Disconnect failed.',
            detail: errorMessage
        });
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('navigate-to-monitor', async () => {
    if (!connectionState.isConnected) {
        throw new Error('Not connected to IBM i');
    }
    loadMonitorPage();
    recordActivity({
        area: 'navigation',
        level: 'info',
        message: 'Opened the IBMEye dashboard.'
    });
    return { success: true };
});

ipcMain.handle('navigate-to-connection', async () => {
    loadConnectionPage();
    recordActivity({
        area: 'navigation',
        level: 'info',
        message: 'Returned to the connection workspace.'
    });
    return { success: true };
});

ipcMain.handle('get-connection-state', () => {
    return {
        isConnected: connectionState.isConnected,
        currentConnection: connectionState.currentConnection
            ? toPublicConnection(connectionState.currentConnection)
            : null
    };
});

ipcMain.handle('get-monitoring-state', () => {
    return {
        active: Boolean(monitoringInterval),
        interval: lastMonitoringInterval
    };
});

ipcMain.handle('get-activity-log', () => {
    return activityLog.slice();
});

ipcMain.handle('get-monitoring-history', () => {
    return monitoringHistory.slice();
});

ipcMain.handle('get-active-alerts', () => {
    return activeAlerts.slice();
});

ipcMain.handle('clear-alert', (_event, alertId: string) => {
    const timestamp = new Date().toISOString();
    const nextState = mutateAlertWorkflow(alertId, (state) => clearAlertWorkflow(state, {
        timestamp,
        owner: 'Local operator'
    }));
    clearAlertById(alertId);
    recordActivity({
        area: 'monitoring',
        level: 'info',
        message: 'Alert cleared by the operator.',
        detail: `${alertId} | ${nextState.lastActionSummary ?? 'Cleared'}`
    });
    return { success: true };
});

ipcMain.handle('update-alert-workflow', (_event, payload: {
    alertId: string;
    action: 'acknowledge' | 'start' | 'resolve' | 'clear' | 'note';
    note?: string;
    owner?: string;
}) => {
    const owner = payload.owner?.trim() || 'Local operator';
    const timestamp = new Date().toISOString();

    const nextState = mutateAlertWorkflow(payload.alertId, (state) => {
        switch (payload.action) {
            case 'acknowledge':
                return acknowledgeAlertWorkflow(state, { timestamp, owner });
            case 'start':
                return startAlertWorkflow(state, { timestamp, owner });
            case 'resolve':
                return resolveOperatorAlertWorkflow(state, {
                    timestamp,
                    owner,
                    note: payload.note
                });
            case 'clear':
                return clearAlertWorkflow(state, { timestamp, owner });
            case 'note':
                return addAlertWorkflowNote(state, {
                    timestamp,
                    owner,
                    note: payload.note
                });
            default:
                return state;
        }
    });

    if (payload.action === 'clear') {
        clearAlertById(payload.alertId);
    }

    recordActivity({
        area: 'monitoring',
        level: 'info',
        message: `Alert workflow updated: ${payload.action}.`,
        detail: `${payload.alertId} | ${nextState.lastActionSummary ?? payload.action}${payload.note ? ` | ${payload.note}` : ''}`
    });

    return { success: true };
});

ipcMain.handle('download-activity-log', async () => {
    const defaultPath = path.join(app.getPath('downloads'), buildLogFileName());
    const dialogOptions = {
        title: 'Download IBMEye Operator Log',
        defaultPath,
        filters: [
            { name: 'Log Files', extensions: ['log', 'txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    };
    const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
    }

    await writeOperatorLogFile(result.filePath);
    recordActivity({
        area: 'storage',
        level: 'success',
        message: 'Operator log downloaded.',
        detail: result.filePath
    });

    return {
        success: true,
        filePath: result.filePath
    };
});

ipcMain.handle('share-activity-log', async () => {
    const sharedLogPath = path.join(app.getPath('downloads'), 'IBM-Eye-Shared-Logs', buildLogFileName());
    await writeOperatorLogFile(sharedLogPath);
    clipboard.writeText(sharedLogPath);
    shell.showItemInFolder(sharedLogPath);

    recordActivity({
        area: 'storage',
        level: 'success',
        message: 'Operator log prepared for sharing.',
        detail: `${sharedLogPath}\nThe file path was copied to the clipboard and revealed in Finder.`
    });

    return {
        success: true,
        filePath: sharedLogPath
    };
});

ipcMain.handle('open-logs-folder', async () => {
    const logsDirectory = getLogsDirectoryPath();
    await fs.mkdir(logsDirectory, { recursive: true });
    const openError = await shell.openPath(logsDirectory);

    if (openError) {
        throw new Error(openError);
    }

    recordActivity({
        area: 'storage',
        level: 'info',
        message: 'Opened the IBMEye logs folder.',
        detail: logsDirectory
    });

    return {
        success: true,
        directoryPath: logsDirectory
    };
});

ipcMain.handle('get-alert-settings', () => {
    return getAlertSettings();
});

ipcMain.handle('get-theme-settings', () => {
    return {
        themeId: getThemeId(),
        themes: THEME_OPTIONS
    };
});

ipcMain.handle('save-theme-settings', (_event, candidateThemeId: string | undefined) => {
    const normalizedThemeId = normalizeThemeId(candidateThemeId);
    store.set('themeId', normalizedThemeId);
    recordActivity({
        area: 'navigation',
        level: 'info',
        message: 'Theme updated.',
        detail: `UI theme set to ${normalizedThemeId}.`
    });

    return {
        themeId: normalizedThemeId,
        themes: THEME_OPTIONS
    };
});

ipcMain.handle('save-alert-settings', (_event, candidate: Partial<AlertSettings> | undefined) => {
    const normalized = normalizeAlertSettings(candidate);
    store.set('alertSettings', normalized);
    emitAlertSettings();

    recordActivity({
        area: 'monitoring',
        level: 'info',
        message: 'Alert rules updated.',
        detail: `High CPU threshold set to ${normalized.highCpuThreshold}%.`
    });

    if (latestJobs.length) {
        evaluateAlertRules(latestJobs, new Date().toISOString());
    }

    return normalized;
});

ipcMain.handle('get-job-details', (_event, jobName: string) => {
    const job = latestJobIndex.get(jobName);
    if (!job) {
        return null;
    }

    const payload: JobDetailsPayload = {
        job,
        statusHistory: jobStatusHistory.get(jobName) ?? [],
        waitReason: buildWaitReason(job)
    };

    return payload;
});

app.whenReady().then(() => {
    const userDataDirectoryOverride = process.env.IBM_EYE_USER_DATA_DIR?.trim();
    if (userDataDirectoryOverride) {
        app.setPath('userData', userDataDirectoryOverride);
    }

    migrateStoredConnections();
    createWindow();
    recordActivity({
        area: 'navigation',
        level: 'info',
        message: 'IBMEye is ready.',
        detail: 'Waiting for the first IBM i connection.'
    });
    emitAlertSettings();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('start-monitoring', (_event, interval) => {
    if (monitorMode !== 'dummy' && !ibmiService) {
        const errorMessage = 'Not connected to IBM i';
        recordActivity({
            area: 'monitoring',
            level: 'error',
            message: 'Monitoring could not start.',
            detail: errorMessage
        });
        sendToWindow('monitoring-error', errorMessage);
        return;
    }

    const wasMonitoringActive = clearMonitoringTimer();
    const refreshInterval = normalizeRefreshInterval(interval);
    lastMonitoringInterval = refreshInterval;

    recordActivity({
        area: 'monitoring',
        level: 'info',
        message: wasMonitoringActive ? 'Monitoring cadence updated.' : 'Monitoring started.',
        detail: `Polling active jobs every ${describeRefreshInterval(refreshInterval)}.`
    });

    const poll = async () => {
        try {
            await publishSystemStatus();
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Monitoring failed';
            console.error('Monitoring error:', errorMessage);
            recordActivity({
                area: 'monitoring',
                level: 'error',
                message: 'Monitoring poll failed.',
                detail: errorMessage
            });
            setPollFailureAlert(errorMessage);
            sendToWindow('monitoring-error', errorMessage);
        }
    };

    void poll();
    monitoringInterval = setInterval(() => {
        void poll();
    }, refreshInterval);
});

ipcMain.on('stop-monitoring', () => {
    if (clearMonitoringTimer()) {
        recordActivity({
            area: 'monitoring',
            level: 'warning',
            message: 'Monitoring paused by the operator.'
        });
    }
});
