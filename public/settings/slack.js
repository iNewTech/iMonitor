/**
 * Initializes the Slack channel alert settings form.
 */
export function initSlackSettings(dependencies) {
    const { root } = dependencies;
    const form = root.querySelector('#settings-slack-form');
    const enabledInput = root.querySelector('#settings-slack-enabled');
    const webhookInput = root.querySelector('#settings-slack-webhook');
    const channelInput = root.querySelector('#settings-slack-channel');
    const messageWaitInput = root.querySelector('#settings-slack-message-wait');
    const lockWaitInput = root.querySelector('#settings-slack-lock-wait');
    const highCpuInput = root.querySelector('#settings-slack-high-cpu');
    const delayWaitInput = root.querySelector('#settings-slack-delay-wait');
    const dequeueWaitInput = root.querySelector('#settings-slack-dequeue-wait');
    const pollFailureInput = root.querySelector('#settings-slack-poll-failure');
    const testButton = root.querySelector('#settings-slack-test');
    const status = root.querySelector('#settings-slack-status');
    const summaryStatus = root.querySelector('#settings-slack-summary-status');

    let settings = null;

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

        if (enabledInput) enabledInput.checked = Boolean(settings.enabled);
        if (webhookInput) webhookInput.value = settings.webhookUrl || '';
        if (channelInput) channelInput.value = settings.channelName || '';
        if (messageWaitInput) messageWaitInput.checked = Boolean(settings.sendMessageWait);
        if (lockWaitInput) lockWaitInput.checked = Boolean(settings.sendLockWait);
        if (highCpuInput) highCpuInput.checked = Boolean(settings.sendHighCpu);
        if (delayWaitInput) delayWaitInput.checked = Boolean(settings.sendDelayWait);
        if (dequeueWaitInput) dequeueWaitInput.checked = Boolean(settings.sendDequeueWait);
        if (pollFailureInput) pollFailureInput.checked = Boolean(settings.sendPollFailure);
        if (summaryStatus) {
            summaryStatus.textContent = settings.enabled && settings.webhookUrl
                ? `Connected${settings.channelName ? ` · ${settings.channelName}` : ''}`
                : settings.enabled
                    ? 'Needs webhook'
                    : 'Disabled';
        }
    }

    function getDraftSettings() {
        return {
            enabled: Boolean(enabledInput?.checked),
            webhookUrl: webhookInput?.value || '',
            channelName: channelInput?.value || '',
            sendMessageWait: Boolean(messageWaitInput?.checked),
            sendLockWait: Boolean(lockWaitInput?.checked),
            sendHighCpu: Boolean(highCpuInput?.checked),
            sendDelayWait: Boolean(delayWaitInput?.checked),
            sendDequeueWait: Boolean(dequeueWaitInput?.checked),
            sendPollFailure: Boolean(pollFailureInput?.checked)
        };
    }

    async function save() {
        settings = await window.electronAPI.saveSlackSettings(getDraftSettings());
        render();
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving Slack settings...');

        try {
            await save();
            setStatus('Slack settings saved.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save Slack settings.', true);
        }
    });

    testButton?.addEventListener('click', async () => {
        setStatus('Saving settings and sending a Slack test...');
        testButton.disabled = true;

        try {
            await save();
            const result = await window.electronAPI.sendTestSlackMessage();
            if (!result.success) {
                throw new Error(result.error || 'Slack test delivery failed.');
            }
            setStatus('Slack test message sent.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Slack test delivery failed.', true);
        } finally {
            testButton.disabled = false;
        }
    });

    return {
        refresh: async () => {
            setStatus('Loading Slack settings...');

            try {
                settings = await window.electronAPI.getSlackSettings();
                render();
                setStatus(settings?.enabled && settings?.webhookUrl
                    ? `Slack alerts ready${settings.channelName ? ` for ${settings.channelName}` : ''}.`
                    : 'Add a webhook URL to enable Slack alerts.');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Unable to load Slack settings.', true);
            }
        }
    };
}
