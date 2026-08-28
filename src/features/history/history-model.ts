export interface HistoricalPollRecord {
    schemaVersion: 1;
    type: 'poll';
    timestamp: string;
    monitorMode: 'live' | 'dummy';
    connection: {
        name: string | null;
        host: string | null;
        user: string | null;
        port: number | null;
    };
    payload: {
        intervalMs: number;
        totalJobs: number;
        peakCpu: number;
        runningJobs: number;
        waitingJobs: number;
        messageWaitJobs: number;
        lockWaitJobs: number;
        jobs: unknown[];
    };
}

export interface HistoricalActivityRecord {
    schemaVersion: 1;
    type: 'activity';
    timestamp: string;
    monitorMode: 'live' | 'dummy';
    connection: HistoricalPollRecord['connection'];
    payload: Record<string, unknown>;
}

export type PersistentLogRecord = HistoricalPollRecord | HistoricalActivityRecord;

export interface HistoricalIncident {
    timestamp: string;
    kind: 'messageWait' | 'lockWait' | 'highCpu' | 'mixed';
    severity: 'warning' | 'critical';
    summary: string;
}

/**
 * Parses one JSONL record from a daily iMonitor structured log.
 */
export function parsePersistentLogRecord(line: string): PersistentLogRecord | null {
    try {
        const parsed = JSON.parse(line) as PersistentLogRecord;
        if (parsed?.schemaVersion !== 1 || (parsed.type !== 'poll' && parsed.type !== 'activity')) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

/**
 * Rebuilds trend series and simple incident markers from structured poll logs.
 */
export function buildHistoricalMonitorState(records: Array<PersistentLogRecord | null>, highCpuThreshold: number) {
    const snapshots = records.filter((record): record is HistoricalPollRecord => record?.type === 'poll');
    const incidents: HistoricalIncident[] = snapshots.flatMap((snapshot) => {
        const hasMsgw = Number(snapshot.payload.messageWaitJobs || 0) > 0;
        const hasLckw = Number(snapshot.payload.lockWaitJobs || 0) > 0;
        const hasHighCpu = Number(snapshot.payload.peakCpu || 0) >= highCpuThreshold;

        if (!hasMsgw && !hasLckw && !hasHighCpu) {
            return [];
        }

        const kind = hasMsgw && hasLckw
            ? 'mixed'
            : hasMsgw
                ? 'messageWait'
                : hasLckw
                    ? 'lockWait'
                    : 'highCpu';
        const severity = hasHighCpu || (hasMsgw && hasLckw) ? 'critical' : 'warning';

        return [{
            timestamp: snapshot.timestamp,
            kind,
            severity,
            summary: `jobs=${snapshot.payload.totalJobs} peakCpu=${snapshot.payload.peakCpu} waiting=${snapshot.payload.waitingJobs}`
        }];
    });

    return {
        snapshots,
        trends: {
            totalJobs: snapshots.map((snapshot) => Number(snapshot.payload.totalJobs || 0)),
            peakCpu: snapshots.map((snapshot) => Number(snapshot.payload.peakCpu || 0)),
            waitingJobs: snapshots.map((snapshot) => Number(snapshot.payload.waitingJobs || 0))
        },
        incidents
    };
}
