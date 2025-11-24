document.addEventListener('DOMContentLoaded', async () => {
    // Connection form elements
    const connectionForm = document.getElementById('connection-form');
    const systemInput = document.getElementById('system');
    const portInput = document.getElementById('port');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const connectionNameInput = document.getElementById('connection-name');
    const saveConnectionButton = document.getElementById('save-connection');
    const togglePasswordButton = document.getElementById('toggle-password');
    const savedConnectionsSelect = document.getElementById('saved-connections');
    const deleteConnectionButton = document.getElementById('delete-connection');

    // Load saved connections immediately when page loads
    try {
        const savedConnections = await window.electronAPI.loadConnections();
        savedConnections.forEach(connection => {
            const option = document.createElement('option');
            option.value = JSON.stringify(connection);
            option.textContent = connection.name || `${connection.host}:${connection.port}`;
            savedConnectionsSelect.appendChild(option);
        });
        
        if (savedConnections.length > 0) {
            deleteConnectionButton.style.display = 'inline-block';
        }
    } catch (error) {
        console.error('Error loading saved connections:', error);
    }

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
            host: systemInput.value,
            port: parseInt(portInput.value) || 8076,
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

    // Remove the click handler since we're using form submission now

    // Function to show error messages
    function showErrorAlert(message) {
        // Remove any existing alert
        const existingAlert = document.querySelector('.alert');
        if (existingAlert) {
            existingAlert.remove();
        }

        const alert = document.createElement('div');
        alert.className = 'alert alert-danger alert-dismissible fade show mt-3';
        alert.role = 'alert';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        connectionForm.insertAdjacentElement('afterbegin', alert);
    }

    // Handle saving connections
    saveConnectionButton?.addEventListener('click', async () => {
        // Validate required fields
        if (!connectionNameInput.value.trim() || !systemInput.value.trim() || 
            !usernameInput.value.trim() || !passwordInput.value) {
            showErrorAlert('Please fill in all required fields before saving the connection.');
            return;
        }

        const connectionData = {
            name: connectionNameInput.value.trim(),
            host: systemInput.value.trim(),
            port: parseInt(portInput.value) || 8076,
            user: usernameInput.value.trim(),
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

                // Show success message
                const alert = document.createElement('div');
                alert.className = 'alert alert-success alert-dismissible fade show mt-3';
                alert.role = 'alert';
                alert.innerHTML = `
                    Connection "${connectionData.name}" has been saved successfully.
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                `;
                connectionForm.insertAdjacentElement('afterbegin', alert);
            }
        } catch (error) {
            showErrorAlert(error.message || 'Error saving connection. Please try again.');
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
            passwordInput.value = connection.password;
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
