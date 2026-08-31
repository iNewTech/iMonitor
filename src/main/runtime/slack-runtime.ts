import {
    buildSlackAlertPayload,
    normalizeSlackSettings,
    type SlackWebhookPayload,
    type SlackSettings
} from '../../features/integrations/slack/slack-model';
import type { MonitorAlert } from '../../features/alerts/alert-model';

interface SlackRuntimeDependencies {
    getSettings: () => SlackSettings;
    getOperatorName?: () => string;
    recordActivity: (entry: {
        area: 'connection' | 'monitoring' | 'storage';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    fetchImpl?: typeof fetch;
}

/**
 * Sends operator alert messages to a configured Slack channel webhook.
 */
export function createSlackRuntime(dependencies: SlackRuntimeDependencies) {
    const fetcher = dependencies.fetchImpl ?? fetch;

    function getConfiguredSettings() {
        const settings = normalizeSlackSettings(dependencies.getSettings());
        if (!settings.enabled) {
            throw new Error('Slack alerts are turned off in Settings.');
        }

        if (!settings.webhookUrl) {
            throw new Error('Add a Slack incoming webhook URL in Settings before sending alerts.');
        }

        let webhook: URL;
        try {
            webhook = new URL(settings.webhookUrl);
        } catch {
            throw new Error('The Slack webhook URL is not valid.');
        }

        const allowedHost = webhook.hostname === 'hooks.slack.com'
            || webhook.hostname === 'hooks.slack-gov.com';
        if (webhook.protocol !== 'https:' || !allowedHost || !webhook.pathname.startsWith('/services/')) {
            throw new Error('Use an HTTPS Slack incoming webhook URL from hooks.slack.com.');
        }

        return settings;
    }

    function canSendAlerts() {
        const settings = normalizeSlackSettings(dependencies.getSettings());
        return Boolean(settings.enabled && settings.webhookUrl);
    }

    async function sendMessage(payload: SlackWebhookPayload) {
        const settings = getConfiguredSettings();
        const response = await fetcher(settings.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Slack webhook ${response.status}: ${errorText || response.statusText}`);
        }

        dependencies.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Sent alert to Slack.',
            detail: settings.channelName ? `Channel: ${settings.channelName}` : 'Configured Slack channel'
        });

        return { success: true };
    }

    return {
        canSendAlerts,
        async sendAlert(alert: MonitorAlert) {
            return sendMessage(buildSlackAlertPayload(alert));
        },
        async sendTestMessage() {
            const operator = dependencies.getOperatorName?.() || 'local operator';
            const sentAt = new Date().toISOString();
            return sendMessage({
                text: `IBMEye Slack integration test | ${operator}`,
                attachments: [{
                    color: '#2C8176',
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: 'IBMEye Slack connection test',
                                emoji: true
                            }
                        },
                        {
                            type: 'section',
                            fields: [
                                { type: 'mrkdwn', text: `*Operator*\n${operator}` },
                                { type: 'mrkdwn', text: `*Sent*\n${sentAt}` }
                            ]
                        },
                        {
                            type: 'context',
                            elements: [{
                                type: 'mrkdwn',
                                text: 'Alert delivery is configured and working.'
                            }]
                        }
                    ]
                }]
            });
        }
    };
}
