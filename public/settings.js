import { applyTheme } from './connection/shared.js';
import { initSupportPanel } from './shared/support.js';
import { initAiProvidersSettings } from './settings/ai-providers.js';
import { initClickUpSettings } from './settings/clickup.js';
import { initSlackSettings } from './settings/slack.js';
import { initAlertSettings } from './settings/alerts.js';

document.addEventListener('DOMContentLoaded', async () => {
    const backButton = document.getElementById('settings-back');
    const backLabel = document.getElementById('settings-back-label');
    const themeDescription = document.getElementById('settings-theme-description');
    const clickUpUser = document.getElementById('settings-clickup-user');
    const settingsPanels = Array.from(document.querySelectorAll('.settings-disclosure'));

    settingsPanels.forEach((panel) => {
        panel.addEventListener('toggle', () => {
            if (!panel.open) {
                return;
            }

            settingsPanels.forEach((otherPanel) => {
                if (otherPanel !== panel) {
                    otherPanel.open = false;
                }
            });
        });
    });

    const aiSettings = initAiProvidersSettings({
        root: document
    });
    const clickUpSettings = initClickUpSettings({
        root: document
    });
    const slackSettings = initSlackSettings({
        root: document
    });
    const alertSettings = initAlertSettings({
        root: document
    });

    const [connectionState, themeSettings, appFlags] = await Promise.all([
        window.electronAPI.getConnectionState(),
        window.electronAPI.getThemeSettings(),
        window.electronAPI.getAppFlags()
    ]);
    const entitlements = await window.electronAPI.getEntitlements();
    aiSettings.setEntitlements?.(entitlements);
    alertSettings.setSlackAvailable?.(Boolean(entitlements?.features?.['slack-integration']));
    const premiumFeatures = new Map([
        ['settings-clickup-panel', 'clickup-integration'],
        ['settings-slack-panel', 'slack-integration']
    ]);
    premiumFeatures.forEach((feature, panelId) => {
        const panel = document.getElementById(panelId);
        if (entitlements?.features?.[feature]) return;
        if (panelId === 'settings-slack-panel') {
            panel?.classList.add('premium-preview-overlay');
            const summaryStatus = panel?.querySelector('#settings-slack-summary-status');
            if (summaryStatus) {
                summaryStatus.innerHTML = '<span class="premium-badge"><i class="bi bi-lock-fill me-1" aria-hidden="true"></i>Premium</span>';
            }
        }
        if (panelId === 'settings-clickup-panel') {
            panel?.classList.add('premium-preview-overlay');
            const summaryStatus = panel?.querySelector('#settings-clickup-summary-status');
            if (summaryStatus) {
                summaryStatus.innerHTML = '<span class="premium-badge"><i class="bi bi-lock-fill me-1" aria-hidden="true"></i>Premium</span>';
            }
        }
        panel?.querySelectorAll('input, select, textarea, button').forEach((control) => {
            control.disabled = true;
            control.classList.add('premium-locked');
            control.title = 'Premium feature';
        });
    });
    if (!entitlements?.features?.['email-notifications']) {
        document.querySelectorAll('#send-test-email, #email-smtp-host, #email-smtp-port, #email-smtp-secure, #email-username, #email-password, #email-from-address, #email-to-addresses').forEach((control) => {
            control.disabled = true;
            control.classList.add('premium-locked');
            control.title = 'Premium feature';
        });
    }
    if (!entitlements?.features?.['slack-integration']) {
        const slackChannel = document.querySelector('#settings-alert-slack');
        if (slackChannel) {
            slackChannel.disabled = true;
            slackChannel.classList.add('premium-locked');
            slackChannel.title = 'Slack notifications require Premium';
        }
    }

    applyTheme(themeSettings.themeId);
    const selectedTheme = Array.isArray(themeSettings.themes)
        ? themeSettings.themes.find((theme) => theme.id === themeSettings.themeId)
        : null;

    if (themeDescription) {
        themeDescription.textContent = selectedTheme?.description || 'Theme loads from your current app preference.';
    }

    if (backLabel) {
        backLabel.textContent = connectionState?.isConnected ? 'Back To ActionBoard' : 'Back To Connect';
    }

    if (clickUpUser) {
        const operatorName = String(appFlags?.operatorName || '').trim() || 'local-operator';
        clickUpUser.textContent = `Saved for operator: ${operatorName}`;
    }

    backButton?.addEventListener('click', async () => {
        if (connectionState?.isConnected) {
            await window.electronAPI.navigateToMonitor();
            return;
        }

        await window.electronAPI.navigateToConnection();
    });

    await initSupportPanel({
        versionLabel: document.getElementById('app-version-label'),
        contactButton: document.getElementById('support-contact-only'),
        diagnosticsButton: document.getElementById('support-send-diagnostics'),
        statusElement: document.getElementById('support-status'),
        menuElement: document.getElementById('support-menu')
    });

    await Promise.all([
        aiSettings.refresh(),
        clickUpSettings.refresh(),
        slackSettings.refresh(),
        alertSettings.refresh()
    ]);

    if (!entitlements?.features?.['slack-integration']) {
        const slackSummaryStatus = document.getElementById('settings-slack-summary-status');
        if (slackSummaryStatus) {
            slackSummaryStatus.innerHTML = '<span class="premium-badge"><i class="bi bi-lock-fill me-1" aria-hidden="true"></i>Premium</span>';
        }
    }
});
