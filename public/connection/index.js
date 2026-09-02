import { applyTheme } from './shared.js';
import { getConnectionPageModel } from './layout.js';
import { showAlert, setConnectionAction } from './feedback.js';
import { clearForm, fillForm, renderSavedConnections } from './saved-connections.js';
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

    let savedConnections = [];
    let editingConnectionId = '';
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

    async function loadSavedConnections(selectedId = '') {
        try {
            savedConnections = await window.electronAPI.loadConnections();
            const demoConnection = savedConnections.find((connection) => connection.name === 'Demo connection');
            const preferredId = selectedId || demoConnection?.id || '';
            renderSavedConnections(elements, savedConnections, preferredId);
            editingConnectionId = '';
            const preferredConnection = savedConnections.find((connection) => connection.id === preferredId);
            if (preferredConnection) {
                fillForm(elements, preferredConnection);
                if (elements.savedHint) {
                    elements.savedHint.textContent = `Profile ready: ${preferredConnection.name} (${preferredConnection.host}:${preferredConnection.port || 8076})`;
                }
            } else if (elements.savedHint) {
                elements.savedHint.textContent = pageModel.savedProfilesHint;
            }
        } catch (error) {
            console.error('Error loading saved connections:', error);
            showAlert(elements.connectionForm, 'Unable to load saved connections.');
        }
    }

    window.electronAPI.onConnectionTestStatus((status) => {
        const variant = status.status === 'failed'
            ? 'danger'
            : status.status === 'success'
                ? 'success'
                : 'info';
        showAlert(elements.connectionForm, status.message, variant, status.detail);
    });

    window.electronAPI.onConnectionsUpdated(() => {
        void loadSavedConnections(elements.savedConnectionsSelect.value);
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
        window.electronAPI.getAppFlags(),
        window.electronAPI.getThemeSettings()
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
    renderEntitlements(await window.electronAPI.getEntitlements());
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

    await loadSavedConnections();
    setConnectionAction(elements.connectionActionBar, elements.connectionActionMessage, elements.connectionActionDetail, '', '', false);

    elements.connectionForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!elements.connectionForm.checkValidity()) {
            event.stopPropagation();
            elements.connectionForm.classList.add('was-validated');
            return;
        }

        const connectionData = {
            name: elements.connectionNameInput.value.trim(),
            host: elements.systemInput.value.trim(),
            port: parseInt(elements.portInput.value, 10) || 8076,
            user: elements.usernameInput.value.trim(),
            password: elements.passwordInput.value
        };
        if (editingConnectionId) connectionData.id = editingConnectionId;

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
            elements.connectButton.disabled = false;
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

    elements.saveConnectionButton?.addEventListener('click', async () => {
        if (!elements.connectionNameInput.value.trim() || !elements.systemInput.value.trim()
            || !elements.usernameInput.value.trim() || !elements.passwordInput.value) {
            showAlert(elements.connectionForm, 'Please fill in all required fields before saving the connection.');
            return;
        }

        const connectionData = {
            name: elements.connectionNameInput.value.trim(),
            host: elements.systemInput.value.trim(),
            port: parseInt(elements.portInput.value, 10) || 8076,
            user: elements.usernameInput.value.trim(),
            password: elements.passwordInput.value
        };

        elements.saveConnectionButton.disabled = true;
        try {
            const result = await window.electronAPI.saveConnection(connectionData);
            if (!result.success) {
                showAlert(elements.connectionForm, result.error || 'Error saving connection. Please try again.', 'danger', result.detail);
                return;
            }

            await loadSavedConnections(result.id);
            showAlert(elements.connectionForm, `Connection "${connectionData.name}" has been ${editingConnectionId ? 'updated' : 'saved'} successfully.`, 'success');
        } catch (error) {
            showAlert(elements.connectionForm, error.message || 'Error saving connection. Please try again.');
        } finally {
            elements.saveConnectionButton.disabled = false;
        }
    });

    elements.editConnectionButton?.addEventListener('click', () => {
        const selectedConnection = savedConnections.find((connection) => connection.id === elements.savedConnectionsSelect.value);
        if (!selectedConnection) return;
        editingConnectionId = selectedConnection.id;
        fillForm(elements, selectedConnection);
        elements.saveConnectionButton.innerHTML = '<i class="bi bi-check2 me-2"></i>Update Profile';
        elements.connectionNameInput.focus();
    });

    elements.deleteConnectionButton?.addEventListener('click', async () => {
        const selectedId = elements.savedConnectionsSelect.value;
        if (!selectedId) {
            return;
        }

        elements.deleteConnectionButton.disabled = true;
        try {
            const result = await window.electronAPI.deleteConnection(selectedId);
            if (!result.success) {
                showAlert(elements.connectionForm, result.error || 'Error deleting connection. Please try again.');
                return;
            }

            elements.savedConnectionsSelect.value = '';
            editingConnectionId = '';
            clearForm(elements);
            await loadSavedConnections();
            showAlert(elements.connectionForm, 'Saved connection deleted.', 'success');
        } catch (error) {
            showAlert(elements.connectionForm, error.message || 'Error deleting connection. Please try again.');
        } finally {
            elements.deleteConnectionButton.disabled = false;
        }
    });

    elements.savedConnectionsSelect?.addEventListener('change', () => {
        const selectedConnection = savedConnections.find((connection) => connection.id === elements.savedConnectionsSelect.value);
        if (selectedConnection) {
            editingConnectionId = '';
            elements.saveConnectionButton.innerHTML = '<i class="bi bi-bookmark-plus me-2"></i>Save Profile';
            elements.editConnectionButton.hidden = false;
            elements.deleteConnectionButton.hidden = false;
            fillForm(elements, selectedConnection);
            if (elements.savedHint) {
                elements.savedHint.textContent = `Profile ready: ${selectedConnection.name} (${selectedConnection.host}:${selectedConnection.port || 8076})`;
            }
        } else {
            editingConnectionId = '';
            elements.editConnectionButton.hidden = true;
            elements.deleteConnectionButton.hidden = true;
            elements.saveConnectionButton.innerHTML = '<i class="bi bi-bookmark-plus me-2"></i>Save Profile';
            clearForm(elements);
            if (elements.savedHint) {
                elements.savedHint.textContent = savedConnections.length
                    ? 'Select a saved profile to refill the form or remove one you no longer use.'
                    : 'Save frequent systems here for quick reconnects.';
            }
        }
    });
});
