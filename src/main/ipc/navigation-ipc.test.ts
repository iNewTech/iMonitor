import { beforeEach, describe, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));
import { registerNavigationIpc } from './navigation-ipc';
import { buildSupportMailtoUrl } from '../../features/support/support-utils';

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
    it.each(['monitor', 'settings', 'knowledge'])('blocks %s without an active connection, including direct IPC calls', async (page) => {
        const deps = setup(false);
        await expect(handlers.get(`navigate-to-${page}`)!()).rejects.toThrow('Not connected');
        expect(deps.loadMonitorPage).not.toHaveBeenCalled();
        expect(deps.loadSettingsPage).not.toHaveBeenCalled();
        expect(deps.loadKnowledgePage).not.toHaveBeenCalled();
        expect(deps.recordActivity).not.toHaveBeenCalled();
    });
    it('opens Settings and Knowledge after connecting and records the navigation', async () => {
        const deps = setup(true);
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
    it('keeps Connect accessible without a system session', async () => {
        const deps = setup(false);
        await handlers.get('navigate-to-connection')!();
        expect(deps.loadConnectionPage).toHaveBeenCalledOnce();
    });
});

describe('external URL navigation', () => {
    it.each([
        'https://app.clickup.com/t/86abc123?view=activity#comment-1',
        'http://jira.internal:8080/browse/OPS-123',
        'HTTPS://example.com/Path%20With%20Spaces?next=%2Fjobs%3Factive%3Dtrue#details',
        'https://example.com/users/operator@example.com',
        'https://[2001:db8::1]:8443/jobs',
        'mailto:support@example.com',
        'MAILTO:operator+alerts@example.com,backup@example.com?cc=team%40example.com&subject=Help',
        buildSupportMailtoUrl({
            supportEmail: 'support@example.com',
            subject: 'iMonitor diagnostics',
            body: 'Hello,\n\nPlease review diagnostics at /Users/operator/Downloads/report.txt.\nThank you.'
        })
    ])('opens supported URLs unchanged without requiring a system connection: %s', async (target) => {
        const deps = setup(false);
        await expect(handlers.get('open-external-url')!(null, target)).resolves.toEqual({ success: true });
        expect(deps.openExternalUrl).toHaveBeenCalledExactlyOnceWith(target);
    });

    it.each([
        undefined, null, 0, true, {}, ['https://example.com'],
        '', ' ', 'not a URL', '/tmp/report.html', './report.html', '//example.com/path',
        'C:\\Windows\\System32\\cmd.exe', '\\\\server\\share\\run.exe',
        'javascript:alert(1)', 'JAVASCRIPT:alert(1)',
        'file:///tmp/report.html', 'file://server/share/run.exe',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)', 'ftp://example.com/file', 'clickup://task/123',
        'imonitor://connect', 'ms-settings:display', 'shell:AppsFolder',
        'https://user:password@example.com', 'http://user@example.com',
        'https://:password@example.com', 'https://user%40example.com:password@evil.example',
        'https://@example.com',
        'https://', 'https:example.com', 'https:/example.com', 'https:///example.com',
        'https://example.com:invalid', 'https://example.com:65536', 'https://[invalid',
        'https:\\\\example.com', 'https://example.com\\@evil.example',
        ' https://example.com', 'https://example.com ', 'https://example.com/a b',
        'https://exam\nple.com', 'https://example.com/\u0000', 'https://example.com/\u007f',
        'https://example.com/%', 'https://example.com/%ZZ',
        'mailto:', 'mailto:not-an-address', 'mailto://support@example.com',
        'mailto:///support@example.com', 'mailto:user:password@example.com',
        'mailto:user%3Apassword%40example.com', 'mailto:../support@example.com',
        'mailto:support@example.com%0Abcc:other@example.com',
        'mailto:support%00@example.com', 'mailto:support%1b@example.com', 'mailto:support%7f@example.com',
        'mailto:support%ZZexample.com', 'mailto:%FF@example.com',
        'mailto:support@example.com#fragment'
    ])('rejects unsafe or malformed input before reaching the OS: %j', async (target) => {
        const deps = setup(true);
        await expect(handlers.get('open-external-url')!(null, target)).rejects.toThrow('External URL must be');
        expect(deps.openExternalUrl).not.toHaveBeenCalled();
        expect(deps.recordActivity).not.toHaveBeenCalled();
    });

    it('does not coerce objects into URL strings', async () => {
        const deps = setup(true);
        const target = { toString: vi.fn(() => 'https://example.com') };
        await expect(handlers.get('open-external-url')!(null, target)).rejects.toThrow('External URL must be');
        expect(target.toString).not.toHaveBeenCalled();
        expect(deps.openExternalUrl).not.toHaveBeenCalled();
    });

    it('waits for the external opener and preserves its errors', async () => {
        const deps = setup(true);
        let rejectOpen!: (error: Error) => void;
        deps.openExternalUrl.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectOpen = reject; }));
        const result = handlers.get('open-external-url')!(null, 'https://example.com');
        const error = new Error('Unable to launch the browser');
        const assertion = expect(result).rejects.toBe(error);
        rejectOpen(error);
        await assertion;
        expect(deps.openExternalUrl).toHaveBeenCalledOnce();
    });
});
