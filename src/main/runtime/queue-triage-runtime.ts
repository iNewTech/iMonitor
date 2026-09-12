import type { JobQueueRecord, PagedResult, QueuedJobRecord } from '../../services/ibmi';
import type { JobQueueQuery, QueuedJobQuery } from '../../features/action-board/job-queue-model';
import {
    completeQueueTriage,
    createQueueTriageResult,
    normalizeQueueTriageResults,
    queueEvidenceSignature,
    queueKey,
    recordQueueTriageCheck,
    type QueueTriageCheck,
    type QueueTriageResult
} from '../../features/action-board/queue-triage';

interface QueueTriageRuntimeDependencies {
    initialResults: Record<string, QueueTriageResult>;
    getJobQueues: (options: JobQueueQuery) => Promise<PagedResult<JobQueueRecord>>;
    getQueuedJobs: (options: QueuedJobQuery) => Promise<PagedResult<QueuedJobRecord>>;
    getJobQueueDetails: (queueName: string, queueLibrary: string) => Promise<{
        queue: Record<string, unknown> | null;
        subsystem: Record<string, unknown> | null;
    }>;
    persistResults: (results: Record<string, QueueTriageResult>) => void;
    sendToWindow: (channel: string, payload: unknown) => void;
    recordActivity: (entry: {
        area: 'monitoring';
        level: 'info' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
}

const TRIAGE_LIMIT = 100;

function check(
    id: QueueTriageCheck['id'],
    status: QueueTriageCheck['status'],
    summary: string,
    recordCount: number,
    observedAt: string
): QueueTriageCheck {
    return { id, label: id === 'queue-state' ? 'Queue state' : id === 'waiting-jobs' ? 'Waiting work' : 'Subsystem context', status, summary, recordCount, observedAt };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function createQueueTriageRuntime(dependencies: QueueTriageRuntimeDependencies) {
    const results = new Map(Object.entries(normalizeQueueTriageResults(dependencies.initialResults)));
    let activeRun: Promise<void> | null = null;

    const snapshot = () => Object.fromEntries(results.entries());
    const emit = () => {
        const current = snapshot();
        dependencies.persistResults(current);
        dependencies.sendToWindow('job-queue-triage-updated', Object.values(current));
    };

    const runQueue = async (queue: JobQueueRecord) => {
        const key = queueKey(queue);
        const timestamp = new Date().toISOString();
        const existing = results.get(key);
        const sameEvidence = existing?.evidenceSignature === queueEvidenceSignature(queue);
        if (sameEvidence && (existing?.status === 'completed' || existing?.status === 'partial')) {
            return;
        }

        let result = sameEvidence && existing?.status === 'interrupted'
            ? { ...existing, status: 'running' as const, updatedAt: timestamp }
            : createQueueTriageResult(queue, timestamp);
        results.set(key, result);
        emit();

        try {
            if (result.nextCheck === 'queue-state') {
                const isHeld = queue.JOB_QUEUE_STATUS.toUpperCase() === 'HELD';
                result = recordQueueTriageCheck(result, check(
                    'queue-state',
                    isHeld ? 'passed' : 'blocked',
                    isHeld ? 'Queue is held and needs operator review.' : `Queue is ${queue.JOB_QUEUE_STATUS}; no held-queue correction is proposed.`,
                    1,
                    timestamp
                ), timestamp);
                results.set(key, result);
                emit();
                if (!isHeld) {
                    results.set(key, completeQueueTriage(result, 'clear', timestamp, {
                        expectedOutcome: 'Queue is not held; no read-only held-queue action is required.',
                        stopReason: 'The queue state changed before triage completed.',
                        proposedNextSteps: ['Continue monitoring the queue.']
                    }));
                    emit();
                    return;
                }
            }

            if (result.nextCheck === 'waiting-jobs') {
                const page = await dependencies.getQueuedJobs({
                    queueName: queue.JOB_QUEUE_NAME,
                    queueLibrary: queue.JOB_QUEUE_LIBRARY,
                    limit: TRIAGE_LIMIT,
                    status: 'ALL'
                });
                const waitingJobs = Array.isArray(page.data) ? page.data : [];
                result = recordQueueTriageCheck(result, check(
                    'waiting-jobs',
                    'passed',
                    waitingJobs.length ? `${waitingJobs.length} waiting job${waitingJobs.length === 1 ? '' : 's'} found.` : 'No waiting jobs were returned.',
                    waitingJobs.length,
                    new Date().toISOString()
                ), new Date().toISOString());
                result = { ...result, waitingJobs: waitingJobs.length };
                results.set(key, result);
                emit();
            }

            if (result.nextCheck === 'subsystem') {
                const detail = await dependencies.getJobQueueDetails(queue.JOB_QUEUE_NAME, queue.JOB_QUEUE_LIBRARY);
                const hasSubsystem = Boolean(detail.subsystem);
                result = recordQueueTriageCheck(result, check(
                    'subsystem',
                    hasSubsystem ? 'passed' : 'unavailable',
                    hasSubsystem ? 'Associated subsystem context is available.' : 'Associated subsystem context is unavailable.',
                    hasSubsystem ? 1 : 0,
                    new Date().toISOString()
                ), new Date().toISOString());
                results.set(key, completeQueueTriage(result, hasSubsystem ? 'completed' : 'partial', new Date().toISOString(), {
                    expectedOutcome: hasSubsystem
                        ? `${result.waitingJobs} waiting job${result.waitingJobs === 1 ? '' : 's'} and subsystem context are ready for review.`
                        : 'Queue evidence is available, but subsystem context needs operator review.',
                    stopReason: hasSubsystem
                        ? 'Read-only triage completed before any queue or job mutation.'
                        : 'Triage stopped because associated subsystem context could not be read.',
                    proposedNextSteps: hasSubsystem
                        ? ['Review the oldest waiting job and priority.', 'Confirm the hold is expected with the service owner.', 'Use an authorised action only after review, then verify progress.']
                        : ['Verify the subsystem name and library.', 'Escalate to an operator with IBM i subsystem access.']
                }));
                emit();
            }
        } catch (error) {
            const message = errorMessage(error);
            results.set(key, completeQueueTriage(result, 'failed', new Date().toISOString(), {
                expectedOutcome: 'A bounded read-only check failed and requires review.',
                stopReason: `Triage stopped safely: ${message}`,
                proposedNextSteps: ['Review the failed check and current IBM i evidence.', 'Escalate if the read-only context remains unavailable.']
            }));
            dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Read-only queue triage stopped safely.', detail: `${key} | ${message}` });
            emit();
        }
    };

    const runForHeldQueues = async () => {
        if (activeRun) return activeRun;
        activeRun = (async () => {
            try {
                const page = await dependencies.getJobQueues({ status: 'HELD', limit: TRIAGE_LIMIT });
                const queues = Array.isArray(page.data) ? page.data : [];
                const heldKeys = new Set(queues.map(queueKey));
                for (const [key, result] of results.entries()) {
                    if (!heldKeys.has(key) && result.status !== 'clear') {
                        results.set(key, completeQueueTriage(result, 'clear', new Date().toISOString(), {
                            expectedOutcome: 'Queue is no longer held; no correction is proposed.',
                            stopReason: 'The latest read-only queue scan found no held state.',
                            proposedNextSteps: ['Continue monitoring the queue.']
                        }));
                    }
                }
                emit();
                for (const queue of queues) await runQueue(queue);
            } catch (error) {
                dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Read-only queue triage could not start.', detail: errorMessage(error) });
            }
        })().finally(() => { activeRun = null; });
        return activeRun;
    };

    return { getResults: () => Object.values(snapshot()), runForHeldQueues };
}
