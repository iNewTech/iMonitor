import { applyTheme } from './shared.js';
import { getConnectionPageModel } from './layout.js';
import { showAlert, setConnectionAction } from './feedback.js';
import { initSavedProfiles } from './saved-connections.js';
import { initAppNavigation } from '../shared/app-navigation.js';
import { initSupportPanel } from '../shared/support.js';

document.addEventListener('DOMContentLoaded', async () => {
    const pageModel = getConnectionPageModel();
    const elements = {
        connectionForm: document.getElementById('connection-form'),
        connectButton: document.getElementById('connect'),
        systemInput: document.getElementById('system'),
        portInput: document.getElementById('port'),
        usernameInput: document.getElementById('username'),
        passwordInput: document.getElementById('password'),
        connectionNameInput: document.getElementById('connection-name'),
        saveConnectionButton: document.getElementById('save-connection'),
        launchDemoButton: document.getElementById('launch-demo'),
        connectionActionBar: document.getElementById('connection-action-bar'),
        connectionActionMessage: document.getElementById('connection-action-message'),
        connectionActionDetail: document.getElementById('connection-action-detail'),
        togglePasswordButton: document.getElementById('toggle-password'),
        savedConnectionsSelect: document.getElementById('saved-connections'),
        editConnectionButton: document.getElementById('edit-connection'),
        deleteConnectionButton: document.getElementById('delete-connection'),
        savedCount: document.getElementById('saved-count'),
        savedHint: document.getElementById('saved-hint'),
        themeMenu: document.getElementById('theme-menu'),
        themeMenuOptions: document.getElementById('theme-menu-options'),
        planLabel: document.getElementById('plan-label'),
        planCopy: document.getElementById('plan-copy'),
        planStatus: document.getElementById('plan-status'),
        developmentPlanSelect: document.getElementById('development-plan-select'),
        developmentLicenseKey: document.getElementById('development-license-key'),
        activateDevelopmentLicense: document.getElementById('activate-development-license')
    };

    const profiles = initSavedProfiles(elements);
    void initAppNavigation({ canLeave: profiles.canLeave });
    let availableThemes = [];

    function renderThemeSettings(settings) {
        if (!elements.themeMenuOptions || !settings) {
            return;
        }

        availableThemes = Array.isArray(settings.themes) ? settings.themes : [];
        applyTheme(settings.themeId);

        elements.themeMenuOptions.innerHTML = availableThemes.map((theme) => {
            const isSelected = theme.id === settings.themeId;
            return `
                <button
                    type="button"
                    class="theme-menu-option${isSelected ? ' is-selected' : ''}"
                    data-theme-id="${theme.id}"
                    title="${theme.description}"
                >
                    <span>${theme.label}</span>
                    ${isSelected ? '<i class="bi bi-check2"></i>' : ''}
                </button>
            `;
        }).join('');
    }

    async function saveTheme(themeId) {
        try {
            const settings = await window.electronAPI.saveThemeSettings(themeId);
            renderThemeSettings(settings);
            elements.themeMenu?.removeAttribute('open');
        } catch (error) {
            console.error('Error saving theme settings:', error);
            showAlert(elements.connectionForm, 'Unable to save the selected theme.');
        }
    }

    document.addEventListener('click', (event) => {
        const themeButton = event.target.closest?.('.theme-menu-option');
        if (!themeButton?.dataset?.themeId) {
            return;
        }

        void saveTheme(themeButton.dataset.themeId);
    });

    window.electronAPI.onConnectionTestStatus((status) => {
        const variant = status.status === 'failed'
            ? 'danger'
            : status.status === 'success'
                ? 'success'
                : 'info';
        showAlert(elements.connectionForm, status.message, variant, status.detail);
    });

    window.electronAPI.onConnectionActionStatus((status) => {
        setConnectionAction(
            elements.connectionActionBar,
            elements.connectionActionMessage,
            elements.connectionActionDetail,
            status.message || 'Working…',
            status.detail || '',
            true
        );
    });

    const [appFlags, themeSettings] = await Promise.all([
        window.electronAPI.getAppFlags().catch(() => ({})),
        window.electronAPI.getThemeSettings().catch(() => null)
    ]);
    const renderEntitlements = (entitlements) => {
        const premium = entitlements?.plan === 'premium';
        if (elements.developmentPlanSelect) elements.developmentPlanSelect.value = premium ? 'premium' : 'free';
        if (elements.planLabel) elements.planLabel.textContent = premium ? 'Premium plan' : 'Free plan';
        if (elements.planCopy) elements.planCopy.textContent = premium
            ? `Premium features are enabled${entitlements.source === 'development-license' ? ' with the development license.' : ' in development mode.'}`
            : 'Monitoring, information, alert ownership, and desktop notifications are included.';
        if (elements.planStatus) elements.planStatus.textContent = premium
            ? `Active${entitlements.expiresAt ? ` until ${new Date(entitlements.expiresAt).toLocaleDateString()}` : ''}.`
            : 'Premium activation is available only in development builds.';
    };
    renderEntitlements(await window.electronAPI.getEntitlements().catch(() => null));
    elements.developmentPlanSelect?.addEventListener('change', async () => {
        const entitlements = await window.electronAPI.setDevelopmentPlan(elements.developmentPlanSelect.value);
        renderEntitlements(entitlements);
    });
    elements.activateDevelopmentLicense?.addEventListener('click', async () => {
        const key = elements.developmentLicenseKey?.value?.trim() || '';
        const entitlements = await window.electronAPI.activateDevelopmentLicense(key);
        renderEntitlements(entitlements);
        if (elements.planStatus) elements.planStatus.textContent = entitlements.plan === 'premium'
            ? 'Development license activated.'
            : 'License key was not accepted.';
    });
    await initSupportPanel({
        versionLabel: document.getElementById('app-version-label'),
        contactButton: document.getElementById('support-contact-only'),
        diagnosticsButton: document.getElementById('support-send-diagnostics'),
        statusElement: document.getElementById('support-status'),
        menuElement: document.getElementById('support-menu')
    });
    renderThemeSettings(themeSettings);
    if (!pageModel.showDemoAction) {
        elements.launchDemoButton?.remove();
    }

    await profiles.load();
    setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, '', '', false);

    elements.connectionForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!elements.connectionForm.checkValidity()) {
            profiles.reveal();
            event.stopPropagation();
            elements.connectionForm.classList.add('was-validated');
            return;
        }

        const connectionData = profiles.getData();
        profiles.setBusy(true);

        elements.connectButton.disabled = true;
        setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, 'Connecting…', 'Checking server state and preparing the remote Mapepire service.', true);
        try {
            const result = await window.electronAPI.connectToSystem(connectionData);
            if (result.success) {
                if (result.port) {
                    elements.portInput.value = String(result.port);
                }
                setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, 'Connected.', result.port ? `Using Mapepire port ${result.port}.` : '', true);
                await window.electronAPI.navigateToMonitor();
            } else {
                showAlert(elements.connectionForm, result.error || 'Connection failed. Please try again.', 'danger', result.detail);
                setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, result.error || 'Connection failed.', result.detail || '', true);
            }
        } catch (error) {
            console.error('Connection error:', error);
            showAlert(elements.connectionForm, error.message || 'Connection error. Please try again.');
            setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, error.message || 'Connection error. Please try again.', '', true);
        } finally {
            profiles.setBusy(false);
        }
    });

    elements.launchDemoButton?.addEventListener('click', async () => {
        elements.launchDemoButton.disabled = true;
        elements.connectButton.disabled = true;

        try {
            const result = await window.electronAPI.connectToSystem({
                name: 'iMonitor Demo System',
                host: 'dummy',
                port: 8076,
                user: 'dummy',
                password: 'dummy',
                mode: 'dummy'
            });

            if (result.success) {
                showAlert(elements.connectionForm, 'Demo system ready. iMonitor will open the dashboard with dummy jobs and IBMEye alert simulation.', 'success');
                setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, 'Demo ready.', 'Starting local demo monitoring.', true);
                await window.electronAPI.navigateToMonitor();
                return;
            }

            showAlert(elements.connectionForm, result.error || 'Unable to start the demo system.', 'danger', result.detail);
        } catch (error) {
            console.error('Demo launch error:', error);
            showAlert(elements.connectionForm, error.message || 'Unable to start the demo system.');
        } finally {
            elements.launchDemoButton.disabled = false;
            elements.connectButton.disabled = false;
        }
    });

    elements.togglePasswordButton?.addEventListener('click', () => {
        const icon = elements.togglePasswordButton.querySelector('i');
        if (elements.passwordInput.type === 'password') {
            elements.passwordInput.type = 'text';
            icon.classList.remove('bi-eye');
            icon.classList.add('bi-eye-slash');
        } else {
            elements.passwordInput.type = 'password';
            icon.classList.remove('bi-eye-slash');
            icon.classList.add('bi-eye');
        }
    });

});
