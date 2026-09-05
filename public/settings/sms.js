/**
 * Initializes the provider-neutral SMS HTTP API settings form.
 */
export function initSmsSettings({ root }) {
    const form = root.querySelector('#settings-sms-form');
    const providerName = root.querySelector('#settings-sms-provider-name');
    const endpoint = root.querySelector('#settings-sms-endpoint');
    const method = root.querySelector('#settings-sms-method');
    const authType = root.querySelector('#settings-sms-auth-type');
    const apiKey = root.querySelector('#settings-sms-api-key');
    const apiKeyHeader = root.querySelector('#settings-sms-api-key-header');
    const username = root.querySelector('#settings-sms-username');
    const password = root.querySelector('#settings-sms-password');
    const recipients = root.querySelector('#settings-sms-recipients');
    const bodyFormat = root.querySelector('#settings-sms-body-format');
    const bodyTemplate = root.querySelector('#settings-sms-body-template');
    const customHeaders = root.querySelector('#settings-sms-custom-headers');
    const responseIdPath = root.querySelector('#settings-sms-response-id-path');
    const testButton = root.querySelector('#settings-sms-test');
    const status = root.querySelector('#settings-sms-status');
    const summaryStatus = root.querySelector('#settings-sms-summary-status');

    let settings = null;

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        if (!settings) return;
        if (providerName) providerName.value = settings.providerName || '';
        if (endpoint) endpoint.value = settings.endpoint || '';
        if (method) method.value = settings.method || 'POST';
        if (authType) authType.value = settings.authType || 'none';
        if (apiKey) apiKey.value = settings.apiKey || '';
        if (apiKeyHeader) apiKeyHeader.value = settings.apiKeyHeader || 'X-API-Key';
        if (username) username.value = settings.username || '';
        if (password) password.value = settings.password || '';
        if (recipients) recipients.value = settings.recipients || '';
        if (bodyFormat) bodyFormat.value = settings.bodyFormat || 'json';
        if (bodyTemplate) bodyTemplate.value = settings.requestBodyTemplate || '';
        if (customHeaders) customHeaders.value = settings.customHeaders || '{}';
        if (responseIdPath) responseIdPath.value = settings.responseIdPath || '';
        if (summaryStatus) {
            summaryStatus.textContent = settings.enabled && settings.endpoint && settings.recipients
                ? `Connected · ${settings.providerName || 'Custom API'}`
                : settings.endpoint
                    ? 'Needs recipients or body'
                    : 'Not configured';
        }
        updateAuthFields();
    }

    function updateAuthFields() {
        const selectedAuth = authType?.value || 'none';
        if (apiKey) apiKey.disabled = selectedAuth !== 'bearer' && selectedAuth !== 'apiKey';
        if (apiKeyHeader) apiKeyHeader.disabled = selectedAuth !== 'apiKey';
        if (username) username.disabled = selectedAuth !== 'basic';
        if (password) password.disabled = selectedAuth !== 'basic';
        if (bodyTemplate) bodyTemplate.disabled = bodyFormat?.value === 'none';
    }

    function getDraftSettings() {
        return {
            providerName: providerName?.value || '',
            endpoint: endpoint?.value || '',
            method: method?.value || 'POST',
            authType: authType?.value || 'none',
            apiKey: apiKey?.value || '',
            apiKeyHeader: apiKeyHeader?.value || 'X-API-Key',
            username: username?.value || '',
            password: password?.value || '',
            recipients: recipients?.value || '',
            bodyFormat: bodyFormat?.value || 'json',
            requestBodyTemplate: bodyTemplate?.value || '',
            customHeaders: customHeaders?.value || '{}',
            responseIdPath: responseIdPath?.value || ''
        };
    }

    async function save() {
        settings = await window.electronAPI.saveSmsSettings(getDraftSettings());
        render();
    }

    authType?.addEventListener('change', updateAuthFields);
    bodyFormat?.addEventListener('change', updateAuthFields);

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving SMS settings...');

        try {
            await save();
            setStatus('SMS provider settings saved.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save SMS settings.', true);
        }
    });

    testButton?.addEventListener('click', async () => {
        setStatus('Saving settings and sending an SMS test...');
        testButton.disabled = true;

        try {
            await save();
            const result = await window.electronAPI.sendTestSms();
            if (!result.success) {
                throw new Error(result.error || 'SMS test delivery failed.');
            }
            setStatus('SMS test request sent.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'SMS test delivery failed.', true);
        } finally {
            testButton.disabled = false;
        }
    });

    return {
        refresh: async () => {
            setStatus('Loading SMS settings...');

            try {
                settings = await window.electronAPI.getSmsSettings();
                render();
                setStatus(settings?.endpoint ? 'SMS provider settings are ready.' : 'Add your SMS API details to get started.');
            } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Unable to load SMS settings.', true);
            }
        }
    };
}
