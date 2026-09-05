import { applyTheme } from './connection/shared.js';
import { initSupportPanel } from './shared/support.js';
import { initAiProvidersSettings } from './settings/ai-providers.js';
import { initClickUpSettings } from './settings/clickup.js';
import { initSlackSettings } from './settings/slack.js';
import { initSmsSettings } from './settings/sms.js';
import { initJiraSettings } from './settings/jira.js';
import { initAlertSettings } from './settings/alerts.js';

document.addEventListener('DOMContentLoaded', async () => {
    const backButton = document.getElementById('settings-back');
    const backLabel = document.getElementById('settings-back-label');
    const themeDescription = document.getElementById('settings-theme-description');
    const connectionStateLabel = document.getElementById('settings-connection-state');
    const planStatus = document.getElementById('settings-plan-status');
    const navAlertStatus = document.getElementById('settings-nav-alert-status');
    const navAiStatus = document.getElementById('settings-nav-ai-status');
    const navIntegrationStatus = document.getElementById('settings-nav-integration-status');
    const clickUpUser = document.getElementById('settings-clickup-user');
    const integrationCatalog = document.getElementById('settings-integration-catalog');
    const installedIntegrations = document.getElementById('settings-installed-integrations');
    const availableIntegrations = document.getElementById('settings-available-integrations');
    const installedGroup = document.getElementById('settings-installed-group');
    const availableGroup = document.getElementById('settings-available-group');
    const installedCount = document.getElementById('settings-installed-count');
    const availableCount = document.getElementById('settings-available-count');
    const integrationCount = document.getElementById('settings-integration-count');
    const settingsPageTabs = Array.from(document.querySelectorAll('[data-settings-page]'));
    const settingsViewElements = Array.from(document.querySelectorAll('[data-settings-view]'));
    const settingsPanels = [
        ...document.querySelectorAll('.settings-grid > details.settings-disclosure'),
        ...document.querySelectorAll('.settings-integration-card')
    ];

    function integrationCardStatus(card) {
        if (card.dataset.integrationCard === 'email') {
            return document.getElementById('email-settings-summary-status')?.textContent?.trim() || 'Not configured';
        }

        return card.querySelector('[id$="-summary-status"]')?.textContent?.trim() || 'Not configured';
    }

    function isInstalledIntegration(status) {
        const normalized = String(status || '').trim().toLowerCase();
        return Boolean(normalized)
            && !['not configured', 'disabled', 'unlock to configure', 'off'].includes(normalized);
    }

    function syncIntegrationCatalog() {
        if (!integrationCatalog || !installedIntegrations || !availableIntegrations) {
            return;
        }

        const cards = Array.from(document.querySelectorAll('[data-integration-card]'));
        const installed = [];
        const available = [];

        cards.forEach((card) => {
            const status = integrationCardStatus(card);
            const configured = isInstalledIntegration(status);
            const actionLabel = configured ? 'Configure' : 'Install';
            const action = card.querySelector('[data-integration-action-label]');
            const actionButton = action?.closest('button');
            const statusLabel = card.querySelector('.settings-catalog-status');

            if (action) {
                action.textContent = actionLabel;
            }
            if (actionButton) {
                const name = card.querySelector('h2, h3')?.textContent?.trim() || 'integration';
                actionButton.setAttribute('aria-label', `${actionLabel} ${name}`);
            }
            if (statusLabel) {
                statusLabel.textContent = status;
                statusLabel.dataset.state = status.toLowerCase().replace(/\s+/g, '-');
            }

            (configured ? installed : available).push(card);
        });

        installed.forEach((card) => installedIntegrations.append(card));
        available.forEach((card) => availableIntegrations.append(card));

        if (installedGroup) {
            installedGroup.hidden = installed.length === 0;
        }
        if (availableGroup) {
            availableGroup.hidden = available.length === 0;
        }
        if (installedCount) {
            installedCount.textContent = `${installed.length} installed`;
        }
        if (availableCount) {
            availableCount.textContent = `${available.length} available`;
        }
        if (integrationCount) {
            integrationCount.textContent = `${installed.length} installed · ${available.length} available`;
        }
        if (navIntegrationStatus) {
            navIntegrationStatus.textContent = installed.length
                ? `${installed.length} connected · ${available.length} available`
                : `${available.length} available to install`;
        }

        integrationCatalog.dataset.ready = 'true';
    }

    function syncSettingsNavigation() {
        const alertStatus = document.getElementById('settings-alert-summary-status')?.textContent?.trim();
        const aiStatus = document.getElementById('settings-ai-summary-status')?.textContent?.trim();
        if (navAlertStatus && alertStatus) {
            navAlertStatus.textContent = alertStatus;
        }
        if (navAiStatus && aiStatus) {
            navAiStatus.textContent = aiStatus;
        }
    }

    document.querySelectorAll('[id$="-summary-status"], #email-settings-summary-status').forEach((statusElement) => {
        new MutationObserver(() => {
            syncIntegrationCatalog();
            syncSettingsNavigation();
        }).observe(statusElement, {
            characterData: true,
            childList: true,
            subtree: true
        });
    });

    function showSettingsView(view) {
        settingsViewElements.forEach((element) => {
            element.hidden = element.dataset.settingsView !== view;
        });
        settingsPanels.forEach((panel) => {
            const isIntegrationCard = panel.classList.contains('settings-integration-card');
            if ((panel.dataset.settingsView && panel.dataset.settingsView !== view)
                || (isIntegrationCard && view !== 'integrations')) {
                panel.open = false;
            }
        });
        settingsPageTabs.forEach((tab) => {
            const isActive = tab.dataset.settingsPage === view;
            tab.classList.toggle('is-active', isActive);
            if (isActive) {
                tab.setAttribute('aria-current', 'page');
            } else {
                tab.removeAttribute('aria-current');
            }
        });
    }

    showSettingsView('integrations');

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

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const panelButton = target?.closest('[data-open-settings-panel]');
        if (panelButton) {
            event.preventDefault();
            event.stopPropagation();
            const panel = document.getElementById(panelButton.dataset.openSettingsPanel || '');
            if (panel instanceof HTMLDetailsElement) {
                panel.open = true;
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }

        const emailButton = target?.closest('[data-open-email-settings]');
        if (emailButton) {
            event.preventDefault();
            event.stopPropagation();
            showSettingsView('alerts');
            const alertPanel = document.getElementById('settings-alert-panel');
            const emailPanel = document.querySelector('.email-settings-disclosure');
            if (alertPanel instanceof HTMLDetailsElement) {
                alertPanel.open = true;
            }
            if (emailPanel instanceof HTMLDetailsElement) {
                emailPanel.open = true;
            }
            alertPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        const navigationButton = target?.closest('[data-settings-page]');
        if (!navigationButton) {
            return;
        }

        event.preventDefault();
        const view = navigationButton.dataset.settingsPage || 'integrations';
        showSettingsView(view);
        const destinationId = view === 'alerts'
            ? 'settings-alert-panel'
            : view === 'ai'
                ? 'settings-ai-panel'
                : 'settings-integration-catalog';
        const destination = document.getElementById(destinationId);
        if (destination instanceof HTMLDetailsElement) {
            destination.open = true;
        }
        destination?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const smsSettings = initSmsSettings({
        root: document
    });
    const jiraSettings = initJiraSettings({
        root: document
    });
    const alertSettings = initAlertSettings({
        root: document
    });

    const premiumFeaturePanels = new Map([
        ['settings-clickup-panel', 'clickup-integration'],
        ['settings-slack-panel', 'slack-integration'],
        ['settings-sms-panel', 'sms-notifications'],
        ['settings-jira-panel', 'jira-integration']
    ]);

    function renderPremiumSummary(panelId) {
        const summaryStatus = document.querySelector(`#${panelId} .settings-provider-chip`);
        if (!summaryStatus) {
            return;
        }

        summaryStatus.textContent = 'Unlock to configure';
    }

    function applyPremiumPreview(entitlements) {
        premiumFeaturePanels.forEach((feature, panelId) => {
            const panel = document.getElementById(panelId);
            if (!panel || entitlements?.features?.[feature]) {
                return;
            }

            panel.classList.add('premium-preview-overlay');
            renderPremiumSummary(panelId);
            panel.querySelectorAll('input, select, textarea, button').forEach((control) => {
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

        [
            ['settings-alert-slack', 'slack-integration', 'Slack notifications require Premium'],
            ['settings-alert-jira', 'jira-integration', 'Jira notifications require Premium'],
            ['settings-alert-sms', 'sms-notifications', 'SMS notifications require Premium']
        ].forEach(([controlId, feature, title]) => {
            const control = document.getElementById(controlId);
            if (!control || entitlements?.features?.[feature]) {
                return;
            }

            control.disabled = true;
            control.classList.add('premium-locked');
            control.title = title;
            control.closest('.toggle-row')?.classList.add('premium-locked');
        });
    }

    const [connectionState, themeSettings, appFlags] = await Promise.all([
        window.electronAPI.getConnectionState(),
        window.electronAPI.getThemeSettings(),
        window.electronAPI.getAppFlags()
    ]);
    const entitlements = await window.electronAPI.getEntitlements();
    aiSettings.setEntitlements?.(entitlements);
    alertSettings.setSlackAvailable?.(Boolean(entitlements?.features?.['slack-integration']));
    alertSettings.setJiraAvailable?.(Boolean(entitlements?.features?.['jira-integration']));
    alertSettings.setSmsAvailable?.(Boolean(entitlements?.features?.['sms-notifications']));
    applyPremiumPreview(entitlements);

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

    if (connectionStateLabel) {
        const connection = connectionState?.currentConnection;
        connectionStateLabel.classList.toggle('is-live', Boolean(connectionState?.isConnected));
        connectionStateLabel.classList.toggle('is-idle', !connectionState?.isConnected);
        connectionStateLabel.textContent = connectionState?.isConnected
            ? `Connected to ${connection?.name || connection?.host || 'IBM i'}`
            : 'No active connection';
    }
    if (planStatus) {
        const premium = entitlements?.plan === 'premium';
        planStatus.innerHTML = `<i class="bi ${premium ? 'bi-stars' : 'bi-unlock'}" aria-hidden="true"></i>${premium ? 'Premium plan' : 'Free plan'}`;
        planStatus.dataset.plan = premium ? 'premium' : 'free';
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
        smsSettings.refresh(),
        jiraSettings.refresh(),
        alertSettings.refresh()
    ]);

    applyPremiumPreview(entitlements);
    syncIntegrationCatalog();
    syncSettingsNavigation();
});
