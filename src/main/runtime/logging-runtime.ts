import * as fs from 'fs/promises';
import * as path from 'path';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { ActivityLogEntry, MonitorMode, PersistentLogRecord } from '../types';
import { buildJobHistoryLog } from '../../features/action-board/job-history-log';

interface LoggingRuntimeDependencies {
    userDataPath: string;
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
    encryptAtRest?: (value: string) => string;
    getJobKey: (job: ActiveJobRecord) => string;
    toNumber: (value: unknown) => number;
    maxActivityEntries: number;
}

/**
 * Captures developer activity and manages encrypted daily diagnostic records.
 */
export function createLoggingRuntime(dependencies: LoggingRuntimeDependencies) {
    let activitySequence = 0;
    let persistentLogWriteQueue = Promise.resolve();
    const activityLog: ActivityLogEntry[] = [];
    const pollRecords: Array<{ timestamp: string; payload: Record<string, unknown>; }> = [];

    const getLogsDirectoryPath = () => path.join(dependencies.userDataPath, 'logs');

    const getCurrentLogDateSegment = () => new Date().toISOString().slice(0, 10);

    const getDailyLogFilePath = (dateSegment = getCurrentLogDateSegment()) => (
        path.join(getLogsDirectoryPath(), `ibm-eye-${dateSegment}.log.enc`)
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

    const queuePersistentLogRecord = (record: PersistentLogRecord) => {
        if (!dependencies.encryptAtRest) {
            return;
        }

        persistentLogWriteQueue = persistentLogWriteQueue
            .then(async () => {
                const dateSegment = record.timestamp.slice(0, 10);
                const structuredLogFilePath = getDailyLogFilePath(dateSegment);
                await fs.mkdir(path.dirname(structuredLogFilePath), { recursive: true });
                const encryptedRecord = dependencies.encryptAtRest!(JSON.stringify(record));
                await fs.appendFile(structuredLogFilePath, `${encryptedRecord}\n`, 'utf8');
            })
            .catch((error) => {
                console.error('Unable to persist iMonitor log record.', error);
            });
    };

    const buildDeveloperLogText = () => {
        const connection = dependencies.getConnectionContext();
        const connectionLabel = connection.host && connection.user
            ? `${connection.name || 'iMonitor'} (${connection.user}@${connection.host}:${connection.port})`
            : 'No active connection';
        const logsDirectory = getLogsDirectoryPath();
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
            'iMonitor Developer Log',
            `Generated: ${new Date().toISOString()}`,
            `Connection: ${connectionLabel}`,
            `Monitor mode: ${dependencies.getMonitorMode()}`,
            `Daily logs directory: ${logsDirectory}`,
            `Today encrypted developer log: ${dailyStructuredLogFile}`,
            `Tracked alerts: ${dependencies.getActiveAlertsCount()}`,
            `Tracked snapshots: ${dependencies.getMonitoringHistory().length}`,
            '',
            'Recent snapshot summary:',
            ...(historyLines.length ? historyLines : ['No monitoring snapshots collected yet.']),
            '',
            'Activity entries:',
            ...(entryLines.length ? entryLines : ['No detailed activity recorded yet.']),
            ''
        ].join('\n');
    };

    return {
        getActivityLog() {
            return activityLog.slice();
        },
        getDeveloperLogText() {
            return buildDeveloperLogText();
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
            const payload = {
                intervalMs,
                totalJobs: jobs.length,
                peakCpu,
                runningJobs,
                waitingJobs,
                messageWaitJobs,
                lockWaitJobs,
                jobs: jobs.map((job) => ({ ...job }))
            } satisfies Record<string, unknown>;

            pollRecords.push({ timestamp, payload });
            if (pollRecords.length > 90) {
                pollRecords.splice(0, pollRecords.length - 90);
            }

            queuePersistentLogRecord({
                schemaVersion: 1,
                type: 'poll',
                timestamp,
                monitorMode: dependencies.getMonitorMode(),
                connection: dependencies.getConnectionContext(),
                payload
            });
        },
        async getJobReadableLogFilePath(jobName: string) {
            await persistentLogWriteQueue;
            const dateSegment = getCurrentLogDateSegment();
            const jobLogPath = path.join(
                getLogsDirectoryPath(),
                `ibm-eye-job-${sanitizeFileSegment(jobName)}-${dateSegment}.log`
            );
            await fs.mkdir(getLogsDirectoryPath(), { recursive: true });
            const records = pollRecords.filter((record) => record.timestamp.slice(0, 10) === dateSegment);
            await fs.writeFile(jobLogPath, buildJobHistoryLog(jobName, records, dependencies.getJobKey), 'utf8');
            return jobLogPath;
        }
    };
}
