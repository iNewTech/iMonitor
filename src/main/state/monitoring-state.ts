import {
    createMonitoringSnapshot,
    refreshTrackedJobs as buildTrackedJobs,
    type JobStatusHistoryEntry,
    type MonitoringSnapshot
} from '../../features/monitoring/monitoring-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorMode } from '../types';

/**
 * Stores transient monitoring data for the current desktop session.
 */
export function createMonitoringStateStore(
    maxMonitoringHistory: number,
    maxJobStatusHistory: number,
    defaultMonitoringInterval: number
) {
    let monitorMode: MonitorMode = 'live';
    let monitoringInterval: NodeJS.Timeout | null = null;
    let lastMonitoringInterval = defaultMonitoringInterval;
    let dummyPollCount = 0;
    let demoDataFilePath: string | null = null;
    let latestJobs: ActiveJobRecord[] = [];
    let monitoringHistory: MonitoringSnapshot[] = [];
    const latestJobIndex = new Map<string, ActiveJobRecord>();
    const jobStatusHistory = new Map<string, JobStatusHistoryEntry[]>();

    return {
        getMonitorMode() {
            return monitorMode;
        },
        setMonitorMode(mode: MonitorMode) {
            monitorMode = mode;
        },
        getMonitoringTimer() {
            return monitoringInterval;
        },
        setMonitoringTimer(timer: NodeJS.Timeout | null) {
            monitoringInterval = timer;
        },
        clearMonitoringTimer() {
            if (!monitoringInterval) {
                return false;
            }

            clearInterval(monitoringInterval);
            monitoringInterval = null;
            return true;
        },
        getLastMonitoringInterval() {
            return lastMonitoringInterval;
        },
        setLastMonitoringInterval(interval: number) {
            lastMonitoringInterval = interval;
        },
        getMonitoringState() {
            return {
                active: Boolean(monitoringInterval),
                interval: lastMonitoringInterval
            };
        },
        getDummyPollCount() {
            return dummyPollCount;
        },
        incrementDummyPollCount() {
            dummyPollCount += 1;
            return dummyPollCount;
        },
        resetDummyPollCount() {
            dummyPollCount = 0;
        },
        getDemoDataFilePath() {
            return demoDataFilePath;
        },
        setDemoDataFilePath(filePath: string | null) {
            demoDataFilePath = filePath;
        },
        getLatestJobs() {
            return latestJobs;
        },
        getMonitoringHistory() {
            return monitoringHistory;
        },
        getJob(jobName: string) {
            return latestJobIndex.get(jobName);
        },
        getJobStatusHistory(jobName: string) {
            return jobStatusHistory.get(jobName) ?? [];
        },
        refreshTrackedJobs(jobs: ActiveJobRecord[], timestamp: string) {
            latestJobs = jobs;
            const nextTracking = buildTrackedJobs(jobs, timestamp, jobStatusHistory, maxJobStatusHistory);
            latestJobIndex.clear();
            nextTracking.latestJobIndex.forEach((job, jobKey) => {
                latestJobIndex.set(jobKey, job);
            });
            jobStatusHistory.clear();
            nextTracking.jobStatusHistory.forEach((history, jobKey) => {
                jobStatusHistory.set(jobKey, history);
            });
        },
        appendMonitoringSnapshot(jobs: ActiveJobRecord[], timestamp: string, highCpuThreshold: number) {
            monitoringHistory.push(createMonitoringSnapshot(jobs, timestamp, highCpuThreshold));
            if (monitoringHistory.length > maxMonitoringHistory) {
                monitoringHistory = monitoringHistory.slice(-maxMonitoringHistory);
            }
        },
        clearRuntimeState() {
            latestJobs = [];
            monitoringHistory = [];
            monitorMode = 'live';
            dummyPollCount = 0;
            demoDataFilePath = null;
            latestJobIndex.clear();
            jobStatusHistory.clear();
        }
    };
}
