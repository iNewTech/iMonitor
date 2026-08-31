/**
 * Initializes the shared IBMEye alert delivery and watch rules.
 */
export function initAlertSettings({ root, slackSettings }) {
    const form = root.querySelector('#settings-alert-form');
    const status = root.querySelector('#settings-alert-status');
    const summary = root.querySelector('#settings-alert-summary-status');
    const desktop = root.querySelector('#settings-alert-desktop');
    const slack = root.querySelector('#settings-alert-slack');
    const email = root.querySelector('#settings-alert-email');
    const highCpu = root.querySelector('#settings-alert-high-cpu');
    const messageWait = root.querySelector('#settings-alert-message-wait');
    const lockWait = root.querySelector('#settings-alert-lock-wait');
    const delayWait = root.querySelector('#settings-alert-delay-wait');
    const dequeueWait = root.querySelector('#settings-alert-dequeue-wait');
    const pollFailure = root.querySelector('#settings-alert-poll-failure');
    const disconnect = root.querySelector('#settings-alert-disconnect');
    const cpuThreshold = root.querySelector('#settings-alert-cpu-threshold');
    let alertSettings;
    let emailSettings;
    let slackState;

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        if (!alertSettings) return;
        if (desktop) desktop.checked = Boolean(alertSettings.desktopNotifications);
        if (slack) slack.checked = Boolean(slackState?.enabled);
        if (email) email.checked = Boolean(emailSettings?.enabled);
        if (highCpu) highCpu.checked = Boolean(alertSettings.watchHighCpu);
        if (messageWait) messageWait.checked = Boolean(alertSettings.watchMessageWait);
        if (lockWait) lockWait.checked = Boolean(alertSettings.watchLockWait);
        if (delayWait) delayWait.checked = Boolean(alertSettings.watchDelayWait);
        if (dequeueWait) dequeueWait.checked = Boolean(alertSettings.watchDequeueWait);
        if (pollFailure) pollFailure.checked = Boolean(alertSettings.watchFailedPolls);
        if (disconnect) disconnect.checked = Boolean(alertSettings.watchDisconnects);
        if (cpuThreshold) cpuThreshold.value = String(alertSettings.highCpuThreshold || 80);
        if (summary) {
            const channels = [desktop?.checked && 'Desktop', slack?.checked && 'Slack', email?.checked && 'Email'].filter(Boolean);
            summary.textContent = channels.length ? `${channels.join(' · ')} notifications` : 'Notifications off';
        }
    }

    async function refresh() {
        setStatus('Loading alert settings...');
        try {
            [alertSettings, emailSettings, slackState] = await Promise.all([
                window.electronAPI.getAlertSettings(),
                window.electronAPI.getEmailNotificationSettings(),
                window.electronAPI.getSlackSettings()
            ]);
            render();
            setStatus('Alert delivery and watch rules are ready.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to load alert settings.', true);
        }
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        setStatus('Saving alert settings...');
        try {
            alertSettings = await window.electronAPI.saveAlertSettings({
                desktopNotifications: Boolean(desktop?.checked),
                watchHighCpu: Boolean(highCpu?.checked),
                highCpuThreshold: Number.parseInt(cpuThreshold?.value || '80', 10) || 80,
                watchMessageWait: Boolean(messageWait?.checked),
                watchLockWait: Boolean(lockWait?.checked),
                watchDelayWait: Boolean(delayWait?.checked),
                watchDequeueWait: Boolean(dequeueWait?.checked),
                watchFailedPolls: Boolean(pollFailure?.checked),
                watchDisconnects: Boolean(disconnect?.checked)
            });
            slackState = await window.electronAPI.saveSlackSettings({
                ...slackState,
                enabled: Boolean(slack?.checked)
            });
            emailSettings = await window.electronAPI.saveEmailNotificationSettings({
                ...emailSettings,
                enabled: Boolean(email?.checked)
            });
            render();
            setStatus('Alert settings saved.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save alert settings.', true);
        } finally {
            if (button) button.disabled = false;
        }
    });

    return { refresh };
}
