import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

type Handle = { app: ElectronApplication; page: Page; root: string; errors: string[] };
const test = base.extend<{ shell: Handle }>({
    shell: async ({}, use) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-shell-'));
        const app = await electron.launch({ args: [process.cwd()], env: { ...process.env,
            IBM_EYE_STORE_DIR: path.join(root, 'store'), IBM_EYE_USER_DATA_DIR: path.join(root, 'user')
        } });
        try {
            const page = await app.firstWindow();
            const errors: string[] = [];
            page.on('pageerror', e => errors.push(e.message));
            await expect(page.locator('#connect')).toBeEnabled();
            await use({ app, page, root, errors });
            expect(errors).toEqual([]);
        } finally { await app.close(); await fs.rm(root, { recursive: true, force: true }); }
    }
});

test('bounds Connect, reveals fields on request and retains theme/Support at native sizes', async ({ shell }, info) => {
    const { app, page } = shell;
    await expect(page.locator('#connection-fields')).toBeHidden();
    await expect(page.locator('#saved-hint')).toContainText('dummy');
    await expect(page.locator('[data-app-nav], [data-app-destination]')).toHaveCount(0);
    for (const size of [[1440, 900], [1024, 768], [560, 600]]) {
        await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size);
        expect((await page.locator('.connection-layout').boundingBox())!.width).toBeLessThanOrEqual(450);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('.app-footer')).toHaveCSS('opacity', '1');
        await page.locator('#plan-panel > summary').click();
        const menu = (await page.locator('.plan-panel-body').boundingBox())!;
        expect(menu.x).toBeGreaterThanOrEqual(0);
        expect(menu.x + menu.width).toBeLessThanOrEqual(size[0]);
        await page.locator('#development-plan-select').press('Escape');
        await page.screenshot({ path: info.outputPath(`connect-${size[0]}.png`), fullPage: true });
    }
    await page.locator('#theme-menu > summary').click();
    await page.locator('[data-theme-id="night-console"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'night-console');
    await page.screenshot({ path: info.outputPath('connect-dark.png'), fullPage: true });
    await page.locator('#edit-connection').click();
    await expect(page.locator('#connection-fields')).toBeVisible();
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
    await page.locator('#connection-name').fill('Unfinished rename');
    await expect(page.locator('#connection-name')).toHaveValue('Unfinished rename');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('connections-updated', []));
    await expect(page.locator('#connection-name')).toHaveValue('Unfinished rename');
    await page.locator('#cancel-edit-connection').click();
    await expect(page.locator('#connection-fields')).toBeHidden();
    await expect(page.locator('#connection-name')).toHaveValue('Demo connection');
    await page.locator('#support-menu > summary').click();
    await expect(page.locator('#support-send-diagnostics')).toBeVisible();
    await page.locator('#support-send-diagnostics').press('Escape');
    await expect(page.locator('#support-menu')).not.toHaveAttribute('open');
});

test('blocks disconnected workspace routes, allows them after connecting, and blocks them again after disconnect', async ({ shell }) => {
    const { page } = shell;
    const blockedRoutes = async () => {
        for (const method of ['navigateToMonitor', 'navigateToSettings', 'navigateToKnowledge'] as const) {
            const error = await page.evaluate(async (method) => {
                try { await window.electronAPI[method](); return ''; }
                catch (error) { return String(error); }
            }, method);
            expect(error).toContain('Not connected to IBM i');
            await expect(page.locator('#connect')).toBeVisible();
            await expect(page.locator('[data-app-destination]')).toHaveCount(0);
        }
    };
    await blockedRoutes();
    await page.locator('#connect').click();
    await expect(page.locator('[data-app-nav] button')).toHaveText(['ActionBoard', 'Knowledge', 'Settings']);
    await page.locator('[data-app-destination="settings"]').click();
    await expect(page.locator('[data-app-destination="settings"]')).toHaveAttribute('aria-current', 'page');
    await page.locator('[data-app-destination="knowledge"]').click();
    await expect(page.locator('#knowledge-empty')).toBeVisible();
    await page.locator('[data-app-destination="board"]').click();
    await expect(page.locator('.job-row').first()).toBeVisible();
    await page.evaluate(() => window.electronAPI.disconnect());
    await expect(page.locator('#connect')).toBeVisible();
    await blockedRoutes();
});

test('renames the same encrypted profile, restores it after reload, and opens first-use setup after delete', async ({ shell }) => {
    const { app, page } = shell;
    // Only the IBM i transport is stubbed. Validation, save IPC, IDs, encryption and disk store stay real.
    await app.evaluate(async () => {
        const { createRequire } = process.getBuiltinModule('module');
        const localRequire = createRequire(process.cwd() + '/package.json');
        const Db = localRequire('./dist/services/ibmi.js').default;
        Db.prototype.connect = async () => {};
        Db.prototype.query = async () => ({ data: [] });
        Db.prototype.close = () => {};
    });
    await page.locator('#edit-connection').click();
    await page.locator('#connection-name').fill('Operations renamed');
    await page.locator('#password').fill('shell-profile-test-secret');
    await page.locator('#save-connection').click();
    await expect(page.locator('#connection-fields')).toBeHidden();
    await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
    const profiles = await page.evaluate(() => window.electronAPI.loadConnections());
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: 'demo-connection', name: 'Operations renamed', password: 'shell-profile-test-secret' });
    const stored = await fs.readFile(path.join(shell.root, 'store', 'connections-dev.json'), 'utf8');
    expect(stored).not.toContain('shell-profile-test-secret');
    await page.reload();
    await expect(page.locator('#connection-name')).toHaveValue('Operations renamed');
    await page.locator('#delete-connection').click();
    await expect(page.locator('#connection-fields')).toBeVisible();
    await expect(page.locator('#connection-name')).toHaveValue('');
    await expect(page.locator('#saved-count')).toHaveText('0 saved profiles');
    await page.locator('#connection-name').fill('New operations');
    await page.locator('#system').fill('test-only.invalid');
    await page.locator('#username').fill('TEST');
    await page.locator('#password').fill('test-only-secret');
    await page.locator('#port').fill('65536');
    await page.locator('#save-connection').click();
    expect(await page.evaluate(() => window.electronAPI.loadConnections())).toHaveLength(0);
    await page.locator('#port').fill('8076');
    await page.locator('#save-connection').click();
    await expect(page.locator('#connection-fields')).toBeHidden();
    const created = await page.evaluate(() => window.electronAPI.loadConnections());
    expect(created).toHaveLength(1);
    expect(created[0].id).not.toBe('demo-connection');
});

test('makes profile-load and connection errors retryable without losing input', async ({ shell }) => {
    const { app, page } = shell;
    await app.evaluate(({ ipcMain }) => {
        let count = 0;
        ipcMain.removeHandler('load-connections');
        ipcMain.handle('load-connections', () => {
            if (!count++) throw new Error('Fixture read failure');
            return [{ id: 'retry', name: 'Retry system', host: 'test.invalid', port: 8076, user: 'OPS', password: 'fake' }];
        });
        ipcMain.removeHandler('connect-to-system');
        ipcMain.handle('connect-to-system', () => ({ success: false, error: 'Unable to connect. Check address and retry.' }));
    });
    await page.reload();
    await expect(page.locator('#retry-profiles')).toBeVisible();
    await page.locator('#retry-profiles').click();
    await expect(page.locator('#saved-connections')).toHaveValue('retry');
    await page.locator('#connect').click();
    await expect(page.locator('#connection-action-message')).toContainText('Unable to connect');
    await expect(page.locator('#connect')).toBeEnabled();
    await page.locator('#edit-connection').click();
    await expect(page.locator('#system')).toHaveValue('test.invalid');
    await expect(page.locator('#password')).toHaveValue('fake');
    await page.locator('#connect').click();
    await expect(page.locator('#connection-action-message')).toContainText('Unable to connect');
});

test('keeps monitoring, job windows, selection, filters and the unsent AI draft through all destinations', async ({ shell }) => {
    const { page, app } = shell;
    await page.locator('#connect').click();
    await expect(page.locator('.job-row').first()).toBeVisible();
    const initial = await page.evaluate(() => window.electronAPI.getMonitoringState());
    const identity = await page.evaluate(() => window.electronAPI.getConnectionState());
    await page.locator('.job-row').first().click();
    await expect.poll(async () => (await app.windows()).filter(p => p.url().includes('job-task.html')).length).toBe(1);
    const selected = await page.locator('.job-row.is-selected').getAttribute('data-job-name');
    await page.locator('#jobs-search-input').fill('QBATCH');
    await page.locator('#ai-assistant-input').fill('Keep this unfinished investigation');
    await page.locator('[data-app-destination="knowledge"]').click();
    await expect(page.locator('#knowledge-empty')).toContainText('Your library is empty');
    await page.locator('#knowledge-analyze').click();
    await expect(page.locator('h1')).toContainText('Object analysis');
    await page.evaluate(() => window.electronAPI.navigateToKnowledge());
    await page.locator('[data-app-destination="settings"]').click();
    await expect(page.locator('[data-app-destination="settings"]')).toHaveAttribute('aria-current', 'page');
    expect((await page.evaluate(() => window.electronAPI.getMonitoringState())).active).toBe(initial.active);
    await page.locator('[data-app-destination="board"]').click();
    await expect(page.locator('#ai-assistant-input')).toHaveValue('Keep this unfinished investigation');
    await expect(page.locator('#jobs-search-input')).toHaveValue('QBATCH');
    await expect(page.locator('#board-ai-scope')).toHaveAttribute('title', new RegExp(selected!.replaceAll('/', '\\/')));
    expect((await app.windows()).filter(p => p.url().includes('job-task.html'))).toHaveLength(1);
    expect((await page.evaluate(() => window.electronAPI.getConnectionState())).currentConnection?.name).toBe(identity.currentConnection?.name);
});
