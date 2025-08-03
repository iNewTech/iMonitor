document.addEventListener('DOMContentLoaded', () => {
    // Connection form elements
    const connectButton = document.getElementById('connect');
    const systemInput = document.getElementById('system');
    const portInput = document.getElementById('port');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const connectionNameInput = document.getElementById('connection-name');
    const saveConnectionButton = document.getElementById('save-connection');
    const togglePasswordButton = document.getElementById('toggle-password');
    const savedConnectionsSelect = document.getElementById('saved-connections');
    const deleteConnectionButton = document.getElementById('delete-connection');

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

    // Handle connection
    connectButton?.addEventListener('click', async () => {
        const connectionData = {
            name: connectionNameInput.value.trim(),
            host: systemInput.value,
            port: parseInt(portInput.value),
            user: usernameInput.value,
            password: passwordInput.value
        };

        try {
            const result = await window.electronAPI.connectToSystem(connectionData);
            if (result.success) {
                // Load monitor page
                window.location.href = 'monitor.html';
            } else {
                // Show error message
                console.error('Connection failed:', result.error);
            }
        } catch (error) {
            console.error('Connection error:', error);
        }
    });

    // Handle saving connections
    saveConnectionButton?.addEventListener('click', async () => {
        const connectionData = {
            name: connectionNameInput.value.trim(),
            host: systemInput.value,
            port: parseInt(portInput.value),
            user: usernameInput.value,
            password: passwordInput.value
        };
        try {
            const result = await window.electronAPI.saveConnection(connectionData);
            if (result.success) {
                // Update saved connections dropdown
                const option = document.createElement('option');
                option.value = JSON.stringify(connectionData);
                option.textContent = connectionData.name || `${connectionData.host}:${connectionData.port}`;
                savedConnectionsSelect.appendChild(option);
                savedConnectionsSelect.value = option.value;
                deleteConnectionButton.style.display = 'inline-block';
            } else {
                console.error('Failed to save connection:', result.error);
            }
        } catch (error) {
            console.error('Error saving connection:', error);
        }
    });

    // Handle saved connections
    savedConnectionsSelect?.addEventListener('change', () => {
        const selectedValue = savedConnectionsSelect.value;
        if (selectedValue) {
            deleteConnectionButton.style.display = 'inline-block';
            // Load connection details
            const connection = JSON.parse(selectedValue);
            systemInput.value = connection.host;
            portInput.value = connection.port || '8076';
            usernameInput.value = connection.user;
            connectionNameInput.value = connection.name;
        } else {
            deleteConnectionButton.style.display = 'none';
            // Clear form
            systemInput.value = '';
            portInput.value = '8076';
            usernameInput.value = '';
            connectionNameInput.value = '';
        }
    });

    // Listen for status updates
    window.electronAPI.onStatusUpdate((data) => {
        if (systemStats) {
            systemStats.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
        }
    });
});
