/**
 * Describes one operator action recorded by iMonitor ActionBoard.
 */
export interface ActionAuditEntry {
    timestamp: string;
    operator: string;
    jobName: string;
    action: string;
    result: 'success' | 'failure';
    detail?: string;
    incidentId?: string;
}

/**
 * Creates a normalized audit entry for an IBM i or incident action.
 */
export function createActionAuditEntry(input: Omit<ActionAuditEntry, 'timestamp'> & { timestamp?: string }): ActionAuditEntry {
    return {
        timestamp: input.timestamp || new Date().toISOString(),
        operator: input.operator.trim() || 'local-operator',
        jobName: input.jobName.trim(),
        action: input.action.trim(),
        result: input.result,
        detail: input.detail?.trim() || undefined,
        incidentId: input.incidentId?.trim() || undefined
    };
}

