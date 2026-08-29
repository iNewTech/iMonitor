function normalizeLabel(value, fallback) {
    const text = String(value ?? '').trim();
    return text || fallback;
}

export function buildIncidentSummaryPrompt() {
    return 'Summarize the current incident picture: what is wrong, how many jobs or alerts are affected, operator impact, and what should be checked first.';
}

export function buildShiftHandoffPrompt() {
    return 'Create a short shift handoff summary from the current alerts, active jobs, monitoring history, and recent operator log activity. Use sections for current issues, impact, actions taken, and next checks.';
}

export function buildSqlActivityPrompt() {
    return 'Look at the recent SQL activity and explain what stands out, what it may be doing, and whether the operator should worry.';
}

export function buildSelectedJobHealthPrompt(selectedJobName) {
    const jobName = normalizeLabel(selectedJobName, 'the selected job');
    return `Give a health summary for ${jobName}. Explain status, wait reason, SQL activity, risk level, and next best action.`;
}

export function buildAlertExplanationPrompt(alert) {
    const title = normalizeLabel(alert?.title, 'the selected alert');
    const jobName = normalizeLabel(alert?.jobName, 'no named job');
    const kind = normalizeLabel(alert?.kind, 'unknown alert type');
    const summary = normalizeLabel(alert?.message, 'No alert summary provided.');

    return `Explain this alert in plain operator language: ${title}. Alert type: ${kind}. Job: ${jobName}. Summary: ${summary}. Include likely cause, impact, and what the operator should verify first.`;
}

export function buildAlertNextActionsPrompt(alert) {
    const title = normalizeLabel(alert?.title, 'the selected alert');
    const jobName = normalizeLabel(alert?.jobName, 'no named job');
    const kind = normalizeLabel(alert?.kind, 'unknown alert type');
    const detail = normalizeLabel(alert?.detail, normalizeLabel(alert?.message, 'No alert detail provided.'));

    return `For ${title} on ${jobName} (${kind}), give the next best operator actions. Keep it practical and ordered, and mention any quick verification step before acting. Context: ${detail}`;
}
