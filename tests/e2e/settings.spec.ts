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

test('configures the read-only background collector and shows its local inventory', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-alerts').click();

        await expect(app.page.locator('#settings-collector-summary-status')).toHaveText('Off');
        await app.page.locator('#settings-collector-connection').selectOption('demo-connection');
        await app.page.locator('#settings-collector-enabled').check();
        await app.page.locator('#settings-collector-form button[type="submit"]').click();

        await expect(app.page.locator('#settings-collector-summary-status')).toHaveText('Running');
        await expect(app.page.locator('#settings-collector-inventory')).toHaveText(/\d+ records/);
        await expect(app.page.locator('#settings-collector-status')).toContainText('Collecting read-only monitoring data');
    } finally {
        await app.cleanup();
    }
});

test('manages the local knowledge index without exposing provider secrets', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-ai').click();

        const knowledgePanel = app.page.locator('#settings-knowledge-index-panel');
        await expect(knowledgePanel).toBeVisible();
        await expect(app.page.locator('#settings-knowledge-index-summary-status')).toHaveText('Ready');
        await expect(app.page.locator('#settings-knowledge-index-name')).toHaveText('Local lexical index');

        const settings = await app.page.evaluate(() => window.electronAPI.getKnowledgeIndexSettings());
        expect(settings.settings).toMatchObject({ backend: 'local', apiKeyConfigured: false });
        expect(settings.settings).not.toHaveProperty('apiKey');

        await app.page.getByTestId('knowledge-index-manage').click();
        await expect(app.page.locator('#settings-knowledge-index-dialog')).toBeVisible();
        await expect(app.page.locator('#settings-knowledge-index-backend')).toHaveValue('local');
        await expect(app.page.locator('#settings-knowledge-index-backend option[value="qdrant"]')).toHaveAttribute('disabled', '');
        await app.page.locator('#settings-knowledge-index-collection').fill('imonitor-knowledge-test');
        await app.page.getByTestId('knowledge-index-test').click();
        await expect(app.page.locator('#settings-knowledge-index-dialog-status')).toContainText('ready');
        await app.page.getByTestId('knowledge-index-save').click();
        await expect(app.page.locator('#settings-knowledge-index-dialog')).toBeHidden();

        await app.page.getByTestId('knowledge-index-manage').click();
        await expect(app.page.locator('#settings-knowledge-index-collection')).toHaveValue('imonitor-knowledge-test');
        await app.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } finally {
        await app.cleanup();
    }
});

test('keeps the seven settings categories compact and preserves draft values', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-settings').click();
        await expect(app.page.locator('[data-settings-page]')).toHaveCount(7);

        await app.page.getByTestId('settings-page-general').click();
        await expect(app.page.locator('#settings-general-panel')).toBeVisible();
        await expect(app.page.locator('#settings-theme-select')).toHaveValue('operator-light');
        await app.page.locator('#settings-theme-select').selectOption('night-console');
        await app.page.locator('#settings-theme-form button[type="submit"]').click();
        await expect(app.page.locator('#settings-theme-status')).toHaveText('Theme saved.');
        await expect(app.page.locator('body')).toHaveAttribute('data-theme', 'night-console');

        await app.page.getByTestId('settings-page-ai').click();
        await app.page.locator('#settings-ai-endpoint').fill('http://draft.local');
        await app.page.getByTestId('settings-page-skills').click();
        await expect(app.page.getByRole('heading', { name: 'Skills & MCP', exact: true })).toBeVisible();
        await expect(app.page.locator('#settings-mcp-installed-skills')).toContainText('IBM i Monitoring');
        await expect(app.page.locator('#settings-mcp-available-skills')).toContainText('IBM i Runbook Review');
        await expect(app.page.locator('#settings-ai-panel')).toBeHidden();

        await app.page.getByTestId('settings-page-storage').click();
        await expect(app.page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
        await app.page.getByRole('button', { name: 'Manage collector', exact: true }).click();
        await expect(app.page.locator('#settings-alert-panel')).toHaveAttribute('open', '');
        await expect(app.page.locator('#settings-collector-panel')).toHaveAttribute('open', '');
        await expect(app.page.locator('#settings-collector-panel')).toBeVisible();

        await app.page.getByTestId('settings-page-ai').click();
        await expect(app.page.locator('#settings-ai-endpoint')).toHaveValue('http://draft.local');
    } finally {
        await app.cleanup();
    }
});

test('manages approved Skills and MCP capabilities from the settings workspace', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-skills').click();
        await expect(app.page.locator('#settings-mcp-installed-skills .settings-mcp-card')).toHaveCount(1);
        await expect(app.page.locator('#settings-mcp-available-skills .settings-mcp-card')).toHaveCount(1);
        await expect(app.page.locator('#settings-mcp-available-connections .settings-mcp-card')).toHaveCount(1);
        await expect(app.page.locator('#settings-mcp-summary')).toHaveText('1 installed · 2 available');

        await app.page.locator('#settings-mcp-available-skills [data-mcp-action="inspect"]').click();
        await expect(app.page.locator('#settings-mcp-dialog')).toBeVisible();
        await expect(app.page.locator('#settings-mcp-dialog-title')).toHaveText('IBM i Runbook Review');
        await expect(app.page.locator('#settings-mcp-install')).toBeVisible();
        await app.page.locator('#settings-mcp-install').click();
        await expect(app.page.locator('#settings-mcp-installed-skills')).toContainText('IBM i Runbook Review');
        await expect(app.page.locator('#settings-mcp-summary')).toHaveText('2 installed · 1 available');

        await app.page.locator('#settings-mcp-toggle').click();
        await expect(app.page.locator('#settings-mcp-dialog-health')).toContainText('unknown');
        await app.page.locator('#settings-mcp-test').click();
        await expect(app.page.locator('#settings-mcp-dialog-health')).toContainText('ready');
        await expect(app.page.locator('#settings-mcp-read-test')).toBeVisible();
        await app.page.locator('#settings-mcp-read').click();
        await expect(app.page.locator('#settings-mcp-read-preview')).toContainText('scope');

        await app.page.setViewportSize({ width: 560, height: 700 });
        expect(await app.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
        await app.cleanup();
    }
});

test('saves and removes a customer business service mapping', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-alerts').click();
        const panel = app.page.locator('#settings-business-services-panel');
        await expect(panel).toBeVisible();
        await panel.locator(':scope > summary').click();
        await app.page.locator('#settings-business-service-name').fill('Order processing');
        await app.page.locator('#settings-business-service-owner').fill('Finance operations');
        await app.page.locator('#settings-business-service-systems').fill('*');
        await app.page.locator('#settings-business-service-job').fill('ORDER/*');
        await app.page.locator('#settings-business-service-deadline').fill('60');
        await app.page.locator('#settings-business-service-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await expect(app.page.locator('#settings-business-service-status')).toHaveText('Business service mapping saved.');
        const mapping = app.page.locator('.business-service-mapping-item');
        await expect(mapping).toContainText('Order processing');
        await expect(mapping).toContainText('Finance operations');
        await mapping.getByRole('button', { name: 'Remove', exact: true }).click();
        await expect(app.page.locator('#settings-business-services-summary')).toHaveText('No mappings');
        await expect(app.page.locator('#settings-business-service-list')).toContainText('Technical impact will remain explicitly unknown.');
    } finally {
        await app.cleanup();
    }
});

test('shows the Slack configuration as a Premium preview on the Free plan', async () => {
    const app = await launchTestApp({ forceFree: true });

    try {
        await expect(app.page.locator('#saved-connections')).toHaveValue('demo-connection');
        await app.page.locator('#connect').click();
        await app.page.locator('#open-settings').click();
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

test('creates and revokes a scoped support access invitation', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-support').click();
        await expect(app.page.getByRole('heading', { name: 'Support access', exact: true })).toBeVisible();
        await expect(app.page.locator('#settings-support-access-list')).toContainText('No support grants yet');

        await app.page.locator('#settings-support-display-name').fill('Support Specialist');
        await app.page.locator('#settings-support-operator-id').fill('support-specialist');
        await app.page.locator('#settings-support-systems').fill('demo-connection');
        await app.page.locator('#settings-support-expires').fill('2030-01-01T12:00');
        await app.page.locator('#settings-support-access-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

        await expect(app.page.locator('#settings-support-access-status')).toHaveText(
            'Invitation created. The named operator must accept it before access starts.'
        );
        const grant = app.page.locator('.support-access-grant');
        await expect(grant).toContainText('Support Specialist');
        await expect(grant).toContainText('Pending');
        await expect(grant).toContainText('demo-connection');
        await expect(grant).toContainText('read');

        await grant.getByRole('button', { name: 'Revoke', exact: true }).click();
        await expect(app.page.locator('#settings-support-access-status')).toHaveText('Support access revoked.');
        await expect(grant.locator('.support-access-status')).toHaveText('Revoked');
        await expect.poll(async () => (await app.page.evaluate(() => window.electronAPI.getSupportAccessGrants())).grants[0]?.status).toBe('revoked');
    } finally {
        await app.cleanup();
    }
});
