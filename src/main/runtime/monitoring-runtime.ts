import {
    getDemoDataFilePath,
    readDemoSnapshot,
    writeDemoSnapshot
} from '../../utils/demo-system';
import type Db from '../../services/ibmi';
import type { ActiveJobRecord, QueryResult } from '../../services/ibmi';
import type { AlertSettings } from '../../features/alerts/alert-model';
import type { createAlertStateStore } from '../state/alert-state';
import type { createMonitoringStateStore } from '../state/monitoring-state';

interface MonitoringRuntimeDependencies {
    getCurrentService: () => Db | null;
    getAlertSettings: () => AlertSettings;
    getUserDataPath: () => string;
    monitoringState: ReturnType<typeof createMonitoringStateStore>;
    alertState: ReturnType<typeof createAlertStateStore>;
    recordActivity: (entry: {
        area: 'sql' | 'monitoring';
        level: 'info' | 'warning' | 'error';
        message: string;
        detail?: string;
        sql?: string;
    }) => void;
    sendToWindow: (channel: string, payload: unknown) => void;
    notify: (key: string, title: string, body: string) => void;
    persistPoll: (jobs: ActiveJobRecord[], timestamp: string, intervalMs: number) => void;
}

/**
 * Runs the monitoring poll loop and keeps runtime monitor state in sync.
 */
export function createMonitoringRuntime(dependencies: MonitoringRuntimeDependencies) {
    const emitMonitoringHistory = () => {
        dependencies.sendToWindow(
            'monitoring-history-updated',
            dependencies.monitoringState.getMonitoringHistory().slice()
        );
    };

    const normalizeRefreshInterval = (interval: unknown) => {
        const requestedInterval = typeof interval === 'number' ? interval : Number(interval);
        if (Number.isFinite(requestedInterval) && requestedInterval >= 1000) {
            return requestedInterval;
        }

        return dependencies.monitoringState.getLastMonitoringInterval();
    };

    const describeRefreshInterval = (interval: number) => {
        if (interval % 60000 === 0) {
            const minutes = interval / 60000;
            return `${minutes} minute${minutes === 1 ? '' : 's'}`;
        }

        const seconds = interval / 1000;
        return `${seconds} second${seconds === 1 ? '' : 's'}`;
    };

    const getDummySystemStatus = async (): Promise<QueryResult<ActiveJobRecord>> => {
        let demoDataFilePath = dependencies.monitoringState.getDemoDataFilePath();
        if (!demoDataFilePath) {
            demoDataFilePath = getDemoDataFilePath(dependencies.getUserDataPath());
            dependencies.monitoringState.setDemoDataFilePath(demoDataFilePath);
        }

        const dummyPollCount = dependencies.monitoringState.incrementDummyPollCount();
        await writeDemoSnapshot(demoDataFilePath, dummyPollCount);
        const result = await readDemoSnapshot(demoDataFilePath);
        const jobs = Array.isArray(result.data) ? result.data : [];
        const msgwCount = jobs.filter((job) => job.STATUS === 'MSGW').length;
        const lckwCount = jobs.filter((job) => job.STATUS === 'LCKW').length;

        dependencies.recordActivity({
            area: 'sql',
            level: 'info',
            message: 'Generated demo snapshot JSON for iMonitor.',
            detail: `Demo poll ${dummyPollCount} read ${jobs.length} jobs from ${demoDataFilePath}. MSGW jobs: ${msgwCount}. LCKW jobs: ${lckwCount}.`,
            sql: `-- demo mode reads generated snapshot JSON\n-- ${demoDataFilePath}`
        });

        return result;
    };

    const applyStatusUpdate = (result: QueryResult<ActiveJobRecord>) => {
        const jobs = Array.isArray(result.data) ? result.data : [];
        const timestamp = new Date().toISOString();
        const settings = dependencies.getAlertSettings();

        dependencies.monitoringState.refreshTrackedJobs(jobs, timestamp);
        dependencies.monitoringState.appendMonitoringSnapshot(jobs, timestamp, settings.highCpuThreshold);
        dependencies.alertState.evaluateAlertRules(jobs, timestamp, settings, dependencies.notify);
        dependencies.alertState.resolveAlert(
            'poll-failure',
            timestamp,
            'A later monitoring poll completed successfully.'
        );
        dependencies.persistPoll(jobs, timestamp, dependencies.monitoringState.getLastMonitoringInterval());
        emitMonitoringHistory();
        dependencies.sendToWindow('status-update', result);
    };

    const publishSystemStatus = async () => {
        if (dependencies.monitoringState.getMonitorMode() === 'dummy') {
            applyStatusUpdate(await getDummySystemStatus());
            return;
        }

        const service = dependencies.getCurrentService();
        if (!service) {
            throw new Error('Not connected to IBM i');
        }

        applyStatusUpdate(await service.getActiveJobs());
    };

    return {
        emitMonitoringHistory,
        clearRuntimeMonitoringState() {
            dependencies.monitoringState.clearRuntimeState();
            dependencies.alertState.clearRuntimeState();
            emitMonitoringHistory();
        },
        async getSystemStatus() {
            if (dependencies.monitoringState.getMonitorMode() === 'dummy') {
                return getDummySystemStatus();
            }

            const service = dependencies.getCurrentService();
            if (!service) {
                throw new Error('Not connected to IBM i');
            }

            return service.getActiveJobs();
        },
        publishSystemStatus,
        startMonitoring(interval: unknown) {
            if (
                dependencies.monitoringState.getMonitorMode() !== 'dummy'
                && !dependencies.getCurrentService()
            ) {
                const errorMessage = 'Not connected to IBM i';
                dependencies.recordActivity({
                    area: 'monitoring',
                    level: 'error',
                    message: 'Monitoring could not start.',
                    detail: errorMessage
                });
                dependencies.sendToWindow('monitoring-error', errorMessage);
                return;
            }

            const wasMonitoringActive = dependencies.monitoringState.clearMonitoringTimer();
            const refreshInterval = normalizeRefreshInterval(interval);
            dependencies.monitoringState.setLastMonitoringInterval(refreshInterval);

            dependencies.recordActivity({
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
                    dependencies.recordActivity({
                        area: 'monitoring',
                        level: 'error',
                        message: 'Monitoring poll failed.',
                        detail: errorMessage
                    });
                    dependencies.alertState.setPollFailureAlert(
                        errorMessage,
                        dependencies.getAlertSettings(),
                        dependencies.notify
                    );
                    dependencies.sendToWindow('monitoring-error', errorMessage);
                }
            };

            void poll();
            dependencies.monitoringState.setMonitoringTimer(setInterval(() => {
                void poll();
            }, refreshInterval));
        },
        stopMonitoring(recordStop = true) {
            if (!dependencies.monitoringState.clearMonitoringTimer()) {
                return;
            }

            if (recordStop) {
                dependencies.recordActivity({
                    area: 'monitoring',
                    level: 'warning',
                    message: 'Monitoring paused by the operator.'
                });
            }
        }
    };
}
