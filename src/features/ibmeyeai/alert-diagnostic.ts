import type { MonitorAlert } from '../alerts/alert-model';

/**
 * Builds the backend prompt used when a new alert is linked to ClickUp.
 */
export function buildAlertDiagnosticPrompt(alert: MonitorAlert) {
    return [
        'Give a full diagnostic of this IBM i monitoring alert for a support operator.',
        'Use exactly these short sections: Issue, Why, How to resolve.',
        'Use only evidence in the monitor context and clearly label uncertainty.',
        'Do not claim that an IBM i or ClickUp action was executed.',
        '',
        `Alert id: ${alert.id}`,
        `Alert type: ${alert.kind}`,
        `Severity: ${alert.severity}`,
        `Title: ${alert.title}`,
        `Job: ${alert.jobName || 'No specific job'}`,
        `Summary: ${alert.message}`,
        `Current detail: ${alert.detail || 'No additional detail.'}`
    ].join('\n');
}

/**
 * Builds a conservative diagnostic comment when the configured AI provider is unavailable.
 */
export function buildFallbackAlertDiagnostic(alert: MonitorAlert, error: string) {
    return [
        'Issue:',
        `${alert.title}${alert.jobName ? ` on ${alert.jobName}` : ''}.`,
        '',
        'Why:',
        alert.detail || alert.message,
        '',
        'How to resolve:',
        'Review the alert and the current job state before taking an operator action.',
        '',
        `AI diagnostic unavailable: ${error}`
    ].join('\n');
}
