import {
    DEFAULT_COLLECTOR_SETTINGS,
    normalizeCollectorSettings,
    type CollectorSettings,
    type CollectorStatus
} from '../../features/collector/collector-model';
import type { createCollectionRuntime } from './collection-runtime';

interface BackgroundCollectorDependencies {
    getSettings: () => CollectorSettings;
    saveSettings: (settings: CollectorSettings) => void;
    getConnectionId: () => string | undefined;
    connectSavedConnection: (id: string) => Promise<{ success: boolean; error?: string }>;
    startMonitoring: (intervalMs: number) => void;
    stopMonitoring: (recordStop?: boolean) => void;
    isMonitoringActive: () => boolean;
    setLoginItemSettings: (enabled: boolean) => void;
    collectionRuntime: ReturnType<typeof createCollectionRuntime>;
    recordActivity: (entry: { area: 'monitoring'; level: 'info' | 'warning' | 'error'; message: string; detail?: string }) => void;
    sendToWindow: (channel: string, payload: unknown) => void;
}

export function createBackgroundCollectorRuntime(dependencies: BackgroundCollectorDependencies) {
    let state: CollectorStatus['state'] = 'stopped';
    let lastError: string | null = null;
    let retryTimer: NodeJS.Timeout | null = null;
    let ownsMonitoring = false;

    const getStatus = (): CollectorStatus => ({
        state: dependencies.getSettings().enabled ? state : 'disabled',
        settings: normalizeCollectorSettings(dependencies.getSettings()),
        health: dependencies.collectionRuntime.getHealth(),
        lastError
    });

    const publish = () => dependencies.sendToWindow('collector-status-updated', getStatus());

    const scheduleRetry = (connectionId: string) => {
        if (retryTimer || !dependencies.getSettings().enabled) return;
        state = 'degraded';
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void start(connectionId);
        }, 60000);
        publish();
    };

    async function start(connectionId: string) {
        if (!dependencies.getSettings().enabled) return;
        state = 'starting';
        lastError = null;
        dependencies.collectionRuntime.markStarted();
        publish();
        if (dependencies.getConnectionId() !== connectionId) {
            const result = await dependencies.connectSavedConnection(connectionId);
            if (!result.success) {
                lastError = result.error || 'Unable to reconnect to the saved IBM i profile.';
                dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Background collector could not reconnect.', detail: lastError });
                scheduleRetry(connectionId);
                return;
            }
        }
        if (!dependencies.isMonitoringActive()) {
            dependencies.startMonitoring(dependencies.getSettings().intervalMs);
            ownsMonitoring = true;
        }
        state = 'running';
        dependencies.recordActivity({ area: 'monitoring', level: 'info', message: 'Background collector is running.', detail: `Polling every ${dependencies.getSettings().intervalMs} ms and retaining collected records locally.` });
        publish();
    }

    return {
        getStatus,
        async applySettings(candidate?: Partial<CollectorSettings>) {
            const settings = normalizeCollectorSettings({ ...dependencies.getSettings(), ...(candidate || {}) });
            dependencies.saveSettings(settings);
            dependencies.setLoginItemSettings(Boolean(settings.enabled && settings.startWithSystem && settings.connectionId));
            if (!settings.enabled) {
                if (retryTimer) clearTimeout(retryTimer);
                retryTimer = null;
                if (ownsMonitoring) dependencies.stopMonitoring();
                ownsMonitoring = false;
                state = 'disabled';
                lastError = null;
                publish();
                return getStatus();
            }
            if (settings.connectionId) await start(settings.connectionId);
            else {
                state = 'degraded';
                lastError = 'Choose a saved IBM i profile before enabling background collection.';
                publish();
            }
            return getStatus();
        },
        async startIfConfigured() {
            const settings = normalizeCollectorSettings(dependencies.getSettings());
            if (!settings.enabled || !settings.startWithSystem || !settings.connectionId) {
                state = settings.enabled ? 'stopped' : 'disabled';
                publish();
                return getStatus();
            }
            await start(settings.connectionId);
            return getStatus();
        },
        stop() {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            if (ownsMonitoring) dependencies.stopMonitoring(false);
            ownsMonitoring = false;
            state = dependencies.getSettings().enabled ? 'stopped' : 'disabled';
            publish();
        }
    };
}

export { DEFAULT_COLLECTOR_SETTINGS };
