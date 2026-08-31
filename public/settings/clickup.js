function renderOptions(select, options, selectedValue, emptyLabel, formatter = (option) => option.name, selectedLabel = '') {
    if (!select) {
        return;
    }

    const safeOptions = Array.isArray(options) ? options : [];
    const selectedOption = selectedValue && !safeOptions.some((option) => option.id === selectedValue)
        ? [{ id: selectedValue, name: selectedLabel || selectedValue }]
        : [];
    select.innerHTML = [
        `<option value="">${emptyLabel}</option>`,
        ...[...selectedOption, ...safeOptions].map((option) => (
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
    const userEmailInput = root.querySelector('#settings-clickup-user-email');
    const memberIdInput = root.querySelector('#settings-clickup-member-id');
    const workspaceInput = root.querySelector('#settings-clickup-workspace');
    const spaceInput = root.querySelector('#settings-clickup-space');
    const listInput = root.querySelector('#settings-clickup-list');
    const syncCommentsInput = root.querySelector('#settings-clickup-sync-comments');
    const loadTargetsButton = root.querySelector('#clickup-load-targets');
    const status = root.querySelector('#settings-clickup-status');
    const summaryStatus = root.querySelector('#settings-clickup-summary-status');

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

    function getAssigneeSettings() {
        const userEmail = String(userEmailInput?.value || '').trim();
        const matchesSavedEmail = userEmail.toLowerCase() === String(settings?.userEmail || '').toLowerCase();
        const savedMemberId = matchesSavedEmail
            ? settings?.memberId || settings?.assigneeUserId || ''
            : '';
        return {
            userEmail,
            memberId: savedMemberId,
            assigneeUserId: savedMemberId
        };
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
        if (userEmailInput) {
            userEmailInput.value = settings.userEmail || '';
        }
        if (memberIdInput) {
            memberIdInput.value = settings.memberId || settings.assigneeUserId || '';
        }
        if (syncCommentsInput) {
            syncCommentsInput.checked = Boolean(settings.syncComments);
        }

        renderOptions(workspaceInput, options.workspaces, settings.workspaceId, 'Select workspace', (option) => option.name, settings.workspaceName);
        renderOptions(spaceInput, options.spaces, settings.spaceId, 'Select space', (option) => option.name, settings.spaceName);
        renderOptions(
            listInput,
            options.lists,
            settings.listId,
            'Select list',
            (option) => option.folderName ? `${option.name} (${option.folderName})` : option.name,
            settings.listName
        );

        if (summaryStatus) {
            summaryStatus.textContent = settings.enabled && settings.listId
                ? `Connected${settings.listName ? ` · ${settings.listName}` : ''}`
                : settings.enabled
                    ? 'Needs target list'
                    : 'Disabled';
        }
    }

    async function loadSettings() {
        settings = await window.electronAPI.getClickUpSettings();
        render();
    }

    async function loadTargets() {
        const assigneeSettings = getAssigneeSettings();
        const draftSettings = {
            enabled: Boolean(enabledInput?.checked),
            apiToken: tokenInput?.value || '',
            ...assigneeSettings,
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

            settings = await window.electronAPI.saveClickUpSettings({
                workspaceId: settings.workspaceId,
                workspaceName: options.workspaces.find((item) => item.id === settings.workspaceId)?.name || settings.workspaceName,
                spaceId: settings.spaceId,
                spaceName: options.spaces.find((item) => item.id === settings.spaceId)?.name || settings.spaceName,
                listId: settings.listId,
                listName: options.lists.find((item) => item.id === settings.listId)?.name || settings.listName
            });

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

    userEmailInput?.addEventListener('input', () => {
        const matchesSavedEmail = String(userEmailInput.value || '').trim().toLowerCase()
            === String(settings?.userEmail || '').trim().toLowerCase();
        if (memberIdInput && !matchesSavedEmail) {
            memberIdInput.value = '';
        }
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving ClickUp settings...');
        let settingsSaved = false;

        try {
            const workspace = options.workspaces.find((option) => option.id === (workspaceInput?.value || ''));
            const space = options.spaces.find((option) => option.id === (spaceInput?.value || ''));
            const list = options.lists.find((option) => option.id === (listInput?.value || ''));
            const assigneeSettings = getAssigneeSettings();

            settings = await window.electronAPI.saveClickUpSettings({
                enabled: Boolean(enabledInput?.checked),
                apiToken: tokenInput?.value || '',
                ...assigneeSettings,
                workspaceId: workspaceInput?.value || settings?.workspaceId || '',
                workspaceName: workspace?.name || settings?.workspaceName || '',
                spaceId: spaceInput?.value || settings?.spaceId || '',
                spaceName: space?.name || settings?.spaceName || '',
                listId: listInput?.value || settings?.listId || '',
                listName: list?.name || settings?.listName || '',
                syncComments: Boolean(syncCommentsInput?.checked)
            });
            settingsSaved = true;

            if (settings.userEmail && !settings.memberId && settings.apiToken) {
                setStatus('Settings saved. Resolving the ClickUp assignee email...');
                const result = await window.electronAPI.resolveClickUpAssignee();
                if (!result.success || !result.memberId) {
                    throw new Error(result.error || 'The ClickUp assignee email could not be resolved.');
                }
                settings = await window.electronAPI.getClickUpSettings();
            }

            render();
            setStatus(settings.memberId
                ? `ClickUp settings saved. Member ID ${settings.memberId} is cached for this operator.`
                : settings.userEmail && !settings.apiToken
                    ? 'ClickUp settings saved. Add an API token to resolve the member ID.'
                    : 'ClickUp settings saved.');
        } catch (error) {
            setStatus(
                settingsSaved
                    ? `Settings saved, but the assignee was not resolved: ${error instanceof Error ? error.message : String(error)}`
                    : error instanceof Error ? error.message : 'Unable to save ClickUp settings.',
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
