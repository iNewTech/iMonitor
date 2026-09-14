import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const jobs = Array.from({ length: 32 }, (_, i) => ({
    JOB_NAME: `${100000 + i}/OPS/JOB${i}`, JOB_NAME_SHORT: `JOB${i}`, SUBSYSTEM: i % 2 ? 'QHTTPSVR' : 'QBATCH',
    SUBSYSTEM_JOB: `${i % 2 ? 'QHTTPSVR' : 'QBATCH'}/JOB${i}`, FUNCTION_NAME: `Business operation ${i}`,
    STATUS: i === 1 ? 'MSGW' : 'RUN', CPU: i === 0 ? 92 : 2, CURRENT_USER: 'OPS'
}));
const alerts = [
    { id: 'cpu-review', jobName: jobs[0].JOB_NAME, kind: 'highCpu', title: 'CPU above 80%', severity: 'warning', isActive: true, owner: 'reviewer', workflowStatus: 'claimed', timeline: [] },
    { id: 'message-review', jobName: jobs[1].JOB_NAME, kind: 'messageWait', title: 'Operator reply needed', severity: 'critical', isActive: true, owner: '', workflowStatus: 'new', timeline: [] }
];
type Handle = { app: ElectronApplication; page: Page; errors: string[] };
const test = base.extend<{ board: Handle }>({
    board: async ({}, use) => {
        const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-board-review-'));
        const app = await electron.launch({ args: [process.cwd()], env: { ...process.env,
            IBM_EYE_STORE_DIR: path.join(sandbox, 'store'), IBM_EYE_USER_DATA_DIR: path.join(sandbox, 'user')
        } });
        try {
            const page = await app.firstWindow();
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await app.evaluate(({ ipcMain }, fixtures) => {
                const state = { requests: [] as unknown[], settingsWrites: [] as unknown[] };
                (globalThis as any).boardReview = state;
                const replace = (channel: string, handler: (...args: any[]) => any) => {
                    ipcMain.removeHandler(channel); ipcMain.handle(channel, handler);
                };
                replace('get-active-alerts', () => fixtures);
                replace('get-app-flags', () => ({ operatorName: 'reviewer' }));
                replace('get-ai-settings', () => ({ enabled: true, provider: 'ollama', model: 'review-model', endpoint: 'http://localhost:11434' }));
                replace('get-ai-availability', () => ({ enabled: true, healthy: true, provider: 'ollama', providerLabel: 'Ollama', selectedModel: 'review-model', availableModels: ['review-model', 'another-model'], message: 'Ready' }));
                replace('ask-ai-assistant', (_event, request) => { state.requests.push(request); return { success: true, reply: 'Check current job evidence before any action.' }; });
                replace('save-ai-settings', (_event, request) => { state.settingsWrites.push(request); return request; });
            }, alerts);
            await page.locator('#connect').click();
            await expect(page.locator('.job-row').first()).toBeVisible();
            await page.evaluate(() => window.electronAPI.stopMonitoring());
            await pushSnapshot(app);
            await use({ app, page, errors });
            expect(errors).toEqual([]);
        } finally { await app.close(); await fs.rm(sandbox, { recursive: true, force: true }); }
    }
});
async function pushSnapshot(app: ElectronApplication, data = jobs) {
    await app.evaluate(({ BrowserWindow }, value) => {
        const page = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/monitor.html'))!;
        page.webContents.send('status-update', { data: value.jobs, generatedAt: '2026-09-13T10:30:00.000Z' });
        page.webContents.send('monitoring-history-updated', [{
            timestamp: '2026-09-13T10:30:00.000Z', totalJobs: value.jobs.length,
            peakCpu: Math.max(0, ...value.jobs.map(job => job.CPU)),
            runningJobs: value.jobs.filter(job => job.STATUS === 'RUN').length,
            waitingJobs: value.jobs.filter(job => job.STATUS === 'MSGW').length,
            messageWaitJobs: value.jobs.filter(job => job.STATUS === 'MSGW').length,
            lockWaitJobs: 0, highCpuJobs: value.jobs.filter(job => job.CPU > 80).length
        }]);
        page.webContents.send('alerts-updated', value.alerts);
    }, { jobs: data, alerts });
}

test('keeps one compact workspace at desktop sizes, with accessible secondary features', async ({ board }, testInfo) => {
    const { page, app } = board;
    await expect(page.locator('#ai-assistant-status')).toBeHidden();
    await expect(page.locator('#ibmeyeai-widget')).toBeHidden();
    await expect(page.locator('#system-stats th')).toHaveText(['Job', 'Current condition', 'CPU', 'Owner']);
    await expect(page.locator('.job-row').first().locator('.job-condition > span')).toHaveText('High CPU');
    await expect(page.locator('.job-row').first().locator('.job-owner-chip')).toHaveText('reviewer');
    await expect(page.locator('#board-history-panel')).toHaveAttribute('open', '');
    await expect(page.getByRole('heading', { name: 'Live activity overview' })).toBeVisible();
    for (const [width, height] of [[560, 600], [1024, 768], [1440, 900]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
        const form = await page.locator('#ai-assistant-form').boundingBox();
        const input = await page.locator('#ai-assistant-input').boundingBox();
        const controls = await page.locator('.ai-composer-controls').boundingBox();
        expect(input!.width).toBeGreaterThan(form!.width - 35);
        expect(controls!.y).toBeGreaterThanOrEqual(input!.y + input!.height);
        expect(form!.height).toBeLessThan(130);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const overview = (await page.locator('#board-history-panel').boundingBox())!;
        const jobsToolbar = (await page.locator('.actionboard-jobs-panel .jobs-toolbar').boundingBox())!;
        expect(overview.y + overview.height).toBeLessThanOrEqual(jobsToolbar.y);
        expect(overview.height).toBeLessThan(250);
        await expect(page.locator('#board-history-panel .trend-chart')).toHaveCount(3);
        for (const chart of await page.locator('#board-history-panel .trend-chart').all()) await expect(chart).toBeVisible();
        const shot = testInfo.outputPath(`board-${width}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        await testInfo.attach(`Board ${width}`, { path: shot, contentType: 'image/png' });
    }
    await page.locator('#theme-menu-trigger').click();
    await page.locator('[data-theme-id="night-console"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'night-console');
    await expect(page.locator('#system-stats tbody td').first()).toHaveCSS('background-color', 'rgb(23, 29, 32)');
    const dark = testInfo.outputPath('board-dark.png');
    await page.screenshot({ path: dark, fullPage: true });
    await testInfo.attach('Dark board', { path: dark, contentType: 'image/png' });
    await page.locator('#board-workspace-menu > summary').click();
    await expect(page.locator('#open-object-analysis')).toBeVisible();
    await page.getByRole('button', { name: 'Incident history', exact: true }).click();
    await expect(page.locator('.alerts-panel')).toBeVisible();
    await page.locator('#board-workspace-menu > summary').click();
    await page.locator('#open-support-outcomes').click();
    await expect(page.locator('#support-outcomes-panel')).toBeVisible();
    await page.locator('#board-workspace-menu > summary').click();
    await page.locator('#board-companion-toggle').click();
    await expect(page.locator('#ibmeyeai-widget')).toBeVisible();
    await page.locator('#board-workspace-menu > summary').click();
    await page.locator('#board-companion-toggle').click();
    await expect(page.locator('#ibmeyeai-widget')).toBeHidden();
    expect(await page.evaluate(() => Boolean(document.querySelector('#job-queues-panel')!.compareDocumentPosition(document.querySelector('.app-footer')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

test('shows live activity on entry, updates while collapsed and restores the overview on reconnect', async ({ board }) => {
    const { app, page } = board;
    const overview = page.locator('#board-history-panel');
    await expect(overview).toHaveAttribute('open', '');
    const sendHistory = async (history: unknown[]) => app.evaluate(({ BrowserWindow }, history) => {
        BrowserWindow.getAllWindows()[0].webContents.send('monitoring-history-updated', history);
    }, history);
    await sendHistory([]);
    await expect(page.locator('#jobs-history-chart')).toContainText('No data yet');
    await expect(page.locator('#jobs-history-note')).toHaveText('Waiting for snapshot history.');
    await page.locator('#ai-assistant-input').fill('Keep my investigation');
    await overview.locator(':scope > summary').focus();
    await overview.locator(':scope > summary').press('Enter');
    await expect(overview).not.toHaveAttribute('open', '');
    await sendHistory([
        { totalJobs: 12, peakCpu: 25, runningJobs: 10, waitingJobs: 2, messageWaitJobs: 1, lockWaitJobs: 1 },
        { totalJobs: 18, peakCpu: 42.5, runningJobs: 15, waitingJobs: 3, messageWaitJobs: 2, lockWaitJobs: 1 }
    ]);
    await expect(page.locator('#jobs-history-value')).toHaveText('18 jobs');
    await expect(overview).not.toHaveAttribute('open', '');
    await overview.locator(':scope > summary').press('Enter');
    await expect(page.locator('#cpu-history-value')).toHaveText('42.50%');
    await expect(page.locator('#wait-history-value')).toHaveText('3 waits');
    await expect(page.locator('#wait-history-note')).toContainText('2 MSGW and 1 LCKW');
    await expect(page.locator('#jobs-history-chart .trend-line')).toHaveAttribute('d', /L /);
    await expect(page.locator('#cpu-history-chart')).toHaveAccessibleName(/Peak job CPU 42.50%/);
    await expect(page.locator('#ai-assistant-input')).toHaveValue('Keep my investigation');
    await overview.locator(':scope > summary').click();
    await page.evaluate(() => window.electronAPI.disconnect());
    await page.locator('#connect').click();
    await expect(overview).toHaveAttribute('open', '');
    await expect(page.locator('#jobs-history-chart')).toBeVisible();
});

test('preserves row identity, scroll, keyboard focus, filters and drafts across polling', async ({ board }) => {
    const { page, app } = board;
    await page.locator('#jobs-mine-filter').click();
    await expect(page.locator('.job-row')).toHaveCount(1);
    await expect(page.locator('.job-row')).toContainText('reviewer');
    await page.locator('#jobs-mine-filter').click();
    await page.locator('#jobs-status-filter').selectOption('HIGH_CPU');
    await expect(page.locator('.job-row')).toHaveCount(1);
    await page.locator('#jobs-status-filter').selectOption('ALL');
    await page.locator('.board-filter-menu > summary').click();
    await page.locator('#refresh-interval').selectOption('custom');
    await page.locator('#custom-refresh-seconds').fill('17');
    await page.locator('#custom-refresh-seconds').press('Tab');
    await expect(page.locator('#current-refresh')).toHaveText('Every 17 seconds');
    await expect(page.locator('.job-row').filter({ hasText: 'NIGHTBCH' })).toBeVisible();
    await page.locator('#stop-monitoring').click();
    await page.locator('.board-filter-menu > summary').click();
    await pushSnapshot(app);
    await expect(page.locator('.job-row')).toHaveCount(32);
    await page.locator('#ai-assistant-input').fill('A draft that must survive refresh\nLine two\nLine three\nLine four');
    const input = await page.locator('#ai-assistant-input').boundingBox();
    expect(input!.height).toBeGreaterThan(65);
    const row = page.locator('.job-row').nth(12);
    await row.focus();
    const scroll = await page.locator('#system-stats').evaluate(node => node.scrollTop);
    const before = await page.locator('#jobs-last-poll').innerText();
    await pushSnapshot(app, jobs.map(job => ({ ...job, CPU: job.CPU + .1 })));
    await expect(row).toBeFocused();
    expect(await page.locator('#system-stats').evaluate(node => node.scrollTop)).toBe(scroll);
    await expect(page.locator('#ai-assistant-input')).toHaveValue(/must survive refresh/);
    await page.locator('#jobs-search-input').fill('JOB12');
    await expect(page.locator('#jobs-last-poll')).toHaveText(before);
    await pushSnapshot(app);
    await expect(page.locator('#jobs-search-input')).toBeFocused();
    await expect(page.locator('#jobs-search-input')).toHaveValue('JOB12');
    await page.locator('#board-workspace-menu > summary').click();
    await page.locator('#disconnect').click();
    await expect(page.locator('#connect')).toBeVisible();
    await page.locator('#connect').click();
    await expect(page.locator('#jobs-search-input')).toHaveValue('JOB12');
    await page.evaluate(() => window.electronAPI.stopMonitoring());
    await pushSnapshot(app);
    await expect(page.locator('.job-row')).toHaveCount(1);
    await page.locator('.board-filter-menu > summary').click();
    await page.locator('#jobs-subsystem-filter').selectOption('QBATCH');
    await pushSnapshot(app, jobs.filter(job => job.SUBSYSTEM !== 'QBATCH'));
    await expect(page.locator('#jobs-subsystem-filter')).toHaveValue('QBATCH');
    await expect(page.locator('#system-stats tbody')).toContainText('No jobs match');
});

test('keeps conversation on demand, model setup guarded and AI context explicit', async ({ board }) => {
    const { page, app } = board;
    await page.locator('#ai-model-menu > summary').click();
    const options = await page.locator('#ai-provider-quick option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, disabled: (node as HTMLOptionElement).disabled })));
    expect(options.filter(option => option.value !== 'ollama').every(option => option.disabled)).toBe(true);
    await page.locator('#ai-provider-quick').focus();
    await expect(page.locator('#imonitor-context-tooltip')).toBeVisible();
    await page.locator('#ai-provider-quick').press('Escape');
    await expect(page.locator('#ai-model-menu')).not.toHaveAttribute('open', '');
    await expect(page.locator('#ai-model-menu > summary')).toBeFocused();
    await expect(page.locator('#imonitor-context-tooltip')).toBeHidden();
    await page.locator('#ai-assistant-input').fill('Explain current system issues');
    await page.locator('#ai-assistant-input').press('Enter');
    await expect(page.locator('#ai-chat-transcript')).toContainText('Check current job evidence');
    await page.locator('#ai-conversation-toggle').click();
    await pushSnapshot(app);
    await expect(page.locator('#ai-chat-shell')).toBeHidden();
    await page.locator('#ai-conversation-toggle').click();
    await expect(page.locator('#ai-chat-transcript')).toContainText('Explain current system issues');
    await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('get-ai-availability');
        ipcMain.handle('get-ai-availability', () => ({ enabled: true, provider: 'ollama', healthy: false, availableModels: [], message: 'Provider disconnected. Configure AI or retry.' }));
    });
    await pushSnapshot(app);
    await expect(page.locator('#ai-assistant-status')).toContainText('Provider disconnected');
    await expect(page.locator('#ai-assistant-submit')).toBeDisabled();
    await page.locator('#ai-model-menu > summary').click();
    await expect(page.locator('#ai-model-quick')).toBeDisabled();
    await expect(page.locator('#open-ai-settings')).toBeEnabled();
    const calls = await app.evaluate(() => (globalThis as any).boardReview.requests);
    expect(calls).toHaveLength(1);
    expect(calls[0].selectedJobName).toBeUndefined();
});

test('handles long labels, empty jobs and collector or polling failures without clipping', async ({ board }) => {
    const { page, app } = board;
    const longModel = 'local-team-model-with-a-long-version-and-build-identifier:2026-09';
    await app.evaluate(({ ipcMain, BrowserWindow }, model) => {
        ipcMain.removeHandler('get-ai-settings');
        ipcMain.handle('get-ai-settings', () => ({ enabled: true, provider: 'ollama', model }));
        ipcMain.removeHandler('get-ai-availability');
        ipcMain.handle('get-ai-availability', () => ({ enabled: true, healthy: true, provider: 'ollama', selectedModel: model, availableModels: [model] }));
        BrowserWindow.getAllWindows()[0].setSize(560, 600);
    }, longModel);
    await pushSnapshot(app);
    await expect(page.locator('#ai-model-label')).toContainText(longModel);
    expect(await page.locator('#ai-model-menu .ai-model-picker').evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(190);
    await page.locator('#ai-model-menu > summary').click();
    await expect(page.locator('#ai-model-quick')).toHaveValue(longModel);
    await pushSnapshot(app);
    await expect(page.locator('#ai-model-menu')).toHaveAttribute('open', '');
    await expect(page.locator('#ai-model-quick')).toHaveValue(longModel);
    await page.locator('#ai-model-menu > summary').click();
    await pushSnapshot(app, []);
    await expect(page.locator('#system-stats tbody')).toContainText('No active jobs');
    await expect(page.locator('#superpanel-focus-next')).toBeDisabled();
    for (const [state, message] of [['starting', 'Starting background collection'], ['running', 'Collecting in background'], ['degraded', 'needs attention']]) {
        await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('collector-status-updated', { state }), state);
        await expect(page.locator('#board-collector-status')).toContainText(message);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('monitoring-error', 'Connection lost'));
    await expect(page.locator('#app-status-message')).toContainText('Monitoring needs attention');
    await expect(page.locator('#system-stats tbody')).toContainText('Retrying automatically');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
