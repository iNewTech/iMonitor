import type { MonitorAlert } from '../alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { JobStatusHistoryEntry } from '../monitoring/monitoring-model';
import type { ResolutionMemoryEntry } from '../action-board/resolution-memory';
import { buildWaitReason, describeStatus } from '../monitoring/monitoring-model';

const EVIDENCE_SOURCES = ['trigger', 'job', 'jobLog', 'messages', 'queue', 'subsystem'] as const;
const SECRET_VALUE = /(password|passphrase|secret|token|api[_-]?key|credential|authorization)\s*[:=]\s*[^\s,;]+/gi;
const INSTRUCTION_LIKE_TEXT = /\b(?:ignore|disregard|forget|override)\b.{0,100}\b(?:instruction|system message|prompt|rule)s?\b/gi;
const MAX_TEXT = 480;

export interface GroundedGuidanceSections {
    observedFacts: string[];
    evidenceReferences: string[];
    interpretations: string[];
    missingEvidence: string[];
    suggestedChecks: string[];
    approvedProcedures: string[];
}

export interface GroundedGuidanceInput {
    job: ActiveJobRecord;
    alert?: MonitorAlert | null;
    selectedJobHistory?: JobStatusHistoryEntry[];
    activityLog?: Array<{ timestamp: string; level: string; message: string; detail?: string; sql?: string }>;
    approvedResolutions?: ResolutionMemoryEntry[];
}

/** Builds the evidence/fact boundary used by selected-job AI helpers. */
export function buildGroundedGuidanceSections(input: GroundedGuidanceInput): GroundedGuidanceSections {
    const jobName = String(input.job.JOB_NAME || input.job.SUBSYSTEM_JOB || 'selected job').trim();
    const alert = input.alert;
    const evidence = alert?.evidence;
    const observedFacts = [
        `[job] ${safe(jobName)} status=${safe(input.job.STATUS || 'UNKNOWN')} cpu=${safe(input.job.CPU ?? 'UNKNOWN')} wait=${safe(buildWaitReason(input.job))}`,
        `[job] Selected job status: ${safe(describeStatus(input.job.STATUS))}`,
        `[job] user=${safe(input.job.CURRENT_USER || input.job.JOB_USER || 'UNKNOWN')} subsystem=${safe(input.job.SUBSYSTEM || 'UNKNOWN')} subsystemJob=${safe(input.job.SUBSYSTEM_JOB || 'UNKNOWN')} function=${safe(input.job.FUNCTION_NAME || 'UNKNOWN')}`
    ];

    if (alert) {
        observedFacts.push(`[incident:${safe(alert.id)}] ${safe(alert.title)} :: ${safe(alert.message)}${alert.detail ? ` :: ${safe(alert.detail)}` : ''}`);
    } else {
        observedFacts.push('[incident] No linked incident was found for the selected job.');
    }

    const evidenceReferences = EVIDENCE_SOURCES.map((source) => {
        const snapshot = evidence?.[source];
        if (!snapshot) return `[evidence:${source}] unavailable; no captured snapshot.`;
        const reference = `[evidence:${source}] status=${snapshot.status} records=${snapshot.recordCount} collectedAt=${safe(snapshot.collectedAt)}`;
        const records = snapshot.status === 'captured'
            ? snapshot.records.slice(0, 2).map((record) => safeJson(record)).filter(Boolean)
            : [];
        return records.length ? `${reference} excerpts=${records.join(' | ')}` : reference;
    });

    const missingEvidence = EVIDENCE_SOURCES
        .filter((source) => evidence?.[source]?.status !== 'captured')
        .map((source) => {
            const snapshot = evidence?.[source];
            return `[evidence:${source}] ${snapshot?.detail ? safe(snapshot.detail) : 'Evidence is missing or unavailable.'}`;
        });
    if (!evidence) missingEvidence.unshift('[evidence] Incident evidence has not been captured yet.');

    const history = (input.selectedJobHistory || []).slice(-4).map((entry) => (
        `[history:${safe(entry.timestamp)}] status=${safe(entry.status)} label=${safe(entry.label)}`
    ));
    if (history.length) observedFacts.push(...history);

    const activity = (input.activityLog || []).slice(0, 4).map((entry) => (
        `[operator:${safe(entry.timestamp)}] ${safe(entry.message)}${entry.detail ? ` :: ${safe(entry.detail)}` : ''}${entry.sql ? ` :: SQL=${safe(entry.sql)}` : ''}`
    ));
    if (activity.length) observedFacts.push(...activity);

    const approvedProcedures = (input.approvedResolutions || []).map((entry) => (
        `[runbook:${safe(entry.id)}:v${entry.version}] ${safe(entry.title)} | scope=${safe(entry.systemId)} | incident=${safe(entry.incidentKind)} | job=${safe(entry.jobPattern || '*')} | action=${safe(entry.successfulAction || 'Not recorded')} | outcome=${safe(entry.verifiedOutcome || 'Not recorded')} | reviewDue=${safe(entry.reviewDueAt || 'Not set')}`
    ));
    if (!approvedProcedures.length) approvedProcedures.push('None. Do not invent or imply an approved procedure.');

    return {
        observedFacts,
        evidenceReferences,
        interpretations: [interpretationFor(alert)],
        missingEvidence: missingEvidence.length ? missingEvidence : ['No missing evidence was reported by the collector.'],
        suggestedChecks: suggestedChecksFor(alert),
        approvedProcedures
    };
}

export interface GroundedReplyValidation {
    reply: string;
    valid: boolean;
    missingSections: string[];
    missingCitations: string[];
    redacted: boolean;
}

export const JOB_REPLY_SECTIONS = [
    'Observed facts',
    'Matching evidence',
    'Interpretation',
    'Missing evidence',
    'Suggested checks',
    'Approved procedure',
    'Next safe action'
] as const;

/** Bounds and checks provider output before it reaches the task renderer. */
export function validateGroundedReply(
    reply: string,
    required = true,
    requiredSections: readonly string[] = ['Observed facts', 'Interpretation', 'Missing evidence', 'Suggested checks'],
    requiredCitations: readonly string[] = []
): GroundedReplyValidation {
    const original = String(reply || '');
    const cleaned = redactPromptSecrets(original).slice(0, 12000);
    const missingSections = required
        ? requiredSections.filter((name) => !hasHeading(cleaned, name))
        : [];
    const missingCitations = required && requiredCitations.length && !requiredCitations.some((id) => cleaned.includes(`[${id}]`))
        ? ['Matching evidence citations']
        : [];
    return {
        reply: cleaned,
        valid: missingSections.length === 0 && missingCitations.length === 0,
        missingSections,
        missingCitations,
        redacted: cleaned !== original
    };
}

function hasHeading(value: string, name: string) {
    const heading = name === 'Approved procedure' ? 'Approved procedures?' : name;
    return new RegExp(`^\\s*(?:#+\\s*)?${heading}\\b`, 'im').test(value);
}

function interpretationFor(alert?: MonitorAlert | null) {
    switch (alert?.kind) {
        case 'highCpu': return 'High CPU is observed; the cause and business impact are unconfirmed.';
        case 'messageWait': return 'A message wait is observed; the correct reply and business impact are unconfirmed.';
        case 'lockWait': return 'A lock wait is observed; the blocking owner and root cause are unconfirmed.';
        case 'delayWait': return 'A delay wait is observed; the reason for the delay is unconfirmed.';
        case 'dequeueWait': return 'A dequeue wait is observed; the pending queue operation and cause are unconfirmed.';
        case 'pollFailure': return 'A monitoring poll failure is observed; current job state may be incomplete.';
        default: return 'An incident signal is observed; its cause and business impact are unconfirmed.';
    }
}

function suggestedChecksFor(alert?: MonitorAlert | null) {
    const check = alert?.kind === 'messageWait'
        ? 'Inspect the captured message before replying.'
        : alert?.kind === 'lockWait'
            ? 'Inspect lock-owner evidence before changing the job.'
            : alert?.kind === 'highCpu'
                ? 'Compare current CPU with recent job history and inspect the captured job context.'
                : 'Refresh the selected job evidence and confirm the current condition before acting.';
    return [`[check:1] ${check}`, '[check:2] Use the matching approved runbook if one is listed; otherwise escalate uncertain or high-risk work.'];
}

function safe(value: unknown) {
    return redactPromptSecrets(String(value ?? ''))
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(INSTRUCTION_LIKE_TEXT, '[instruction-like evidence removed]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT);
}

function safeJson(value: unknown) {
    try {
        return safe(JSON.stringify(value));
    } catch {
        return '[unreadable evidence]';
    }
}

function redactPromptSecrets(value: string) {
    return value.replace(SECRET_VALUE, '$1=[REDACTED]');
}
