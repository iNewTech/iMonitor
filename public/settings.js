import { applyTheme } from './connection/shared.js';
import { initSupportPanel } from './shared/support.js';
import { initAiProvidersSettings } from './settings/ai-providers.js';
import { initClickUpSettings } from './settings/clickup.js';

document.addEventListener('DOMContentLoaded', async () => {
    const backButton = document.getElementById('settings-back');
    const backLabel = document.getElementById('settings-back-label');
    const themeDescription = document.getElementById('settings-theme-description');
    const clickUpUser = document.getElementById('settings-clickup-user');

    const aiSettings = initAiProvidersSettings({
        root: document
    });
    const clickUpSettings = initClickUpSettings({
        root: document
    });

    const [connectionState, themeSettings, appFlags] = await Promise.all([
        window.electronAPI.getConnectionState(),
        window.electronAPI.getThemeSettings(),
        window.electronAPI.getAppFlags()
    ]);

    applyTheme(themeSettings.themeId);
    const selectedTheme = Array.isArray(themeSettings.themes)
        ? themeSettings.themes.find((theme) => theme.id === themeSettings.themeId)
        : null;

    if (themeDescription) {
        themeDescription.textContent = selectedTheme?.description || 'Theme loads from your current app preference.';
    }

    if (backLabel) {
        backLabel.textContent = connectionState?.isConnected ? 'Back To Dashboard' : 'Back To Connect';
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
        clickUpSettings.refresh()
    ]);
});
