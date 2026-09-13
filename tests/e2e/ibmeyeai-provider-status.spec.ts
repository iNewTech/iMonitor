import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

async function launchTestApp(availableModels = ['review-model']): Promise<{
    electronApp: ElectronApplication;
    page: Page;
    cleanup: () => Promise<void>;
}> {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ibmeye-provider-e2e-'));
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory
        }
    });

    // Mock provider discovery and completions before entering the monitor. Real
    // renderer/preload paths stay intact; no model or network service is needed.
    await electronApp.firstWindow();
    await electronApp.evaluate(({ ipcMain }, models) => {
        const state = { requests: [] as Array<{ message: string; selectedJobName?: string; scope?: string }> };
        (globalThis as unknown as { providerReview: typeof state }).providerReview = state;
        ipcMain.removeHandler('get-ai-settings');
        ipcMain.handle('get-ai-settings', () => ({
            enabled: true, provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'review-model',
            apiKey: '', temperature: 0.2, replyStyle: '', historyLimit: 12, activityLimit: 12, jobLimit: 8, alertLimit: 8
        }));
        ipcMain.removeHandler('get-ai-availability');
        ipcMain.handle('get-ai-availability', () => ({
            enabled: true, provider: 'ollama', providerLabel: 'Ollama', providerFamily: 'ollama',
            endpoint: 'http://127.0.0.1:11434', selectedModel: 'review-model', availableModels: models,
            healthy: true, featureAccess: 'included', message: 'Mock provider ready.'
        }));
        ipcMain.removeHandler('ask-ai-assistant');
        ipcMain.handle('ask-ai-assistant', (_event, request) => {
            state.requests.push(request);
            return { success: true, reply: `Mock analysis ${state.requests.length}: check the incident evidence.` };
        });
    }, availableModels);

    return {
        electronApp,
        page: await electronApp.firstWindow(),
        cleanup: async () => {
            await electronApp.close();
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        }
    };
}

async function openDemoMonitor(page: Page) {
    await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
    await page.locator('#connect').click();
    await expect(page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
    await expect(page.locator('.actionboard-jobs-panel')).toHaveAttribute('open', '');
    await expect(page.locator('#superpanel-ai-slot #ai-assistant-form')).toBeVisible();
    await expect(page.locator('#ai-model-menu > summary')).toBeVisible();
    await expect(page.locator('#ai-provider-quick')).toBeHidden();
    await expect(page.locator('#ai-model-quick')).toBeHidden();
    await expect(page.locator('.job-row.has-incident').first()).toBeVisible();
}

async function aiRequests(app: ElectronApplication) {
    return app.evaluate(() => (globalThis as unknown as {
        providerReview: { requests: Array<{ message: string; selectedJobName?: string; scope?: string }> }
    }).providerReview.requests);
}

for (const source of [
    { name: 'live models', models: ['review-model'], hint: 'Live models loaded (1)' },
    { name: 'missing model setup', models: [], hint: 'No available models. Configure AI in Settings.' }
]) {
    test(`shows ${source.name} in the compact composer and floating widget`, async () => {
        const app = await launchTestApp(source.models);
        try {
            await openDemoMonitor(app.page);
            await expect(app.page.locator('#ai-provider-model-source')).toHaveText(source.hint);
            await app.page.locator('#board-workspace-menu > summary').click();
            await app.page.locator('#board-companion-toggle').click();
            await expect(app.page.locator('#ibmeyeai-widget')).toHaveAttribute('data-open', 'true');
            await expect(app.page.locator('#ibmeyeai-widget-model-source')).toHaveText(source.hint);
            await expect(app.page.locator('#ai-provider-quick')).toHaveValue('ollama');
            await expect(app.page.locator('#ibmeyeai-widget-provider')).toHaveValue('ollama');
            if (source.models.length) {
                await expect(app.page.locator('#ai-model-quick')).toHaveValue('review-model');
                await expect(app.page.locator('#ibmeyeai-widget-model')).toHaveValue('review-model');
            }
            expect(await aiRequests(app.electronApp)).toHaveLength(0);
        } finally {
            await app.cleanup();
        }
    });
}

test('sends presets from the compact composer and exposes incident and job AI in native tasks', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        await expect(app.page.getByTestId('ai-prompt-incident-summary')).toBeHidden();
        await app.page.locator('.ai-attach-menu > summary').click();
        // Exercise keyboard activation here; pointer hit testing has its own
        // regression below so an overlapping menu cannot hide prompt coverage.
        await app.page.getByTestId('ai-prompt-incident-summary').focus();
        await app.page.getByTestId('ai-prompt-incident-summary').press('Enter');
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('current incident picture');
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('Mock analysis 1');
        await expect(app.page.locator('#ai-assistant-input')).toHaveValue('');
        await expect(app.page.locator('#ai-assistant-refresh')).toHaveCount(0);
        const requests = await aiRequests(app.electronApp);
        expect(requests).toHaveLength(1);
        expect(requests[0].message).toContain('current incident picture');
        await app.page.locator('#board-workspace-menu > summary').click();
        await app.page.locator('#board-companion-toggle').click();
        await expect(app.page.locator('#ibmeyeai-widget-transcript')).toContainText('Mock analysis 1');
        await expect(app.page.locator('#ibmeyeai-widget-refresh')).toHaveCount(0);
        await app.page.locator('#ibmeyeai-widget-input').fill('Which evidence should I verify first?');
        await app.page.locator('#ibmeyeai-widget-submit').click();
        await expect(app.page.locator('#ibmeyeai-widget-transcript')).toContainText('Mock analysis 2');
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('Mock analysis 2');
        await app.page.locator('#ibmeyeai-widget-close').click();

        const row = app.page.locator('.job-row.has-incident').first();
        const jobName = await row.getAttribute('data-job-name');
        expect(jobName).toBeTruthy();
        const opened = app.electronApp.waitForEvent('window');
        await row.click();
        const task = await opened;
        await task.waitForLoadState('domcontentloaded');
        await expect(task).toHaveURL(/job-task\.html\?jobName=/);
        await expect(task.locator('#task-qualified-job')).toHaveText(jobName!);
        await expect(task.locator('#task-panel-actions')).toBeVisible();
        await expect(task.getByRole('button', { name: 'Explain Issue', exact: true })).toBeVisible();
        await expect(task.getByRole('button', { name: 'How To Resolve', exact: true })).toBeVisible();
        await task.getByRole('button', { name: 'Explain Issue', exact: true }).click();
        await expect(task.locator('#task-panel-ai')).toBeFocused();
        await expect(task.locator('#task-ai-content')).toContainText('Mock analysis 3');
        await expect(app.page.locator('#ibmeyeai-widget')).toHaveAttribute('data-open', 'false');
        await expect(task.locator('#task-ai-summary')).toBeEnabled();
        await task.locator('#task-ai-resolve').click();
        await expect(task.locator('#task-ai-content')).toContainText('Mock analysis 4');
        await task.locator('#task-ai-summary').click();
        await expect(task.locator('#task-ai-content')).toContainText('Mock analysis 5');
        const taskRequests = (await aiRequests(app.electronApp)).slice(2);
        expect(taskRequests).toHaveLength(3);
        expect(taskRequests.map((request) => request.selectedJobName)).toEqual([jobName, jobName, jobName]);
        expect(taskRequests.map((request) => request.scope)).toEqual(['job', 'job', 'job']);
        expect(taskRequests[0].message).toContain('Explain this alert');
        expect(taskRequests[1].message).toContain('next best operator actions');
        expect(taskRequests[2].message).toContain(`health summary for ${jobName}`);
        await app.page.locator('#ai-assistant-input').fill('Explain this selected job');
        await app.page.locator('#ai-assistant-input').press('Enter');
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('Mock analysis 6');
        expect((await aiRequests(app.electronApp)).at(-1)).toMatchObject({ selectedJobName: jobName, scope: 'job' });
        await app.page.locator('#board-ai-scope').click();
        await app.page.locator('#ai-assistant-input').fill('Summarize the system');
        await app.page.locator('#ai-assistant-input').press('Enter');
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('Mock analysis 7');
        expect((await aiRequests(app.electronApp)).at(-1)).toMatchObject({ scope: 'monitor' });
        expect((await aiRequests(app.electronApp)).at(-1)?.selectedJobName).toBeUndefined();
    } finally {
        await app.cleanup();
    }
});

test('keeps the empty composer short with controls on its bottom row', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);

        const composer = app.page.locator('#superpanel-ai-slot #ai-assistant-form');
        const input = app.page.locator('#ai-assistant-input');
        const picker = app.page.locator('#superpanel-ai-slot .ai-model-picker');
        const composerBox = await composer.boundingBox();
        const inputBox = await input.boundingBox();
        const pickerBox = await picker.boundingBox();

        expect(composerBox).toBeTruthy();
        expect(inputBox).toBeTruthy();
        expect(pickerBox).toBeTruthy();
        expect(composerBox!.height).toBeLessThan(220);
        expect(pickerBox!.y).toBeGreaterThan(inputBox!.y);
        await expect(app.page.locator('#superpanel-ai-slot #ai-chat-shell')).toBeHidden();
    } finally {
        await app.cleanup();
    }
});

test('allows the attachment preset menu to be clicked above the jobs table', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        await app.page.locator('.ai-attach-menu > summary').click();
        await app.page.getByTestId('ai-prompt-incident-summary').click({ timeout: 5000 });
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('Mock analysis 1');
        expect(await aiRequests(app.electronApp)).toHaveLength(1);
    } finally {
        await app.cleanup();
    }
});
