export interface SupportMailtoOptions {
    supportEmail: string;
    subject: string;
    body: string;
}

export interface SupportContactBodyOptions {
    appName: string;
    appVersion: string;
}

export interface SupportDiagnosticsBodyOptions extends SupportContactBodyOptions {
    diagnosticsPath: string;
}

/**
 * Builds a safe mailto URL for opening the default mail application.
 */
export function buildSupportMailtoUrl(options: SupportMailtoOptions) {
    const recipient = encodeURIComponent(options.supportEmail.trim());
    const subject = encodeURIComponent(options.subject.trim());
    const body = encodeURIComponent(options.body.trim());

    return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

/**
 * Builds the default support-contact message body.
 */
export function buildSupportContactBody(options: SupportContactBodyOptions) {
    return [
        `Hello,`,
        '',
        `I need help with ${options.appName} v${options.appVersion}.`,
        '',
        'Issue summary:',
        '',
        'What I expected:',
        '',
        'What happened instead:',
        ''
    ].join('\n');
}

/**
 * Builds the support-contact message body for diagnostics sharing.
 */
export function buildSupportDiagnosticsBody(options: SupportDiagnosticsBodyOptions) {
    return [
        `Hello,`,
        '',
        `I am sending diagnostics from ${options.appName} v${options.appVersion}.`,
        '',
        `Diagnostics file: ${options.diagnosticsPath}`,
        '',
        'If the file is not attached automatically, please attach the diagnostics file from the path above.',
        '',
        'Issue summary:',
        ''
    ].join('\n');
}

/**
 * Builds a stable support diagnostics file name.
 */
export function buildSupportDiagnosticsFileName(appName: string, timestamp: string) {
    const safeAppSegment = appName
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'imonitor';
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');

    return `${safeAppSegment}-support-${safeTimestamp}.txt`;
}
