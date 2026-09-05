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
        await expect(app.page.getByRole('heading', { name: 'Set up your operator workspace', exact: true })).toBeVisible();
        await expect(app.page.getByTestId('settings-page-alerts')).toBeVisible();
        await expect(app.page.getByTestId('settings-page-ai')).toBeVisible();
        await expect(app.page.getByTestId('settings-page-integrations')).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
        await expect(app.page.getByText('Monitoring & notifications', { exact: true })).toBeHidden();
        await expect(app.page.getByText('AI & integrations', { exact: true })).toBeHidden();
        await expect(app.page.locator('#settings-integration-catalog')).toHaveAttribute('data-ready', 'true');
        await expect(app.page.locator('#settings-integration-count')).toHaveText(/\d+ installed · \d+ available/);
        await expect(app.page.locator('#settings-installed-group')).toBeAttached();
        await expect(app.page.locator('#settings-available-group')).toBeAttached();
        await expect(app.page.locator('[data-integration-action-label]')).toHaveCount(5);

        const integrationRows = await app.page.locator('.settings-integration-cards').evaluateAll((containers) => containers.map((container) => {
            const rows = new Map<number, number[]>();
            Array.from(container.children).forEach((card) => {
                const rect = card.getBoundingClientRect();
                const top = Math.round(rect.top);
                const heights = rows.get(top) || [];
                heights.push(Math.round(rect.height));
                rows.set(top, heights);
            });
            return Array.from(rows.values());
        }).flat());
        expect(integrationRows.length).toBeGreaterThan(0);
        integrationRows.forEach((row) => {
            expect(row.length).toBeLessThanOrEqual(2);
            expect(new Set(row).size).toBe(1);
        });

        await app.page.setViewportSize({ width: 760, height: 900 });
        const narrowIntegrationRows = await app.page.locator('.settings-integration-cards').evaluateAll((containers) => containers.map((container) => {
            const rows = new Map<number, number[]>();
            Array.from(container.children).forEach((card) => {
                const rect = card.getBoundingClientRect();
                const top = Math.round(rect.top);
                const heights = rows.get(top) || [];
                heights.push(Math.round(rect.height));
                rows.set(top, heights);
            });
            return Array.from(rows.values());
        }).flat());
        expect(narrowIntegrationRows.length).toBeGreaterThan(0);
        narrowIntegrationRows.forEach((row) => {
            expect(row).toHaveLength(1);
            expect(new Set(row).size).toBe(1);
        });
        await app.page.setViewportSize({ width: 1280, height: 720 });

        await app.page.getByTestId('settings-page-alerts').click();
        await expect(app.page.locator('#settings-alert-panel')).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'Alert delivery & watch rules', exact: true })).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'Integrations', exact: true })).toBeHidden();

        await app.page.getByTestId('settings-page-ai').click();
        await expect(app.page.locator('#settings-ai-panel')).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'Provider setup', exact: true })).toBeVisible();
        await expect(app.page.locator('#settings-alert-panel')).not.toHaveAttribute('open', '');

        await app.page.getByTestId('settings-page-integrations').click();
        await expect(app.page.locator('#settings-integration-catalog')).toBeVisible();
        await expect(app.page.locator('#settings-ai-panel')).not.toHaveAttribute('open', '');

        await app.page.locator('#settings-email-integration-card [data-open-email-settings]').click();
        await expect(app.page.locator('#settings-alert-panel')).toHaveAttribute('open', '');
        await expect(app.page.locator('.email-settings-disclosure')).toHaveAttribute('open', '');

        const aiPanel = app.page.locator('#settings-ai-panel');
        const clickUpPanel = app.page.locator('#settings-clickup-panel');
        const slackPanel = app.page.locator('#settings-slack-panel');
        const smsPanel = app.page.locator('#settings-sms-panel');
        const jiraPanel = app.page.locator('#settings-jira-panel');
        await expect(clickUpPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(slackPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(smsPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(jiraPanel).not.toHaveClass(/premium-preview-overlay/);
        await expect(app.page.locator('[data-premium-feature]')).toHaveCount(3);
        await expect(app.page.locator('[data-premium-feature]').first()).not.toHaveAttribute('hidden', '');
        await app.page.getByTestId('settings-page-ai').click();
        await expect(aiPanel).toHaveAttribute('open', '');
        await expect(clickUpPanel).not.toHaveAttribute('open', '');
        await expect(slackPanel).not.toHaveAttribute('open', '');
        await expect(smsPanel).not.toHaveAttribute('open', '');
        await expect(jiraPanel).not.toHaveAttribute('open', '');

        await expect(clickUpPanel).not.toHaveAttribute('open', '');
        await expect(slackPanel).not.toHaveAttribute('open', '');
        await expect(jiraPanel).not.toHaveAttribute('open', '');

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

        await app.page.getByTestId('settings-page-integrations').click();
        await slackPanel.locator(':scope > summary').click();
        await expect(slackPanel).toHaveAttribute('open', '');
        await expect(aiPanel).not.toHaveAttribute('open', '');
        await expect(app.page.locator('#settings-slack-summary-status')).toHaveText('Disabled');
        await expect(slackPanel.getByText('Alert conditions are managed above')).toBeVisible();
        await expect(slackPanel.getByText('Slack follows the conditions enabled in IBMEye Alerts.')).toBeVisible();
        await expect(slackPanel.locator('.slack-rules-grid')).toHaveCount(0);
        await expect(slackPanel.locator('#settings-slack-enabled')).toHaveCount(0);

        await clickUpPanel.locator(':scope > summary').click();
        await expect(clickUpPanel).toHaveAttribute('open', '');
        await expect(clickUpPanel.locator('.premium-panel-overlay-card')).not.toBeVisible();
        await expect(slackPanel).not.toHaveAttribute('open', '');
        await expect(jiraPanel).not.toHaveAttribute('open', '');
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
        await expect(app.page.getByRole('heading', { name: 'Set up your operator workspace', exact: true })).toBeVisible();
        await expect(app.page.locator('[data-premium-feature]').first()).not.toHaveAttribute('hidden', '');

        const slackPanel = app.page.locator('#settings-slack-panel');
        const smsPanel = app.page.locator('#settings-sms-panel');
        const jiraPanel = app.page.locator('#settings-jira-panel');
        await expect(app.page.locator('#settings-slack-panel .settings-card-premium-badge')).toContainText('Premium');
        await expect(app.page.locator('#settings-slack-summary-status')).toHaveText('Unlock to configure');
        await slackPanel.locator(':scope > summary').click();
        await expect(slackPanel).toHaveAttribute('open', '');
        await expect(slackPanel.locator('.premium-panel-overlay-card')).toBeVisible();
        await expect(app.page.locator('#settings-slack-webhook')).toBeDisabled();
        await expect(slackPanel.locator('.slack-rules-grid')).toHaveCount(0);
        await expect(app.page.locator('#settings-alert-jira')).toBeDisabled();
        await expect(app.page.locator('#settings-alert-sms')).toBeDisabled();
        await expect(app.page.locator('#settings-jira-panel .settings-card-premium-badge')).toContainText('Premium');
        await expect(app.page.locator('#settings-jira-summary-status')).toHaveText('Unlock to configure');
        await jiraPanel.locator(':scope > summary').click();
        await expect(jiraPanel).toHaveAttribute('open', '');
        await expect(jiraPanel.locator('.premium-panel-overlay-card')).toBeVisible();
        await expect(app.page.locator('#settings-jira-base-url')).toBeDisabled();
        await expect(app.page.locator('#settings-sms-panel .settings-card-premium-badge')).toContainText('Premium');
        await expect(app.page.locator('#settings-sms-summary-status')).toHaveText('Unlock to configure');
        await smsPanel.locator(':scope > summary').click();
        await expect(smsPanel).toHaveAttribute('open', '');
        await expect(smsPanel.locator('.premium-panel-overlay-card')).toBeVisible();
        await expect(app.page.locator('#settings-sms-endpoint')).toBeDisabled();
    } finally {
        await app.cleanup();
    }
});
