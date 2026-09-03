import { describe, expect, it } from 'vitest';
import type { MonitorAlert } from '../../alerts/alert-model';
import {
    DEFAULT_JIRA_SETTINGS,
    buildJiraIssuePayload,
    normalizeJiraSettings,
    normalizeStoredJiraSettings,
    toRenderableJiraSettings,
    toStoredJiraSettings
} from './jira-model';

const alert: MonitorAlert = {
    id: 'msgw:123/QINTER/DEMOJOB',
    kind: 'messageWait',
    severity: 'critical',
    timestamp: '2026-09-03T09:00:00.000Z',
    title: 'MSGW detected',
    message: 'QINTER/DEMOJOB entered message wait.',
    detail: 'Waiting for an operator reply.',
    jobName: '123/QINTER/DEMOJOB',
    workflowStatus: 'new',
    notes: [],
    timeline: [],
    workflowUpdatedAt: '2026-09-03T09:00:00.000Z'
};

describe('jira-model', () => {
    it('normalizes Jira connection details for the API', () => {
        expect(normalizeJiraSettings({
            baseUrl: ' https://example.atlassian.net/ ',
            projectKey: ' ops ',
            issueType: ''
        })).toEqual({
            ...DEFAULT_JIRA_SETTINGS,
            baseUrl: 'https://example.atlassian.net',
            projectKey: 'OPS'
        });
    });

    it('protects the API token when converting settings for storage', () => {
        const stored = toStoredJiraSettings({
            ...DEFAULT_JIRA_SETTINGS,
            apiToken: 'secret-token',
            projectKey: 'OPS'
        }, (value) => `encrypted:${value}`);

        expect(stored.encryptedApiToken).toBe('encrypted:secret-token');
        expect(toRenderableJiraSettings(stored, (value) => value.replace('encrypted:', ''))).toEqual({
            ...DEFAULT_JIRA_SETTINGS,
            apiToken: 'secret-token',
            projectKey: 'OPS'
        });
    });

    it('builds a Jira issue using the incident and job evidence', () => {
        const payload = buildJiraIssuePayload(alert, {
            ...DEFAULT_JIRA_SETTINGS,
            projectKey: 'OPS'
        });
        const description = payload.fields.description.content[0].content[0].text;

        expect(payload.fields.project.key).toBe('OPS');
        expect(payload.fields.issuetype.name).toBe('Task');
        expect(payload.fields.summary).toContain('MSGW detected');
        expect(payload.fields.labels).toEqual(expect.arrayContaining(['imonitor', 'ibmeye', 'messagewait']));
        expect(description).toContain('123/QINTER/DEMOJOB');
        expect(description).toContain('Waiting for an operator reply.');
    });

    it('removes legacy credentials and keeps only the supported stored shape', () => {
        expect(normalizeStoredJiraSettings({
            enabled: true,
            baseUrl: 'https://example.atlassian.net',
            username: 'ops@example.com',
            encryptedApiToken: 'encrypted:token',
            projectKey: 'ops'
        })).toEqual({
            enabled: true,
            baseUrl: 'https://example.atlassian.net',
            username: 'ops@example.com',
            encryptedApiToken: 'encrypted:token',
            projectKey: 'OPS',
            issueType: 'Task'
        });
    });
});
