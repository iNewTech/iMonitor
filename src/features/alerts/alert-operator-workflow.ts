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
            createTimelineEntry('created', timestamp, 'Alert created', detail)
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
        status: state.status ?? 'new',
        owner: state.owner?.trim() || undefined,
        notes: Array.isArray(state.notes) ? state.notes.slice(-20) : [],
        timeline: Array.isArray(state.timeline) && state.timeline.length
            ? state.timeline.slice(-30)
            : createAlertWorkflowState(timestamp).timeline,
        updatedAt: state.updatedAt ?? timestamp,
        lastActionSummary: state.lastActionSummary
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
        lastActionSummary: workflowState.lastActionSummary
    };
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
 * Marks an alert reopened when a previously resolved or cleared condition recurs.
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
    }, 'reopened', timestamp, 'Condition returned', detail);
}

/**
 * Marks an alert acknowledged by the local operator.
 */
export function acknowledgeAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'acknowledged',
        label: 'Acknowledged',
        status: 'acknowledged',
        defaultSummary: 'Acknowledged'
    });
}

/**
 * Marks an alert as actively being worked.
 */
export function startAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'started',
        label: 'Work started',
        status: 'in_progress',
        defaultSummary: 'In progress'
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

    const nextState = appendWorkflowEntry({
        ...state,
        owner: mutation.owner?.trim() || state.owner,
        notes: [
            ...state.notes,
            createNote(mutation.timestamp, noteText)
        ].slice(-20),
        updatedAt: mutation.timestamp,
        lastActionSummary: 'Note added'
    }, 'note_added', mutation.timestamp, 'Note added', noteText);

    return nextState;
}

/**
 * Marks an alert resolved by the operator or by the system condition clearing.
 */
export function resolveAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'resolved',
        label: 'Resolved',
        status: 'resolved',
        defaultSummary: 'Resolved'
    });
}

/**
 * Marks an alert cleared from the operator queue.
 */
export function clearAlertWorkflow(
    state: StoredAlertWorkflowState,
    mutation: AlertWorkflowMutation
): StoredAlertWorkflowState {
    return mutateWorkflowState(state, {
        ...mutation,
        action: 'cleared',
        label: 'Cleared',
        status: 'cleared',
        defaultSummary: 'Cleared'
    });
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
    const detailParts = [
        mutation.owner?.trim() ? `owner: ${mutation.owner.trim()}` : '',
        mutation.note?.trim() ? `note: ${mutation.note.trim()}` : '',
        mutation.detail?.trim() ? mutation.detail.trim() : ''
    ].filter(Boolean);

    return appendWorkflowEntry({
        ...state,
        status: mutation.status,
        owner: mutation.owner?.trim() || state.owner,
        updatedAt: mutation.timestamp,
        lastActionSummary: mutation.defaultSummary
    }, mutation.action, mutation.timestamp, mutation.label, detailParts.join(' | ') || undefined);
}

function appendWorkflowEntry(
    state: StoredAlertWorkflowState,
    action: AlertWorkflowAction,
    timestamp: string,
    label: string,
    detail?: string
) {
    return {
        ...state,
        timeline: [
            createTimelineEntry(action, timestamp, label, detail),
            ...state.timeline
        ].slice(0, 30)
    };
}

function createNote(timestamp: string, text: string): AlertNote {
    return {
        id: `note-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        text
    };
}

function createTimelineEntry(
    action: AlertWorkflowAction,
    timestamp: string,
    label: string,
    detail?: string
): AlertTimelineEntry {
    return {
        id: `${action}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        action,
        label,
        detail
    };
}
