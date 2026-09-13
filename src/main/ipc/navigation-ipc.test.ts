import { beforeEach, describe, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));
import { registerNavigationIpc } from './navigation-ipc';

function setup(connected: boolean) {
    const deps = {
        canOpenMonitor: () => connected,
        loadMonitorPage: vi.fn(), loadConnectionPage: vi.fn(), loadSettingsPage: vi.fn(),
        loadKnowledgePage: vi.fn(), loadObjectAnalysisPage: vi.fn(), openJobTaskWindow: vi.fn(),
        openExternalUrl: vi.fn(), recordActivity: vi.fn()
    };
    registerNavigationIpc(deps);
    return deps;
}
beforeEach(() => handlers.clear());
describe('main workspace navigation', () => {
    it('keeps the board behind an active connection', async () => {
        const deps = setup(false);
        await expect(handlers.get('navigate-to-monitor')!()).rejects.toThrow('Not connected');
        expect(deps.loadMonitorPage).not.toHaveBeenCalled();
    });
    it('allows pre-connection settings and local code entry through Knowledge', async () => {
        const deps = setup(false);
        await handlers.get('navigate-to-knowledge')!();
        await handlers.get('navigate-to-settings')!();
        expect(deps.loadKnowledgePage).toHaveBeenCalledOnce();
        expect(deps.loadSettingsPage).toHaveBeenCalledOnce();
        expect(deps.loadConnectionPage).not.toHaveBeenCalled();
        expect(deps.loadMonitorPage).not.toHaveBeenCalled();
        expect(deps.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ area: 'navigation', message: 'Opened the Knowledge workspace.' }));
    });
    it('returns to the connected board without replacing the connection page', async () => {
        const deps = setup(true);
        await handlers.get('navigate-to-monitor')!();
        expect(deps.loadMonitorPage).toHaveBeenCalledOnce();
        expect(deps.loadConnectionPage).not.toHaveBeenCalled();
    });
});
