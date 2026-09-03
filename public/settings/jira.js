/** Initializes the Jira incident integration settings form. */
export function initJiraSettings({ root }) {
    const form = root.querySelector('#settings-jira-form');
    const baseUrlInput = root.querySelector('#settings-jira-base-url');
    const usernameInput = root.querySelector('#settings-jira-username');
    const apiTokenInput = root.querySelector('#settings-jira-api-token');
    const projectKeyInput = root.querySelector('#settings-jira-project-key');
    const issueTypeInput = root.querySelector('#settings-jira-issue-type');
    const testButton = root.querySelector('#settings-jira-test');
    const status = root.querySelector('#settings-jira-status');
    const summaryStatus = root.querySelector('#settings-jira-summary-status');

    let settings = null;

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        if (!settings) return;
        if (baseUrlInput) baseUrlInput.value = settings.baseUrl || '';
        if (usernameInput) usernameInput.value = settings.username || '';
        if (apiTokenInput) apiTokenInput.value = settings.apiToken || '';
        if (projectKeyInput) projectKeyInput.value = settings.projectKey || '';
        if (issueTypeInput) issueTypeInput.value = settings.issueType || 'Task';
        if (summaryStatus) {
            summaryStatus.textContent = settings.enabled && settings.baseUrl && settings.projectKey
                ? `Connected · ${settings.projectKey}`
                : settings.enabled
                    ? 'Needs setup'
                    : 'Disabled';
        }
    }

    function getDraftSettings() {
        return {
            baseUrl: baseUrlInput?.value || '',
            username: usernameInput?.value || '',
            apiToken: apiTokenInput?.value || '',
            projectKey: projectKeyInput?.value || '',
            issueType: issueTypeInput?.value || 'Task'
        };
    }

    async function save() {
        settings = await window.electronAPI.saveJiraSettings(getDraftSettings());
        render();
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving Jira settings...');
        try {
            await save();
            setStatus('Jira settings saved. Enable Jira in IBMEye Alerts to create issues.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save Jira settings.', true);
        }
    });

    testButton?.addEventListener('click', async () => {
        setStatus('Saving settings and creating a Jira test issue...');
        testButton.disabled = true;
        try {
            await save();
            const result = await window.electronAPI.sendTestJiraMessage();
            if (!result.success) {
                throw new Error(result.error || 'Jira test issue creation failed.');
            }
            setStatus(`Jira test issue created: ${result.issue?.key || 'success'}.`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Jira test issue creation failed.', true);
        } finally {
            testButton.disabled = false;
        }
    });

    return {
        refresh: async () => {
            setStatus('Loading Jira settings...');
            try {
                settings = await window.electronAPI.getJiraSettings();
                render();
                setStatus(settings?.enabled && settings?.baseUrl && settings?.projectKey
                    ? `Jira alerts ready for ${settings.projectKey}.`
                    : 'Add Jira connection details to enable incident issues.');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Unable to load Jira settings.', true);
            }
        }
    };
}
