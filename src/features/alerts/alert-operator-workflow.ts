import type {
    AlertNote,
    AlertTimelineEntry,
    AlertWorkflowAction,
    AlertWorkflowStatus,
    MonitorAlert,
    StoredAlertWorkflowState
} from './alert-model';

/**
 * Shared action payload used when mutating operator alert workflow.
 */
export interface AlertWorkflowMutation {
    owner?: string;
    note?: string;
    detail?: string;
    timestamp: string;
}

/**
 * Creates the default workflow state for a brand-new alert.
 */
export function createAlertWorkflowState(timestamp: string, detail?: string): StoredAlertWorkflowState {
    return {
        status: 'new',
        notes: [],
        timeline: [
            createTimelineEntry('created', timestamp, 'Alert created', undefined, detail)
        ],
        updatedAt: timestamp,
        lastActionSummary: 'New alert'
    };
}

/**
 * Normalizes a stored workflow state so renderer and main process receive a stable shape.
 */
export function normalizeAlertWorkflowState(
    state: StoredAlertWorkflowState | undefined,
    timestamp: string
): StoredAlertWorkflowState {
    if (!state) {
        return createAlertWorkflowState(timestamp);
    }

    return {
        status: normalizeWorkflowStatus(state.status),
        owner: state.owner?.trim() || undefined,
        notes: Array.isArray(state.notes)
            ? state.notes.slice(-20).map((note) => ({
                ...note,
                author: note.author?.trim() || undefined
            }))
            : [],
        timeline: Array.isArray(state.timeline) && state.timeline.length
            ? state.timeline.slice(0, 30).map((entry) => ({
                ...entry,
                action: normalizeWorkflowAction(entry.action),
                actor: entry.actor?.trim() || undefined
            }))
            : createAlertWorkflowState(timestamp).timeline,
        updatedAt: state.updatedAt ?? timestamp,
        lastActionSummary: state.lastActionSummary,
        clickUpTask: state.clickUpTask
    };
}

/**
 * Applies the persisted workflow state onto the latest live alert snapshot.
 */
export function applyWorkflowStateToAlert(
    alert: Omit<MonitorAlert, 'workflowStatus' | 'owner' | 'notes' | 'timeline' | 'workflowUpdatedAt' | 'lastActionSummary'>,
    workflowState: StoredAlertWorkflowState
): MonitorAlert {
    return {
        ...alert,
        workflowStatus: workflowState.status,
        owner: workflowState.owner,
        notes: workflowState.notes,
        timeline: workflowState.timeline,
        workflowUpdatedAt: workflowState.updatedAt,
        lastActionSummary: workflowState.lastActionSummary,
        clickUpTask: workflowState.clickUpTask
    };
}

/**
 * Attaches the linked ClickUp task for future syncs and deep-linking.
 */
export function attachClickUpTaskToWorkflow(
    state: StoredAlertWorkflowState,
    task: StoredAlertWorkflowState['clickUpTask'],
    timestamp: string
): StoredAlertWorkflowState {
    if (!task?.id) {
        return state;
    }

    return appendWorkflowEntry({
        ...state,
        clickUpTask: task,
        updatedAt: timestamp,
        lastActionSummary: 'ClickUp task linked'
    }, 'condition_seen', timestamp, 'ClickUp task linked', undefined, `${task.name || task.id}${task.url ? ` | ${task.url}` : ''}`);
}

/**
 * Records that the current poll still sees this condition.
 */
export function markAlertConditionSeen(
    state: StoredAlertWorkflowState,
    timestamp: string
): StoredAlertWorkflowState {
    return {
        ...state,
        updatedAt: timestamp
    };
}

/**
 * Marks an alert reopened when a previously cleared condition recurs.
 */
export function reopenAlertWorkflow(
    state: StoredAlertWorkflowState | undefined,
    timestamp: string,
    detail?: string
): StoredAlertWorkflowState {
    const current = normalizeAlertWorkflowState(state, timestamp);

    return appendWorkflowEntry({
        ...current,
        status: 'new',
        updatedAt: timestamp,
        lastActionSummary: 'Condition returned'
    }, 'reopened', timestamp, 'Condition returned', undefined, detail);
}

/**
 * Marks an alert acknowledged by the local operator.
 */
export function acknowledgeAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    const actor = mutation.owner?.trim() || undefined;

    return appendWorkflowEntry({
        ...state,
        status: 'acknowledged',
        owner: actor || state.owner,
        updatedAt: mutation.timestamp,
        lastActionSummary: 'Acknowledged'
    }, 'acknowledged', mutation.timestamp, 'Acknowledged', actor, actor ? `operator: ${actor}` : undefined);
}

/**
 * Claims an alert for one local operator.
 */
export function claimAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'claimed',
        label: 'Work claimed',
        status: 'claimed',
        defaultSummary: 'Claimed for work'
    });
}

/**
 * Releases an active work claim and returns the alert to the queue.
 */
export function releaseAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    const nextStatus = state.status === 'new' ? 'new' : 'acknowledged';

    return mutateWorkflowState({
        ...state,
        owner: undefined
    }, {
        ...mutation,
        owner: undefined,
        action: 'released',
        label: 'Returned to queue',
        status: nextStatus,
        defaultSummary: 'Returned to queue'
    });
}

/**
 * Adds a free-form operator note without changing the workflow state.
 */
export function addAlertWorkflowNote(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    const noteText = mutation.note?.trim();
    if (!noteText) {
        return state;
    }

    return appendWorkflowEntry({
        ...state,
        owner: mutation.owner?.trim() || state.owner,
        notes: [
            ...state.notes,
            createNote(mutation.timestamp, mutation.owner, noteText)
        ].slice(-20),
        updatedAt: mutation.timestamp,
        lastActionSummary: 'Note added'
    }, 'note_added', mutation.timestamp, 'Note added', mutation.owner, noteText);
}

/**
 * Marks operator work as complete while keeping the incident tracked until the system clears it.
 */
export function markAlertWorkDone(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'work_marked_done',
        label: 'Work marked done',
        status: 'work_done',
        defaultSummary: 'Work marked done'
    });
}

/**
 * Marks an alert as cleared by a later system poll instead of a manual clear button.
 */
export function systemClearAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        owner: state.owner,
        action: 'system_cleared',
        label: 'System cleared',
        status: 'system_cleared',
        defaultSummary: 'System cleared'
    });
}

/** Records the result of an operator-requested fresh condition check. */
export function recordAlertRecheckWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation & { cleared: boolean }
): StoredAlertWorkflowState {
    const actor = mutation.owner?.trim() || undefined;
    const label = mutation.cleared
        ? 'Manual recheck confirmed clear'
        : 'Manual recheck confirmed active';

    return appendWorkflowEntry({
        ...state,
        updatedAt: mutation.timestamp,
        lastActionSummary: label
    }, 'rechecked', mutation.timestamp, label, actor, mutation.detail);
}

function normalizeWorkflowStatus(status: string | undefined): AlertWorkflowStatus {
    switch (status) {
        case 'acknowledged':
            return 'acknowledged';
        case 'claimed':
        case 'in_progress':
            return 'claimed';
        case 'work_done':
            return 'work_done';
        case 'resolved':
        case 'cleared':
        case 'system_cleared':
            return 'system_cleared';
        case 'new':
        default:
            return 'new';
    }
}

function normalizeWorkflowAction(action: string | undefined): AlertWorkflowAction {
    switch (action) {
        case 'created':
        case 'condition_seen':
        case 'acknowledged':
        case 'note_added':
        case 'reopened':
        case 'rechecked':
            return action;
        case 'started':
        case 'claimed':
            return 'claimed';
        case 'released':
            return 'released';
        case 'resolved':
            return 'work_marked_done';
        case 'cleared':
        case 'system_cleared':
            return 'system_cleared';
        default:
            return 'condition_seen';
    }
}

function mutateWorkflowState(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation & {
        action: AlertWorkflowAction;
        label: string;
        status: AlertWorkflowStatus;
        defaultSummary: string;
    }
) {
    const actor = mutation.owner?.trim() || undefined;
    const detailParts = [
        actor ? `operator: ${actor}` : '',
        mutation.note?.trim() ? `note: ${mutation.note.trim()}` : '',
        mutation.detail?.trim() ? mutation.detail.trim() : ''
    ].filter(Boolean);

    return appendWorkflowEntry({
        ...state,
        status: mutation.status,
        owner: mutation.action === 'released' ? undefined : actor || state.owner,
        updatedAt: mutation.timestamp,
        lastActionSummary: mutation.defaultSummary
    }, mutation.action, mutation.timestamp, mutation.label, actor, detailParts.join(' | ') || undefined);
}

function appendWorkflowEntry(
    state: StoredAlertWorkflowState,
    action: AlertWorkflowAction,
    timestamp: string,
    label: string,
    actor?: string,
    detail?: string
) {
    return {
        ...state,
        timeline: [
            createTimelineEntry(action, timestamp, label, actor, detail),
            ...state.timeline
        ].slice(0, 30)
    };
}

function createNote(timestamp: string, author: string | undefined, text: string): AlertNote {
    return {
        id: `note-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        author: author?.trim() || undefined,
        text
    };
}

function createTimelineEntry(
    action: AlertWorkflowAction,
    timestamp: string,
    label: string,
    actor?: string,
    detail?: string
): AlertTimelineEntry {
    return {
        id: `${action}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        action,
        label,
        actor: actor?.trim() || undefined,
        detail
    };
}
