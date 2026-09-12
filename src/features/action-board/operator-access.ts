export type ProtectedAction = 'incident-workflow' | 'job-action' | 'queue-action';

export interface OperatorAccessSession {
    sessionId: string;
    operatorId: string;
    displayName: string;
    organizationId: string;
    allowedSystemIds: string[];
    allowedActions: ProtectedAction[];
    expiresAt?: string;
}

export interface AuthorizationResult {
    allowed: boolean;
    reason?: string;
}

interface LocalSessionOptions {
    organizationId?: string;
    now?: string;
    allowedSystemIds?: string[];
    allowedActions?: ProtectedAction[];
    expiresAt?: string;
}

const ALL_ACTIONS: ProtectedAction[] = ['incident-workflow', 'job-action', 'queue-action'];

/** Creates the main-process session used until delegated identity is added. */
export function createLocalOperatorSession(operatorId: string, options: LocalSessionOptions = {}): OperatorAccessSession {
    const normalizedOperatorId = operatorId.trim() || 'local-operator';
    const organizationId = options.organizationId?.trim() || 'local';
    const createdAt = options.now || new Date().toISOString();
    return {
        sessionId: `local:${organizationId}:${normalizedOperatorId}:${createdAt}`,
        operatorId: normalizedOperatorId,
        displayName: normalizedOperatorId,
        organizationId,
        allowedSystemIds: options.allowedSystemIds?.length ? options.allowedSystemIds.slice() : ['*'],
        allowedActions: options.allowedActions?.length ? options.allowedActions.slice() : ALL_ACTIONS.slice(),
        expiresAt: options.expiresAt
    };
}

/** Enforces identity, expiry, customer/system scope, and action permission at the IPC boundary. */
export function authorizeOperatorAction(
    session: OperatorAccessSession | null | undefined,
    action: ProtectedAction,
    systemId: string | undefined,
    now = new Date().toISOString()
): AuthorizationResult {
    if (!session?.operatorId.trim()) {
        return { allowed: false, reason: 'An authenticated operator session is required.' };
    }
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) {
        return { allowed: false, reason: 'The operator session timestamp is invalid.' };
    }
    if (session.expiresAt) {
        const expiresAtMs = Date.parse(session.expiresAt);
        if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) {
            return { allowed: false, reason: 'The operator session has expired.' };
        }
    }
    if (!systemId?.trim()) {
        return { allowed: false, reason: 'An active IBM i system is required.' };
    }
    if (!session.allowedActions.includes(action)) {
        return { allowed: false, reason: `The operator is not allowed to perform ${action}.` };
    }
    if (!session.allowedSystemIds.includes('*') && !session.allowedSystemIds.includes(systemId.trim())) {
        return { allowed: false, reason: 'The operator is not allowed to access this IBM i system.' };
    }
    return { allowed: true };
}
