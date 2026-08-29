function renderOptions(select, options, selectedValue, emptyLabel, formatter = (option) => option.name) {
    if (!select) {
        return;
    }

    const safeOptions = Array.isArray(options) ? options : [];
    select.innerHTML = [
        `<option value="">${emptyLabel}</option>`,
        ...safeOptions.map((option) => (
            `<option value="${option.id}">${formatter(option)}</option>`
        ))
    ].join('');
    select.value = selectedValue || '';
}

/**
 * Initializes the ClickUp integration settings form.
 */
export function initClickUpSettings(dependencies) {
    const {
        root
    } = dependencies;

    const form = root.querySelector('#settings-clickup-form');
    const enabledInput = root.querySelector('#settings-clickup-enabled');
    const tokenInput = root.querySelector('#settings-clickup-token');
    const workspaceInput = root.querySelector('#settings-clickup-workspace');
    const spaceInput = root.querySelector('#settings-clickup-space');
    const listInput = root.querySelector('#settings-clickup-list');
    const syncCommentsInput = root.querySelector('#settings-clickup-sync-comments');
    const loadTargetsButton = root.querySelector('#clickup-load-targets');
    const status = root.querySelector('#settings-clickup-status');

    let settings = null;
    let options = {
        workspaces: [],
        spaces: [],
        lists: []
    };

    function setStatus(message, isError = false) {
        if (!status) {
            return;
        }

        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        if (!settings) {
            return;
        }

        if (enabledInput) {
            enabledInput.checked = Boolean(settings.enabled);
        }
        if (tokenInput) {
            tokenInput.value = settings.apiToken || '';
        }
        if (syncCommentsInput) {
            syncCommentsInput.checked = Boolean(settings.syncComments);
        }

        renderOptions(workspaceInput, options.workspaces, settings.workspaceId, 'Select workspace');
        renderOptions(spaceInput, options.spaces, settings.spaceId, 'Select space');
        renderOptions(
            listInput,
            options.lists,
            settings.listId,
            'Select list',
            (option) => option.folderName ? `${option.name} (${option.folderName})` : option.name
        );
    }

    async function loadSettings() {
        settings = await window.electronAPI.getClickUpSettings();
        render();
    }

    async function loadTargets() {
        const draftSettings = {
            enabled: Boolean(enabledInput?.checked),
            apiToken: tokenInput?.value || '',
            workspaceId: workspaceInput?.value || settings?.workspaceId || '',
            workspaceName: settings?.workspaceName || '',
            spaceId: spaceInput?.value || settings?.spaceId || '',
            spaceName: settings?.spaceName || '',
            listId: listInput?.value || settings?.listId || '',
            listName: settings?.listName || '',
            syncComments: Boolean(syncCommentsInput?.checked)
        };

        setStatus('Loading ClickUp workspaces, spaces, and lists...');

        try {
            settings = await window.electronAPI.saveClickUpSettings(draftSettings);
            options = await window.electronAPI.loadClickUpTargetOptions();

            if (!settings.workspaceId) {
                settings.workspaceId = options.workspaces[0]?.id || '';
            }
            if (!settings.spaceId) {
                settings.spaceId = options.spaces[0]?.id || '';
            }
            if (!settings.listId) {
                settings.listId = options.lists[0]?.id || '';
            }

            render();
            setStatus(`Loaded ${options.workspaces.length} workspace(s), ${options.spaces.length} space(s), and ${options.lists.length} list(s).`);
        } catch (error) {
            setStatus(
                error instanceof Error ? error.message : 'Unable to load ClickUp targets.',
                true
            );
        }
    }

    workspaceInput?.addEventListener('change', async () => {
        settings = {
            ...settings,
            workspaceId: workspaceInput.value,
            spaceId: '',
            listId: ''
        };
        await loadTargets();
    });

    spaceInput?.addEventListener('change', async () => {
        settings = {
            ...settings,
            spaceId: spaceInput.value,
            listId: ''
        };
        await loadTargets();
    });

    loadTargetsButton?.addEventListener('click', () => {
        void loadTargets();
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving ClickUp settings...');

        try {
            const workspace = options.workspaces.find((option) => option.id === (workspaceInput?.value || ''));
            const space = options.spaces.find((option) => option.id === (spaceInput?.value || ''));
            const list = options.lists.find((option) => option.id === (listInput?.value || ''));

            settings = await window.electronAPI.saveClickUpSettings({
                enabled: Boolean(enabledInput?.checked),
                apiToken: tokenInput?.value || '',
                workspaceId: workspaceInput?.value || '',
                workspaceName: workspace?.name || '',
                spaceId: spaceInput?.value || '',
                spaceName: space?.name || '',
                listId: listInput?.value || '',
                listName: list?.name || '',
                syncComments: Boolean(syncCommentsInput?.checked)
            });
            render();
            setStatus('ClickUp settings saved.');
        } catch (error) {
            setStatus(
                error instanceof Error ? error.message : 'Unable to save ClickUp settings.',
                true
            );
        }
    });

    return {
        refresh: async () => {
            setStatus('Loading ClickUp settings...');

            try {
                await loadSettings();
                setStatus(settings?.listId
                    ? `Current target: ${settings.listName || settings.listId}`
                    : 'Choose a token and load targets to select a destination list.');
            } catch (error) {
                setStatus(
                    error instanceof Error ? error.message : 'Unable to load ClickUp settings.',
                    true
                );
            }
        }
    };
}
