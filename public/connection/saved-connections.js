export function clearForm(elements) {
    elements.systemInput.value = '';
    elements.portInput.value = '8076';
    elements.usernameInput.value = '';
    elements.passwordInput.value = '';
    elements.connectionNameInput.value = '';
    elements.connectionForm.classList.remove('was-validated');
}

export function fillForm(elements, connection) {
    elements.systemInput.value = connection.host || '';
    elements.portInput.value = String(connection.port || 8076);
    elements.usernameInput.value = connection.user || '';
    elements.passwordInput.value = connection.password || '';
    elements.connectionNameInput.value = connection.name || '';
}

export function renderSavedConnections(elements, connections, selectedId = '') {
    const {
        savedConnectionsSelect,
        editConnectionButton,
        deleteConnectionButton,
        savedCount,
        savedHint
    } = elements;

    savedConnectionsSelect.innerHTML = '<option value="">-- Select Saved Connection --</option>';

    connections.forEach((connection) => {
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
    const hasSelection = Boolean(savedConnectionsSelect.value);
    editConnectionButton.hidden = !hasSelection;
    deleteConnectionButton.hidden = !hasSelection;
}
