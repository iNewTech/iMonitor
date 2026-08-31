import { ShareMenu, dialog, shell } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { ActivityLogEntry, MonitorMode, PersistentLogRecord } from '../types';
import { buildJobHistoryLog } from '../../features/action-board/job-history-log';

interface LoggingRuntimeDependencies {
    userDataPath: string;
    downloadsPath: string;
    getConnectionContext: () => {
        name: string | null;
        host: string | null;
        user: string | null;
        port: number | null;
    };
    getMonitorMode: () => MonitorMode;
    getMonitoringHistory: () => Array<{
        timestamp: string;
        totalJobs: number;
        peakCpu: number;
        waitingJobs: number;
        messageWaitJobs: number;
        lockWaitJobs: number;
    }>;
    getActiveAlertsCount: () => number;
    sendToWindow: (channel: string, payload: unknown) => void;
    showSaveDialog: typeof dialog.showSaveDialog;
    showItemInFolder: typeof shell.showItemInFolder;
    openPath: typeof shell.openPath;
    isMac: boolean;
    getMainWindow: () => Electron.BrowserWindow | null;
    getJobKey: (job: ActiveJobRecord) => string;
    toNumber: (value: unknown) => number;
    maxActivityEntries: number;
}

/**
 * Stores operator activity and manages daily persistent log files.
 */
export function createLoggingRuntime(dependencies: LoggingRuntimeDependencies) {
    let activitySequence = 0;
    let persistentLogWriteQueue = Promise.resolve();
    const activityLog: ActivityLogEntry[] = [];

    const getLogsDirectoryPath = () => path.join(dependencies.userDataPath, 'logs');

    const getCurrentLogDateSegment = () => new Date().toISOString().slice(0, 10);

    const getDailyLogFilePath = (dateSegment = getCurrentLogDateSegment()) => (
        path.join(getLogsDirectoryPath(), `ibm-eye-${dateSegment}.log.jsonl`)
    );

    const getDailyReadableLogFilePath = (dateSegment = getCurrentLogDateSegment()) => (
        path.join(getLogsDirectoryPath(), `ibm-eye-${dateSegment}.log`)
    );

    const formatLogTimestamp = (value: string) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toISOString();
    };

    const sanitizeFileSegment = (value: string) => (
        value.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'ibm-eye'
    );

    const formatPersistentLogConnection = (connection: PersistentLogRecord['connection']) => {
        if (!connection.host || !connection.user) {
            return connection.name || 'no-active-connection';
        }

        const nameSegment = connection.name ? `${connection.name} ` : '';
        const portSegment = connection.port ? `:${connection.port}` : '';
        return `${nameSegment}(${connection.user}@${connection.host}${portSegment})`;
    };

    const buildReadableLogRecord = (record: PersistentLogRecord) => {
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
            `  job: ${job.SUBSYSTEM_JOB || dependencies.getJobKey(job)} status=${job.STATUS || 'UNKNOWN'} cpu=${dependencies.toNumber(job.CPU).toFixed(2)} function=${job.FUNCTION_NAME || 'Unknown'}`
        ));

        return `${summary}${topJobs.length ? `\n${topJobs.join('\n')}` : ''}\n`;
    };

    const queuePersistentLogRecord = (record: PersistentLogRecord) => {
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
                console.error('Unable to persist iMonitor log record.', error);
            });
    };

    const buildLogFileName = () => {
        const baseName = dependencies.getConnectionContext().name || 'ibm-eye-session';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${sanitizeFileSegment(baseName)}-${timestamp}.log`;
    };

    const buildOperatorLogText = () => {
        const connection = dependencies.getConnectionContext();
        const connectionLabel = connection.host && connection.user
            ? `${connection.name || 'iMonitor'} (${connection.user}@${connection.host}:${connection.port})`
            : 'No active connection';
        const logsDirectory = getLogsDirectoryPath();
        const dailyReadableLogFile = getDailyReadableLogFilePath();
        const dailyStructuredLogFile = getDailyLogFilePath();
        const historyLines = dependencies.getMonitoringHistory().slice(-10).map((snapshot) => (
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
            'iMonitor Operator Log',
            `Generated: ${new Date().toISOString()}`,
            `Connection: ${connectionLabel}`,
            `Monitor mode: ${dependencies.getMonitorMode()}`,
            `Daily logs directory: ${logsDirectory}`,
            `Today readable log file: ${dailyReadableLogFile}`,
            `Today structured log file: ${dailyStructuredLogFile}`,
            `Tracked alerts: ${dependencies.getActiveAlertsCount()}`,
            `Tracked snapshots: ${dependencies.getMonitoringHistory().length}`,
            '',
            'Recent snapshot summary:',
            ...(historyLines.length ? historyLines : ['No monitoring snapshots collected yet.']),
            '',
            'Activity entries:',
            ...(entryLines.length ? entryLines : ['No operator activity recorded yet.']),
            ''
        ].join('\n');
    };

    return {
        getActivityLog() {
            return activityLog.slice();
        },
        getOperatorLogText() {
            return buildOperatorLogText();
        },
        recordActivity(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) {
            activitySequence += 1;
            const activityEntry: ActivityLogEntry = {
                id: `${Date.now()}-${activitySequence}`,
                timestamp: new Date().toISOString(),
                ...entry
            };

            activityLog.unshift(activityEntry);
            if (activityLog.length > dependencies.maxActivityEntries) {
                activityLog.length = dependencies.maxActivityEntries;
            }

            dependencies.sendToWindow('activity-log', activityEntry);
            queuePersistentLogRecord({
                schemaVersion: 1,
                type: 'activity',
                timestamp: activityEntry.timestamp,
                monitorMode: dependencies.getMonitorMode(),
                connection: dependencies.getConnectionContext(),
                payload: {
                    id: activityEntry.id,
                    area: activityEntry.area,
                    level: activityEntry.level,
                    message: activityEntry.message,
                    detail: activityEntry.detail ?? null,
                    sql: activityEntry.sql ?? null
                }
            });
        },
        persistPoll(jobs: ActiveJobRecord[], timestamp: string, intervalMs: number) {
            const peakCpu = jobs.reduce((highest, job) => Math.max(highest, dependencies.toNumber(job.CPU)), 0);
            const runningJobs = jobs.filter((job) => job.STATUS === 'RUN').length;
            const waitingJobs = jobs.filter((job) => ['MSGW', 'LCKW', 'DLYW', 'DEQW'].includes(job.STATUS || '')).length;
            const messageWaitJobs = jobs.filter((job) => job.STATUS === 'MSGW').length;
            const lockWaitJobs = jobs.filter((job) => job.STATUS === 'LCKW').length;

            queuePersistentLogRecord({
                schemaVersion: 1,
                type: 'poll',
                timestamp,
                monitorMode: dependencies.getMonitorMode(),
                connection: dependencies.getConnectionContext(),
                payload: {
                    intervalMs,
                    totalJobs: jobs.length,
                    peakCpu,
                    runningJobs,
                    waitingJobs,
                    messageWaitJobs,
                    lockWaitJobs,
                    jobs
                }
            });
        },
        async writeOperatorLogFile(filePath: string) {
            const logText = buildOperatorLogText();
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, logText, 'utf8');
            return logText;
        },
        async getLatestReadableLogFilePath() {
            const logsDirectory = getLogsDirectoryPath();
            await fs.mkdir(logsDirectory, { recursive: true });
            const directoryEntries = await fs.readdir(logsDirectory, { withFileTypes: true });
            const readableLogCandidates = directoryEntries
                .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
                .map((entry) => path.join(logsDirectory, entry.name));

            if (!readableLogCandidates.length) {
                const latestReadableLogFilePath = getDailyReadableLogFilePath();
                await this.writeOperatorLogFile(latestReadableLogFilePath);
                return latestReadableLogFilePath;
            }

            const logFilesWithStats = await Promise.all(readableLogCandidates.map(async (filePath) => ({
                filePath,
                stats: await fs.stat(filePath)
            })));
            logFilesWithStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
            return logFilesWithStats[0].filePath;
        },
        async getJobReadableLogFilePath(jobName: string) {
            await persistentLogWriteQueue;
            const dateSegment = getCurrentLogDateSegment();
            const structuredPath = getDailyLogFilePath(dateSegment);
            const jobLogPath = path.join(
                getLogsDirectoryPath(),
                `ibm-eye-job-${sanitizeFileSegment(jobName)}-${dateSegment}.log`
            );
            let records: Array<{ timestamp: string; payload: Record<string, unknown>; }> = [];

            try {
                const contents = await fs.readFile(structuredPath, 'utf8');
                records = contents.split('\n').filter(Boolean).flatMap((line) => {
                    try {
                        const record = JSON.parse(line) as PersistentLogRecord;
                        return record.type === 'poll' ? [{ timestamp: record.timestamp, payload: record.payload }] : [];
                    } catch {
                        return [];
                    }
                });
            } catch {
                // The readable file explains when no poll history is available.
            }

            await fs.mkdir(getLogsDirectoryPath(), { recursive: true });
            await fs.writeFile(jobLogPath, buildJobHistoryLog(jobName, records, dependencies.getJobKey), 'utf8');
            return jobLogPath;
        },
        async downloadActivityLogFile() {
            const defaultPath = path.join(dependencies.downloadsPath, buildLogFileName());
            const dialogOptions = {
                title: 'Download iMonitor Operator Log',
                defaultPath,
                filters: [
                    { name: 'Log Files', extensions: ['log', 'txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            };
            const window = dependencies.getMainWindow();
            const result = window
                ? await dependencies.showSaveDialog(window, dialogOptions)
                : await dependencies.showSaveDialog(dialogOptions);

            if (result.canceled || !result.filePath) {
                return { success: false, canceled: true };
            }

            await this.writeOperatorLogFile(result.filePath);
            this.recordActivity({
                area: 'storage',
                level: 'success',
                message: 'Operator log downloaded.',
                detail: result.filePath
            });

            return {
                success: true,
                filePath: result.filePath
            };
        },
        async shareActivityLogFile() {
            const latestReadableLogFilePath = await this.getLatestReadableLogFilePath();

            if (dependencies.isMac) {
                const shareMenu = new ShareMenu({
                    filePaths: [latestReadableLogFilePath]
                });

                shareMenu.popup();
                this.recordActivity({
                    area: 'storage',
                    level: 'success',
                    message: 'Opened the native share menu for the latest operator log.',
                    detail: latestReadableLogFilePath
                });

                return {
                    success: true,
                    filePath: latestReadableLogFilePath,
                    method: 'native-share-menu'
                };
            }

            dependencies.showItemInFolder(latestReadableLogFilePath);
            this.recordActivity({
                area: 'storage',
                level: 'info',
                message: 'Revealed the latest operator log for sharing.',
                detail: `${latestReadableLogFilePath}\nNative share sheet is only available on macOS.`
            });

            return {
                success: true,
                filePath: latestReadableLogFilePath,
                method: 'reveal-in-folder'
            };
        },
        async openLogsDirectory() {
            const logsDirectory = getLogsDirectoryPath();
            await fs.mkdir(logsDirectory, { recursive: true });
            const openError = await dependencies.openPath(logsDirectory);

            if (openError) {
                throw new Error(openError);
            }

            this.recordActivity({
                area: 'storage',
                level: 'info',
                message: 'Opened the iMonitor logs folder.',
                detail: logsDirectory
            });

            return {
                success: true,
                directoryPath: logsDirectory
            };
        }
    };
}
