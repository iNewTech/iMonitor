import type { AlertKind } from '../alerts/alert-model';

export type ReplayOutcome = 'recovered' | 'still-blocked' | 'missing-evidence' | 'unsafe-blocked' | 'escalate';
export type ReplayResponse = 'acknowledge' | 'investigate' | 'replyMessage' | 'verifyRecovery' | 'escalate';

export interface ReplayScenario {
    schema: 'imonitor-replay-scenario';
    version: 1;
    id: string;
    title: string;
    kind: AlertKind;
    description: string;
    evidence: Array<{ source: string; status: 'captured' | 'missing' | 'stale'; summary: string }>;
    checks: Array<{ id: string; label: string; expected: string }>;
    permittedResponses: ReplayResponse[];
    expectedOutcome: ReplayOutcome;
    expectedSummary: string;
}

export interface ReplayCheckResult {
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'blocked';
    detail: string;
}

export interface ReplayResult {
    schema: 'imonitor-replay-result';
    version: 1;
    scenarioId: string;
    response: ReplayResponse;
    outcome: ReplayOutcome;
    checks: ReplayCheckResult[];
    evidence: ReplayScenario['evidence'];
    summary: string;
    trainingOnly: true;
    executedLiveAction: false;
}

const source = (status: 'captured' | 'missing' | 'stale', summary: string): ReplayScenario['evidence'][number] => ({ source: 'job evidence', status, summary });
const check = (id: string, label: string, expected: string): ReplayScenario['checks'][number] => ({ id, label, expected });

/** Ten deterministic scenarios used for operator training and regression review. */
export const REPLAY_SCENARIOS: ReplayScenario[] = [
    { id: 'msgw-recovered', title: 'MSGW reply recovers', kind: 'messageWait', description: 'A current inquiry is confirmed, the permitted reply is selected, and the next read is healthy.', evidence: [source('captured', 'Job is in MSGW; current inquiry and queue are present.')], checks: [check('message-current', 'Current message is verified', 'The inquiry key and queue match the latest evidence.'), check('recovery', 'Recovery is verified', 'The job leaves MSGW after the response.')], permittedResponses: ['acknowledge', 'investigate', 'replyMessage', 'verifyRecovery'], expectedOutcome: 'recovered', expectedSummary: 'The training reply is accepted and the follow-up read confirms recovery.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'msgw-still-blocked', title: 'MSGW remains blocked', kind: 'messageWait', description: 'The reply is accepted by the exercise, but the job remains in MSGW on verification.', evidence: [source('captured', 'Current inquiry is present and the reply context is fresh.')], checks: [check('message-current', 'Current message is verified', 'The inquiry key and queue are current.'), check('recovery', 'Recovery is verified', 'The job should leave MSGW.')], permittedResponses: ['acknowledge', 'investigate', 'replyMessage', 'verifyRecovery', 'escalate'], expectedOutcome: 'still-blocked', expectedSummary: 'The job remains blocked; pause and escalate instead of repeating the reply.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'msgw-missing-evidence', title: 'MSGW evidence is missing', kind: 'messageWait', description: 'The job status is known but the message source is unavailable.', evidence: [source('captured', 'Job status is available.'), { source: 'messages', status: 'missing', summary: 'Message records were unavailable.' }], checks: [check('message-current', 'Current message is verified', 'A current inquiry must be available before any reply.')], permittedResponses: ['acknowledge', 'investigate', 'escalate'], expectedOutcome: 'missing-evidence', expectedSummary: 'The exercise stops safely because a reply cannot be verified.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'msgw-stale-reply', title: 'Stale reply is blocked', kind: 'messageWait', description: 'The operator chooses a reply after the captured message identity has become stale.', evidence: [source('stale', 'The captured inquiry predates the current job read.')], checks: [check('message-current', 'Current message is verified', 'A stale inquiry must be rejected.')], permittedResponses: ['acknowledge', 'investigate', 'replyMessage', 'escalate'], expectedOutcome: 'unsafe-blocked', expectedSummary: 'The reply is blocked because its evidence is stale; no live action is attempted.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'lckw-recovered', title: 'Lock wait clears', kind: 'lockWait', description: 'Lock context is inspected and the next read shows the wait has cleared.', evidence: [source('captured', 'Waiting job, subsystem, and lock counts are available.')], checks: [check('lock-context', 'Lock context is inspected', 'The lock owner context is available.'), check('recovery', 'Recovery is verified', 'The job is no longer waiting on a lock.')], permittedResponses: ['acknowledge', 'investigate', 'verifyRecovery'], expectedOutcome: 'recovered', expectedSummary: 'The training verification confirms that the lock wait cleared.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'lckw-still-blocked', title: 'Lock wait persists', kind: 'lockWait', description: 'The lock owner remains active and the job is still waiting.', evidence: [source('captured', 'Lock owner and waiting job remain present.')], checks: [check('lock-context', 'Lock context is inspected', 'The lock owner is identified.'), check('recovery', 'Recovery is verified', 'The lock wait should be gone.')], permittedResponses: ['acknowledge', 'investigate', 'verifyRecovery', 'escalate'], expectedOutcome: 'still-blocked', expectedSummary: 'The lock wait remains; the exercise requires specialist review before disruption.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'cpu-recovered', title: 'High CPU recovers', kind: 'highCpu', description: 'CPU context is captured and a later observation is below the threshold.', evidence: [source('captured', 'CPU trend and recent log context are available.')], checks: [check('cpu-context', 'CPU context is captured', 'The current CPU and recent log are available.'), check('recovery', 'Recovery is verified', 'CPU is below the configured threshold.')], permittedResponses: ['acknowledge', 'investigate', 'verifyRecovery'], expectedOutcome: 'recovered', expectedSummary: 'The training observation confirms CPU recovery without ending the job.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'cpu-persists', title: 'High CPU persists', kind: 'highCpu', description: 'CPU remains above the threshold after the suggested checks.', evidence: [source('captured', 'CPU remains high; the job log is available.')], checks: [check('cpu-context', 'CPU context is captured', 'The current CPU and recent log are available.'), check('recovery', 'Recovery is verified', 'CPU should return below the threshold.')], permittedResponses: ['acknowledge', 'investigate', 'verifyRecovery', 'escalate'], expectedOutcome: 'escalate', expectedSummary: 'High CPU persists; the exercise escalates rather than performing a disruptive action.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'poll-recovered', title: 'Monitoring poll recovers', kind: 'pollFailure', description: 'A temporary poll failure is followed by a healthy monitoring check.', evidence: [source('captured', 'The next monitoring poll is healthy.')], checks: [check('poll', 'Monitoring is verified', 'A fresh poll returns successfully.')], permittedResponses: ['acknowledge', 'investigate', 'verifyRecovery'], expectedOutcome: 'recovered', expectedSummary: 'Monitoring recovered; no job action is required.', schema: 'imonitor-replay-scenario', version: 1 },
    { id: 'disconnect-missing', title: 'Disconnected evidence needs escalation', kind: 'pollFailure', description: 'The connection remains unavailable and no current workload evidence exists.', evidence: [source('missing', 'The monitoring connection is unavailable.')], checks: [check('poll', 'Monitoring is verified', 'A fresh poll must be available before workload conclusions.')], permittedResponses: ['acknowledge', 'investigate', 'escalate'], expectedOutcome: 'missing-evidence', expectedSummary: 'The exercise escalates the missing monitoring evidence without touching production work.', schema: 'imonitor-replay-scenario', version: 1 }
];

/** Runs a scenario entirely in memory and makes the training boundary explicit. */
export function runReplay(scenario: ReplayScenario, response: ReplayResponse): ReplayResult {
    const allowed = scenario.permittedResponses.includes(response);
    const hasMissingEvidence = scenario.evidence.some((item) => item.status !== 'captured');
    const unsafe = response === 'replyMessage' && scenario.id === 'msgw-stale-reply';
    const outcome: ReplayOutcome = !allowed || unsafe
        ? 'unsafe-blocked'
        : hasMissingEvidence && scenario.expectedOutcome === 'missing-evidence'
            ? 'missing-evidence'
            : scenario.expectedOutcome;
    const checks = scenario.checks.map((item, index) => ({
        id: item.id,
        label: item.label,
        status: outcome === 'unsafe-blocked' || outcome === 'missing-evidence' && index > 0 ? 'blocked' as const : outcome === 'recovered' || index === 0 ? 'passed' as const : 'failed' as const,
        detail: outcome === 'unsafe-blocked' ? 'Blocked by the training safety boundary.' : item.expected
    }));
    return {
        schema: 'imonitor-replay-result',
        version: 1,
        scenarioId: scenario.id,
        response,
        outcome,
        checks,
        evidence: scenario.evidence,
        summary: outcome === 'unsafe-blocked' ? 'Training blocked the unsafe response. No live action was executed.' : scenario.expectedSummary,
        trainingOnly: true,
        executedLiveAction: false
    };
}

export function getReplayScenario(id: string) {
    return REPLAY_SCENARIOS.find((scenario) => scenario.id === id);
}

export function sanitizeReplaySelection(value: unknown): ReplayResponse {
    return ['acknowledge', 'investigate', 'replyMessage', 'verifyRecovery', 'escalate'].includes(String(value))
        ? value as ReplayResponse
        : 'investigate';
}
