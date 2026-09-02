import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

async function launchTestApp(options: { forceFree?: boolean } = {}): Promise<{
    electronApp: ElectronApplication;
    page: Page;
    cleanup: () => Promise<void>;
}> {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-settings-e2e-'));
    const homeDirectory = path.join(sandboxRoot, 'home');
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(homeDirectory, { recursive: true }),
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: homeDirectory,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory,
            ...(options.forceFree ? { IMONITOR_PREMIUM_DISABLED: '1' } : {})
        }
    });

    return {
        electronApp,
        page: await electronApp.firstWindow(),
        cleanup: async () => {
            await electronApp.close();
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        }
    };
}

test('opens the dedicated settings page and switches AI provider setup', async () => {
    const app = await launchTestApp();

    try {
        await expect(app.page.locator('#saved-connections')).toHaveValue('demo-connection');
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await app.page.locator('#open-settings').click();
        await expect(app.page.getByRole('heading', { name: 'Configure AI providers and action integrations', exact: true })).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'ClickUp action tracking', exact: true })).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'Slack channel alerts', exact: true })).toBeVisible();

        const aiPanel = app.page.locator('#settings-ai-panel');
        const clickUpPanel = app.page.locator('#settings-clickup-panel');
        const slackPanel = app.page.locator('#settings-slack-panel');
        await expect(clickUpPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(slackPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(aiPanel).not.toHaveAttribute('open', '');
        await expect(clickUpPanel).not.toHaveAttribute('open', '');
        await expect(slackPanel).not.toHaveAttribute('open', '');

        await aiPanel.locator(':scope > summary').click();
        await expect(aiPanel).toHaveAttribute('open', '');
        await expect(clickUpPanel).not.toHaveAttribute('open', '');
        await expect(slackPanel).not.toHaveAttribute('open', '');

        const providerTabs = app.page.locator('#settings-ai-provider-switcher .settings-provider-tab');
        await expect(providerTabs).toHaveCount(4);

        await app.page.locator('#settings-ai-provider-switcher [data-provider-id="anthropic"]').click();
        await expect(app.page.locator('#settings-ai-endpoint-label')).toHaveText('Claude endpoint');
        await expect(app.page.locator('#settings-ai-api-key-label')).toHaveText('Claude API key');
        await expect(app.page.locator('#settings-ai-model-label')).toHaveText('Claude model');

        await app.page.locator('#settings-ai-provider-switcher [data-provider-id="openai"]').click();
        await expect(app.page.locator('#settings-ai-endpoint-label')).toHaveText('API endpoint');
        await expect(app.page.locator('#settings-ai-api-key-label')).toHaveText('OpenAI API key');
        await expect(app.page.locator('#settings-ai-model-label')).toHaveText('OpenAI model');

        await slackPanel.locator(':scope > summary').click();
        await expect(slackPanel).toHaveAttribute('open', '');
        await expect(aiPanel).not.toHaveAttribute('open', '');
        await expect(app.page.locator('#settings-slack-summary-status')).toHaveText('Disabled');
        await expect(app.page.locator('#settings-slack-message-wait')).toBeChecked();
        await expect(app.page.locator('#settings-slack-lock-wait')).toBeChecked();
        await expect(app.page.locator('#settings-slack-high-cpu')).toBeChecked();
        await expect(app.page.locator('#settings-slack-delay-wait')).toBeChecked();
        await expect(app.page.locator('#settings-slack-dequeue-wait')).toBeChecked();
        await expect(app.page.locator('#settings-slack-poll-failure')).toBeChecked();

        await clickUpPanel.locator(':scope > summary').click();
        await expect(clickUpPanel).toHaveAttribute('open', '');
        await expect(clickUpPanel.locator('.premium-panel-overlay-card')).not.toBeVisible();
        await expect(slackPanel).not.toHaveAttribute('open', '');
        const emailInput = app.page.locator('#settings-clickup-user-email');
        const memberIdInput = app.page.locator('#settings-clickup-member-id');
        await expect(emailInput).toBeVisible();
        await expect(memberIdInput).toBeVisible();
        await expect(memberIdInput).toHaveAttribute('readonly', '');
        await expect(clickUpPanel.locator('.settings-target-heading #clickup-load-targets')).toBeVisible();

        await emailInput.fill('support@example.com');
        await app.page.locator('#settings-clickup-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await expect(app.page.locator('#settings-clickup-status')).toHaveText(
            'ClickUp settings saved. Add an API token to resolve the member ID.'
        );

        const emailSettings = await app.page.evaluate(() => window.electronAPI.getClickUpSettings());
        expect(emailSettings.userEmail).toBe('support@example.com');
        expect(emailSettings.memberId).toBe('');

        await app.page.evaluate(() => window.electronAPI.saveClickUpSettings({
            userEmail: 'support@example.com',
            memberId: '998877',
            assigneeUserId: '998877'
        }));
        await app.page.reload();
        await app.page.locator('#settings-clickup-panel > summary').click();
        await expect(app.page.locator('#settings-clickup-user-email')).toHaveValue('support@example.com');
        await expect(app.page.locator('#settings-clickup-member-id')).toHaveValue('998877');
    } finally {
        await app.cleanup();
    }
});

test('shows the Slack configuration as a Premium preview on the Free plan', async () => {
    const app = await launchTestApp({ forceFree: true });

    try {
        await app.page.evaluate(() => window.electronAPI.navigateToSettings());
        await expect(app.page.getByRole('heading', { name: 'Configure AI providers and action integrations', exact: true })).toBeVisible();

        const slackPanel = app.page.locator('#settings-slack-panel');
        await expect(app.page.locator('#settings-slack-summary-status')).toContainText('Premium');
        await slackPanel.locator(':scope > summary').click();
        await expect(slackPanel).toHaveAttribute('open', '');
        await expect(slackPanel.locator('.premium-panel-overlay-card')).toBeVisible();
        await expect(app.page.locator('#settings-slack-webhook')).toBeDisabled();
    } finally {
        await app.cleanup();
    }
});
