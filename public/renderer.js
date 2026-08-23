document.addEventListener('DOMContentLoaded', async () => {
    // Connection form elements
    const connectionForm = document.getElementById('connection-form');
    const connectButton = document.getElementById('connect');
    const systemInput = document.getElementById('system');
    const portInput = document.getElementById('port');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const connectionNameInput = document.getElementById('connection-name');
    const saveConnectionButton = document.getElementById('save-connection');
    const launchDemoButton = document.getElementById('launch-demo');
    const connectionActionBar = document.getElementById('connection-action-bar');
    const connectionActionMessage = document.getElementById('connection-action-message');
    const connectionActionDetail = document.getElementById('connection-action-detail');
    const togglePasswordButton = document.getElementById('toggle-password');
    const savedConnectionsSelect = document.getElementById('saved-connections');
    const deleteConnectionButton = document.getElementById('delete-connection');
    const savedCount = document.getElementById('saved-count');
    const savedHint = document.getElementById('saved-hint');
    let savedConnections = [];

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => (
            {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                '\'': '&#39;'
            }[char]
        ));
    }

    function showAlert(message, variant = 'danger', detail = '') {
        const existingAlert = document.querySelector('.alert');
        if (existingAlert) {
            existingAlert.remove();
        }

        const detailMarkup = detail
            ? `
                <details class="alert-technical mt-3">
                    <summary>Show technical details</summary>
                    <pre>${escapeHtml(detail)}</pre>
                </details>
            `
            : '';

        const alert = document.createElement('div');
        alert.className = `alert alert-${variant} alert-dismissible fade show mt-3`;
        alert.role = 'alert';
        alert.innerHTML = `
            <div class="alert-message">${escapeHtml(message)}</div>
            ${detailMarkup}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        connectionForm.insertAdjacentElement('afterbegin', alert);
    }

    function setConnectionAction(message, detail = '', isVisible = true) {
        if (!connectionActionBar || !connectionActionMessage || !connectionActionDetail) {
            return;
        }

        connectionActionBar.hidden = !isVisible;
        connectionActionMessage.textContent = message;
        connectionActionDetail.textContent = detail;
    }

    function clearForm() {
        systemInput.value = '';
        portInput.value = '8076';
        usernameInput.value = '';
        passwordInput.value = '';
        connectionNameInput.value = '';
        connectionForm.classList.remove('was-validated');
    }

    function fillForm(connection) {
        systemInput.value = connection.host || '';
        portInput.value = String(connection.port || 8076);
        usernameInput.value = connection.user || '';
        passwordInput.value = connection.password || '';
        connectionNameInput.value = connection.name || '';
    }

    function renderSavedConnections(connections, selectedId = '') {
        savedConnections = connections;
        savedConnectionsSelect.innerHTML = '<option value="">-- Select Saved Connection --</option>';

        connections.forEach(connection => {
            const option = document.createElement('option');
            option.value = connection.id;
            option.textContent = connection.name || `${connection.host}:${connection.port}`;
            savedConnectionsSelect.appendChild(option);
        });

        if (selectedId) {
            savedConnectionsSelect.value = selectedId;
        }

        if (savedCount) {
            const profileLabel = connections.length === 1 ? 'profile' : 'profiles';
            savedCount.textContent = `${connections.length} saved ${profileLabel}`;
        }

        if (savedHint) {
            savedHint.textContent = connections.length
                ? 'Select a saved profile to refill the form or remove one you no longer use.'
                : 'Save frequent systems here for quick reconnects.';
        }

        savedConnectionsSelect.disabled = connections.length === 0;
        deleteConnectionButton.style.display = savedConnectionsSelect.value ? 'inline-block' : 'none';
    }

    async function loadSavedConnections(selectedId = '') {
        try {
            const connections = await window.electronAPI.loadConnections();
            renderSavedConnections(connections, selectedId);
        } catch (error) {
            console.error('Error loading saved connections:', error);
            showAlert('Unable to load saved connections.');
        }
    }

    window.electronAPI.onConnectionTestStatus((status) => {
        const variant = status.status === 'failed'
            ? 'danger'
            : status.status === 'success'
                ? 'success'
                : 'info';
        showAlert(status.message, variant, status.detail);
    });

    window.electronAPI.onConnectionsUpdated(() => {
        void loadSavedConnections(savedConnectionsSelect.value);
    });

    window.electronAPI.onConnectionActionStatus((status) => {
        setConnectionAction(status.message || 'Working…', status.detail || '', true);
    });

    const appFlags = await window.electronAPI.getAppFlags();
    if (launchDemoButton && !appFlags.demoModeEnabled) {
        launchDemoButton.remove();
    }

    await loadSavedConnections();
    setConnectionAction('', '', false);

    // Form validation and submission
    connectionForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        // Check HTML5 validation
        if (!connectionForm.checkValidity()) {
            event.stopPropagation();
            connectionForm.classList.add('was-validated');
            return;
        }

        const connectionData = {
            name: connectionNameInput.value.trim(),
            host: systemInput.value.trim(),
            port: parseInt(portInput.value, 10) || 8076,
            user: usernameInput.value.trim(),
            password: passwordInput.value
        };

        connectButton.disabled = true;
        setConnectionAction('Connecting…', 'Checking server state and preparing the remote Mapepire service.', true);
        try {
            const result = await window.electronAPI.connectToSystem(connectionData);
            if (result.success) {
                if (result.port) {
                    portInput.value = String(result.port);
                }
                setConnectionAction('Connected.', result.port ? `Using Mapepire port ${result.port}.` : '', true);
                await window.electronAPI.navigateToMonitor();
            } else {
                showAlert(
                    result.error || 'Connection failed. Please try again.',
                    'danger',
                    result.detail
                );
                setConnectionAction(result.error || 'Connection failed.', result.detail || '', true);
            }
        } catch (error) {
            console.error('Connection error:', error);
            showAlert(error.message || 'Connection error. Please try again.');
            setConnectionAction(error.message || 'Connection error. Please try again.', '', true);
        } finally {
            connectButton.disabled = false;
        }
    });

    launchDemoButton?.addEventListener('click', async () => {
        launchDemoButton.disabled = true;
        connectButton.disabled = true;

        try {
            const result = await window.electronAPI.connectToSystem({
                name: 'IBMEye Demo System',
                host: 'dummy',
                port: 8076,
                user: 'dummy',
                password: 'dummy',
                mode: 'dummy'
            });

            if (result.success) {
                showAlert('Demo system ready. IBMEye will open the monitor with dummy jobs and MSGW alert simulation.', 'success');
                setConnectionAction('Demo ready.', 'Starting local demo monitoring.', true);
                await window.electronAPI.navigateToMonitor();
                return;
            }

            showAlert(result.error || 'Unable to start the demo system.', 'danger', result.detail);
        } catch (error) {
            console.error('Demo launch error:', error);
            showAlert(error.message || 'Unable to start the demo system.');
        } finally {
            launchDemoButton.disabled = false;
            connectButton.disabled = false;
        }
    });

    // Password visibility toggle
    togglePasswordButton?.addEventListener('click', () => {
        const icon = togglePasswordButton.querySelector('i');
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.classList.remove('bi-eye');
            icon.classList.add('bi-eye-slash');
        } else {
            passwordInput.type = 'password';
            icon.classList.remove('bi-eye-slash');
            icon.classList.add('bi-eye');
        }
    });

    // Handle saving connections
    saveConnectionButton?.addEventListener('click', async () => {
        // Validate required fields
        if (!connectionNameInput.value.trim() || !systemInput.value.trim() || 
            !usernameInput.value.trim() || !passwordInput.value) {
            showAlert('Please fill in all required fields before saving the connection.');
            return;
        }

        const connectionData = {
            name: connectionNameInput.value.trim(),
            host: systemInput.value.trim(),
            port: parseInt(portInput.value, 10) || 8076,
            user: usernameInput.value.trim(),
            password: passwordInput.value
        };

        saveConnectionButton.disabled = true;
        try {
            const result = await window.electronAPI.saveConnection(connectionData);
            if (!result.success) {
                showAlert(
                    result.error || 'Error saving connection. Please try again.',
                    'danger',
                    result.detail
                );
                return;
            }

            await loadSavedConnections(result.id);
            showAlert(`Connection "${connectionData.name}" has been saved successfully.`, 'success');
        } catch (error) {
            showAlert(error.message || 'Error saving connection. Please try again.');
        } finally {
            saveConnectionButton.disabled = false;
        }
    });

    deleteConnectionButton?.addEventListener('click', async () => {
        const selectedId = savedConnectionsSelect.value;
        if (!selectedId) {
            return;
        }

        deleteConnectionButton.disabled = true;
        try {
            const result = await window.electronAPI.deleteConnection(selectedId);
            if (!result.success) {
                showAlert(result.error || 'Error deleting connection. Please try again.');
                return;
            }

            savedConnectionsSelect.value = '';
            clearForm();
            await loadSavedConnections();
            showAlert('Saved connection deleted.', 'success');
        } catch (error) {
            showAlert(error.message || 'Error deleting connection. Please try again.');
        } finally {
            deleteConnectionButton.disabled = false;
        }
    });

    // Handle saved connections
    savedConnectionsSelect?.addEventListener('change', () => {
        const selectedConnection = savedConnections.find((connection) => connection.id === savedConnectionsSelect.value);
        if (selectedConnection) {
            deleteConnectionButton.style.display = 'inline-block';
            fillForm(selectedConnection);
            if (savedHint) {
                savedHint.textContent = `Profile ready: ${selectedConnection.name} (${selectedConnection.host}:${selectedConnection.port || 8076})`;
            }
        } else {
            deleteConnectionButton.style.display = 'none';
            clearForm();
            if (savedHint) {
                savedHint.textContent = savedConnections.length
                    ? 'Select a saved profile to refill the form or remove one you no longer use.'
                    : 'Save frequent systems here for quick reconnects.';
            }
        }
    });
});
