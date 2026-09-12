import {
    buildJiraIssuePayload,
    normalizeJiraSettings,
    type JiraIssueReference,
    type JiraSettings
} from '../../features/integrations/jira/jira-model';
import type { MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';

interface JiraRuntimeDependencies {
    getSettings: () => JiraSettings;
    getOperatorName?: () => string;
    recordActivity: (entry: {
        area: 'connection' | 'monitoring' | 'storage';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    fetchImpl?: typeof fetch;
}

interface JiraIssueResponse {
    id?: string;
    key?: string;
    self?: string;
    errors?: Record<string, string>;
    errorMessages?: string[];
}

interface JiraCommentPayload {
    body: {
        type: 'doc';
        version: 1;
        content: Array<{
            type: 'paragraph';
            content: Array<{ type: 'text'; text: string }>;
        }>;
    };
}

/** Creates the Jira Cloud REST client used for alert issue delivery. */
export function createJiraRuntime(dependencies: JiraRuntimeDependencies) {
    const fetcher = dependencies.fetchImpl ?? fetch;

    function getConfiguredSettings() {
        const settings = normalizeJiraSettings(dependencies.getSettings());
        if (!settings.enabled) {
            throw new Error('Jira alerts are turned off in Settings.');
        }

        if (!settings.baseUrl || !settings.username || !settings.apiToken || !settings.projectKey) {
            throw new Error('Complete the Jira site URL, account email, API token, and project key in Settings.');
        }

        let siteUrl: URL;
        try {
            siteUrl = new URL(settings.baseUrl);
        } catch {
            throw new Error('The Jira site URL is not valid.');
        }

        if (siteUrl.protocol !== 'https:') {
            throw new Error('Use an HTTPS Jira site URL.');
        }

        return settings;
    }

    function canSendAlerts() {
        const settings = normalizeJiraSettings(dependencies.getSettings());
        return Boolean(
            settings.enabled
            && settings.baseUrl
            && settings.username
            && settings.apiToken
            && settings.projectKey
        );
    }

    async function createIssue(payload: ReturnType<typeof buildJiraIssuePayload>) {
        const settings = getConfiguredSettings();
        const response = await fetcher(`${settings.baseUrl}/rest/api/3/issue`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${settings.username}:${settings.apiToken}`).toString('base64')}`
            },
            body: JSON.stringify(payload)
        });
        const responseText = await response.text();
        let responseBody: JiraIssueResponse = {};
        try {
            responseBody = responseText ? JSON.parse(responseText) as JiraIssueResponse : {};
        } catch {
            // Jira may return a plain-text gateway error; the status is still useful below.
        }

        if (!response.ok) {
            const detail = [
                ...(responseBody.errorMessages ?? []),
                ...Object.values(responseBody.errors ?? {}),
                responseText
            ].find(Boolean);
            throw new Error(`Jira API ${response.status}: ${detail || response.statusText}`);
        }

        if (!responseBody.id || !responseBody.key) {
            throw new Error('Jira created the issue but returned no issue key.');
        }

        const issue: JiraIssueReference = {
            id: responseBody.id,
            key: responseBody.key,
            url: `${settings.baseUrl}/browse/${encodeURIComponent(responseBody.key)}`
        };
        dependencies.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Created alert issue in Jira.',
            detail: `${issue.key} · ${issue.url}`
        });
        return issue;
    }

    async function addComment(issueKey: string, commentText: string) {
        const settings = getConfiguredSettings();
        const normalizedText = commentText.trim().slice(0, 5000);
        if (!normalizedText) return;

        const payload: JiraCommentPayload = {
            body: {
                type: 'doc',
                version: 1,
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: normalizedText }]
                }]
            }
        };
        const response = await fetcher(
            `${settings.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
            {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${Buffer.from(`${settings.username}:${settings.apiToken}`).toString('base64')}`
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`Jira comment API ${response.status}: ${responseText || response.statusText}`);
        }
    }

    function buildWorkflowComment(params: {
        alertId: string;
        action: string;
        nextState: StoredAlertWorkflowState;
        note?: string;
    }) {
        const owner = params.nextState.owner || 'Unassigned';
        return [
            `iMonitor alert update: ${params.action}`,
            `Incident ID: ${params.alertId}`,
            `Workflow status: ${params.nextState.status}`,
            `Assigned owner: ${owner}`,
            params.nextState.lastActionSummary ? `Summary: ${params.nextState.lastActionSummary}` : '',
            params.nextState.handoff
                ? `Handoff: ${params.nextState.handoff.status} from ${params.nextState.handoff.fromOperator} to ${params.nextState.handoff.toOperator}`
                : '',
            params.nextState.handoff?.responseTargetAt
                ? `Response target: ${params.nextState.handoff.responseTargetAt}`
                : '',
            params.nextState.handoff?.reason ? `Handoff reason: ${params.nextState.handoff.reason}` : '',
            params.note ? `Note: ${params.note}` : ''
        ].filter(Boolean).join('\n');
    }

    return {
        canSendAlerts,
        async sendAlert(alert: MonitorAlert) {
            return createIssue(buildJiraIssuePayload(alert, normalizeJiraSettings(dependencies.getSettings())));
        },
        async sendTestMessage() {
            const settings = normalizeJiraSettings(dependencies.getSettings());
            return createIssue(buildJiraIssuePayload({
                id: 'jira-connection-test',
                kind: 'pollFailure',
                severity: 'warning',
                timestamp: new Date().toISOString(),
                title: 'Jira connection test',
                message: `Jira alert delivery is configured for ${dependencies.getOperatorName?.() || 'local operator'}.`,
                workflowStatus: 'new',
                notes: [],
                timeline: [],
                workflowUpdatedAt: new Date().toISOString()
            }, settings));
        },
        async syncAlertWorkflowComment(params: {
            issueKey: string;
            alertId: string;
            action: string;
            nextState: StoredAlertWorkflowState;
            note?: string;
        }) {
            await addComment(params.issueKey, buildWorkflowComment(params));
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Posted the latest alert update to Jira.',
                detail: `${params.alertId} | ${params.issueKey}`
            });
            return { success: true };
        }
    };
}
