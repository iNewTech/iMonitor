import { showAlert } from './feedback.js';

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

/** Saved-profile selection and editing stay in memory; passwords never enter browser storage. */
export function initSavedProfiles(elements) {
    const get = id => document.getElementById(id);
    let connections = [];
    let editingId = '';
    let busy = false;
    let loading = false;
    let requestVersion = 0;
    const fields = get('connection-fields');
    const save = elements.saveConnectionButton;
    const selected = () => connections.find(item => item.id === elements.savedConnectionsSelect.value);
    function setBusy(value) {
        busy = value;
        [elements.connectButton, save, get('add-connection'), elements.editConnectionButton,
            elements.deleteConnectionButton, get('cancel-edit-connection'), elements.savedConnectionsSelect,
            ...fields.querySelectorAll('input, button')].forEach(control => { control.disabled = value; });
        elements.savedConnectionsSelect.disabled = value || !connections.length;
    }
    function reveal() {
        if (fields.hidden && selected()) editingId = selected().id;
        fields.hidden = false;
        save.hidden = false;
        get('connection-editor-title').textContent = editingId ? 'Edit system' : 'Add system';
        get('cancel-edit-connection').hidden = !connections.length;
        save.textContent = editingId ? 'Update Profile' : 'Save Profile';
    }
    function choose(connection) {
        editingId = '';
        elements.passwordInput.type = 'password';
        elements.togglePasswordButton.querySelector('i').className = 'bi bi-eye';
        elements.connectionForm.classList.remove('was-validated');
        if (connection) {
            elements.savedConnectionsSelect.value = connection.id;
            fillForm(elements, connection);
            fields.hidden = true;
            save.hidden = true;
            elements.savedHint.textContent = `${connection.user} · ${connection.host}:${connection.port || 8076}`;
            elements.savedHint.title = connection.name;
        } else {
            elements.savedConnectionsSelect.value = '';
            clearForm(elements);
            reveal();
            elements.savedHint.textContent = 'Add a system to start monitoring.';
        }
        elements.editConnectionButton.hidden = !connection;
        elements.deleteConnectionButton.hidden = !connection;
        get('add-connection').hidden = !fields.hidden;
        setBusy(false);
    }
    async function load(preferredId = '', preserveEditor = false) {
        const version = ++requestVersion;
        loading = true;
        get('retry-profiles').hidden = true;
        if (!preserveEditor) setBusy(true);
        try {
            const next = await window.electronAPI.loadConnections();
            if (version !== requestVersion) return;
            connections = Array.isArray(next) ? next : [];
            // A background profile refresh must not replace an operator's unfinished edit.
            if (preserveEditor && !fields.hidden) return;
            const choice = connections.find(item => item.id === preferredId) || connections[0];
            renderSavedConnections(elements, connections, choice?.id || '');
            choose(choice);
        } catch {
            if (version !== requestVersion) return;
            elements.savedHint.textContent = 'Unable to load saved systems. Retry, or add a system.';
            get('retry-profiles').hidden = false;
            setBusy(false);
            if (!connections.length) choose(null);
            showAlert(elements.connectionForm, 'Unable to load saved systems. Retry loading profiles.');
        } finally { if (version === requestVersion) loading = false; }
    }
    const getData = () => ({
        ...(editingId || (fields.hidden && selected()?.id) ? { id: editingId || selected().id } : {}),
        name: elements.connectionNameInput.value.trim(), host: elements.systemInput.value.trim(),
        port: Number(elements.portInput.value || 8076), user: elements.usernameInput.value.trim(),
        password: elements.passwordInput.value
    });
    get('retry-profiles').addEventListener('click', () => void load());
    window.electronAPI.onConnectionsUpdated(() => { if (!busy && !loading) void load(selected()?.id, true); });
    elements.savedConnectionsSelect.addEventListener('change', () => choose(selected()));
    elements.editConnectionButton.addEventListener('click', () => {
        editingId = selected()?.id || '';
        reveal(); get('add-connection').hidden = true;
        elements.connectionNameInput.focus();
    });
    get('add-connection').addEventListener('click', () => { choose(null); elements.connectionNameInput.focus(); });
    get('cancel-edit-connection').addEventListener('click', () => {
        choose(connections.find(item => item.id === editingId) || connections[0]);
        elements.editConnectionButton.focus();
    });
    save.addEventListener('click', async () => {
        if (busy) return;
        if (!elements.connectionForm.checkValidity()) {
            elements.connectionForm.classList.add('was-validated');
            elements.connectionForm.reportValidity(); return;
        }
        const data = getData();
        setBusy(true);
        try {
            const result = await window.electronAPI.saveConnection(data);
            if (!result.success) { showAlert(elements.connectionForm, result.error || 'Unable to save profile.', 'danger', result.detail); return; }
            await load(result.id);
            showAlert(elements.connectionForm, `Profile ${data.id ? 'updated' : 'saved'}.`, 'success');
            elements.connectButton.focus();
        } catch (error) { showAlert(elements.connectionForm, error.message || 'Unable to save profile.'); }
        finally { setBusy(false); }
    });
    elements.deleteConnectionButton.addEventListener('click', async () => {
        if (busy || !selected()) return;
        const id = selected().id;
        setBusy(true);
        try {
            const result = await window.electronAPI.deleteConnection(id);
            if (!result.success) { showAlert(elements.connectionForm, result.error || 'Unable to delete profile.'); return; }
            await load();
            showAlert(elements.connectionForm, 'Saved connection deleted.', 'success');
            (fields.hidden ? elements.connectButton : elements.connectionNameInput).focus();
        } catch (error) { showAlert(elements.connectionForm, error.message || 'Unable to delete profile.'); }
        finally { setBusy(false); }
    });
    const canLeave = () => {
        if (busy) return false;
        if (fields.hidden) return true;
        const data = getData();
        const original = connections.find(item => item.id === editingId);
        return original
            ? ['name', 'host', 'port', 'user', 'password'].every(key => String(data[key] ?? '') === String(original[key] ?? ''))
            : ![data.name, data.host, data.user, data.password].some(Boolean);
    };
    return { load, getData, setBusy, reveal, canLeave };
}
