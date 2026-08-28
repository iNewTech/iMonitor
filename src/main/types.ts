import type { ServiceLogEntry } from '../services/ibmi';

export type MonitorMode = 'live' | 'dummy';

export type ActivityLogArea = ServiceLogEntry['area'] | 'monitoring' | 'navigation' | 'storage' | 'support' | 'ai';

export interface ActivityLogEntry {
    id: string;
    timestamp: string;
    area: ActivityLogArea;
    level: ServiceLogEntry['level'];
    message: string;
    detail?: string;
    sql?: string;
}

export interface ConnectionErrorPayload {
    summary: string;
    detail: string;
}

export interface MapepireDeployPayload {
    host: string;
    user: string;
    password: string;
    sshPort: number;
    preferredPort: number;
    mode: 'rpm' | 'manual';
}

export interface PersistentLogRecord {
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
