import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundCollectorRuntime } from './background-collector-runtime';
import { DEFAULT_COLLECTOR_SETTINGS } from '../../features/collector/collector-model';

function createHarness() {
    let settings = { ...DEFAULT_COLLECTOR_SETTINGS };
    let currentConnectionId: string | undefined;
    const collectionRuntime = {
        getHealth: () => ({ collectorStartedAt: null, lastSuccessfulPollAt: null, lastSuccessfulWriteAt: null, consecutiveWriteFailures: 0, lastError: null }),
        markStarted: vi.fn(),
        getInventory: vi.fn(),
        previewPurge: vi.fn(),
        purge: vi.fn(),
        appendPoll: vi.fn(),
        enforceRetention: vi.fn()
    } as never;
    const dependencies = {
        getSettings: () => settings,
        saveSettings: vi.fn((next) => { settings = next; }),
        getConnectionId: () => currentConnectionId,
        connectSavedConnection: vi.fn(async () => ({ success: true })),
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(),
        isMonitoringActive: () => false,
        setLoginItemSettings: vi.fn(),
        collectionRuntime,
        recordActivity: vi.fn(),
        sendToWindow: vi.fn()
    };
    return { runtime: createBackgroundCollectorRuntime(dependencies), dependencies, setConnectionId: (id: string) => { currentConnectionId = id; } };
}

describe('background collector runtime', () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it('does not enable collection without a saved profile', async () => {
        const status = await harness.runtime.applySettings({ enabled: true });
        expect(status.state).toBe('degraded');
        expect(harness.dependencies.startMonitoring).not.toHaveBeenCalled();
        expect(harness.dependencies.setLoginItemSettings).toHaveBeenCalledWith(false);
    });

    it('reconnects and starts read-only monitoring for a configured profile', async () => {
        harness.setConnectionId('system-a');
        const status = await harness.runtime.applySettings({ enabled: true, connectionId: 'system-a' });
        expect(status.state).toBe('running');
        expect(harness.dependencies.startMonitoring).toHaveBeenCalledWith(5000);
        expect(harness.dependencies.setLoginItemSettings).toHaveBeenCalledWith(false);
    });
});
