import { randomUUID } from 'node:crypto';
import {
    authorizeOperatorAction,
    createLocalOperatorSession,
    type AuthorizationResult,
    type OperatorAccessSession,
    type ProtectedAction
} from './operator-access';

export type SupportAccessPermission = 'read' | 'investigate' | 'execute';
export type SupportAccessStatus = 'pending' | 'active' | 'revoked' | 'expired';

export interface SupportAccessGrant {
    id: string;
    organizationId: string;
    operatorId: string;
    displayName: string;
    systemIds: string[];
    permissions: SupportAccessPermission[];
    createdBy: string;
    createdAt: string;
    expiresAt: string;
    status: SupportAccessStatus;
    acceptedAt?: string;
    revokedAt?: string;
}

export type SupportAccessGrants = Record<string, SupportAccessGrant>;

export interface SupportAccessGrantInput {
    organizationId: string;
    operatorId: string;
    displayName: string;
    systemIds: string[];
    permissions: SupportAccessPermission[];
    createdBy: string;
    expiresAt: string;
    now?: string;
    id?: string;
}

const PERMISSIONS: SupportAccessPermission[] = ['read', 'investigate', 'execute'];
const STATUSES: SupportAccessStatus[] = ['pending', 'active', 'revoked', 'expired'];

function clean(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function normalizedPermissions(values: unknown) {
    return uniqueStrings(values).filter((value): value is SupportAccessPermission => (
        PERMISSIONS.includes(value as SupportAccessPermission)
    ));
}

function validIso(value: string) {
    return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function ensureFutureExpiry(expiresAt: string, now: string) {
    return validIso(expiresAt) && validIso(now) && Date.parse(expiresAt) > Date.parse(now);
}

function generatedGrantId(operatorId: string, now: string) {
    const slug = operatorId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'support';
    return `grant:${slug}:${Date.parse(now)}:${randomUUID().slice(0, 8)}`;
}

/** Returns the actions represented by a support permission set. */
export function getActionsForSupportPermissions(permissions: SupportAccessPermission[]): ProtectedAction[] {
    const normalized = new Set(permissions);
    const actions: ProtectedAction[] = normalized.has('read') || normalized.has('investigate') || normalized.has('execute')
        ? ['read']
        : [];

    if (normalized.has('investigate') || normalized.has('execute')) {
        actions.push('incident-workflow', 'incident-handoff');
    }
    if (normalized.has('execute')) {
        actions.push('job-action', 'queue-action');
    }
    return actions;
}

/** Creates a pending grant without ever accepting or storing a password/token. */
export function createSupportAccessGrant(input: SupportAccessGrantInput): SupportAccessGrant {
    const now = input.now || new Date().toISOString();
    const organizationId = clean(input.organizationId);
    const operatorId = clean(input.operatorId);
    const displayName = clean(input.displayName) || operatorId;
    const systemIds = uniqueStrings(input.systemIds);
    const permissions = normalizedPermissions(input.permissions);

    if (!organizationId || !operatorId || !displayName || !systemIds.length) {
        throw new Error('A support user, customer, and at least one IBM i system are required.');
    }
    if (systemIds.includes('*')) {
        throw new Error('Support access must name specific IBM i systems.');
    }
    if (!permissions.length) {
        throw new Error('Choose at least one support permission.');
    }
    if (!ensureFutureExpiry(input.expiresAt, now)) {
        throw new Error('Support access expiry must be a valid future time.');
    }

    return {
        id: clean(input.id) || generatedGrantId(operatorId, now),
        organizationId,
        operatorId,
        displayName,
        systemIds,
        permissions,
        createdBy: clean(input.createdBy) || 'client-owner',
        createdAt: now,
        expiresAt: input.expiresAt,
        status: 'pending'
    };
}

/** Accepts a pending grant only when the authenticated identity exactly matches it. */
export function acceptSupportAccessGrant(
    grants: SupportAccessGrants,
    grantId: string,
    operatorId: string,
    now = new Date().toISOString()
): SupportAccessGrant {
    const grant = grants[clean(grantId)];
    if (!grant) throw new Error('Support access grant not found.');
    if (grant.operatorId !== clean(operatorId)) throw new Error('This support invitation belongs to another operator.');
    if (grant.status === 'revoked') throw new Error('This support access grant was revoked.');
    if (!ensureFutureExpiry(grant.expiresAt, now)) {
        const expired = { ...grant, status: 'expired' as const };
        grants[grant.id] = expired;
        throw new Error('This support access grant has expired.');
    }
    if (grant.status === 'active') return grant;

    const accepted = { ...grant, status: 'active' as const, acceptedAt: now };
    grants[grant.id] = accepted;
    return accepted;
}

/** Revokes a grant immediately for future reads and actions. */
export function revokeSupportAccessGrant(
    grants: SupportAccessGrants,
    grantId: string,
    actor: string,
    now = new Date().toISOString()
): SupportAccessGrant {
    const grant = grants[clean(grantId)];
    if (!grant) throw new Error('Support access grant not found.');
    const revoked = { ...grant, status: 'revoked' as const, revokedAt: now };
    grants[grant.id] = revoked;
    return revoked;
}

/** Returns grants with an accurate status for the current time without mutating storage. */
export function listSupportAccessGrants(grants: SupportAccessGrants, now = new Date().toISOString()) {
    return Object.values(grants).map((grant) => ({
        ...grant,
        status: grant.status === 'revoked'
            ? 'revoked' as const
            : ensureFutureExpiry(grant.expiresAt, now)
                ? grant.status
                : 'expired' as const
    }));
}

/** Finds a currently active grant for one operator and one customer system. */
export function getEffectiveSupportAccessGrant(
    grants: SupportAccessGrants,
    operatorId: string,
    systemId: string,
    now = new Date().toISOString()
) {
    return listSupportAccessGrants(grants, now).find((grant) => (
        grant.status === 'active'
        && grant.operatorId === clean(operatorId)
        && grant.systemIds.includes(clean(systemId))
    ));
}

/** Authorizes a delegated action from a fresh grant lookup at the IPC boundary. */
export function authorizeSupportAccess(
    grants: SupportAccessGrants,
    operatorId: string,
    action: ProtectedAction,
    systemId: string | undefined,
    now = new Date().toISOString()
): AuthorizationResult {
    const grant = systemId
        ? getEffectiveSupportAccessGrant(grants, operatorId, systemId, now)
        : undefined;
    if (!grant) {
        return { allowed: false, reason: 'The operator has no active grant for this IBM i system.' };
    }

    const session: OperatorAccessSession = createLocalOperatorSession(operatorId, {
        organizationId: grant.organizationId,
        allowedSystemIds: grant.systemIds,
        allowedActions: getActionsForSupportPermissions(grant.permissions),
        expiresAt: grant.expiresAt,
        now
    });
    return authorizeOperatorAction(session, action, systemId, now);
}

/** Drops malformed persisted grants and normalizes the remaining records. */
export function normalizeSupportAccessGrants(candidate: unknown): SupportAccessGrants {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const result: SupportAccessGrants = {};
    Object.entries(candidate as Record<string, unknown>).forEach(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const item = value as Record<string, unknown>;
        const id = clean(item.id) || clean(key);
        const grant = {
            id,
            organizationId: clean(item.organizationId),
            operatorId: clean(item.operatorId),
            displayName: clean(item.displayName),
            systemIds: uniqueStrings(item.systemIds).filter((systemId) => systemId !== '*'),
            permissions: normalizedPermissions(item.permissions),
            createdBy: clean(item.createdBy),
            createdAt: clean(item.createdAt),
            expiresAt: clean(item.expiresAt),
            status: STATUSES.includes(item.status as SupportAccessStatus) ? item.status as SupportAccessStatus : 'pending' as const,
            acceptedAt: clean(item.acceptedAt) || undefined,
            revokedAt: clean(item.revokedAt) || undefined
        };
        if (grant.id && grant.organizationId && grant.operatorId && grant.systemIds.length
            && grant.permissions.length && validIso(grant.createdAt) && validIso(grant.expiresAt)) {
            result[grant.id] = grant;
        }
    });
    return result;
}

/** True when the current local identity is the client owner for this desktop session. */
export function isClientOwner(currentOperatorId: string, ownerOperatorId: string) {
    return clean(currentOperatorId) !== '' && clean(currentOperatorId) === clean(ownerOperatorId);
}

/** Actor label kept in the audit trail for grant changes. */
export function supportAccessAuditDetail(grant: SupportAccessGrant, actor: string) {
    return `grant=${grant.id} | actor=${clean(actor) || 'unknown'} | operator=${grant.operatorId} | systems=${grant.systemIds.join(',')} | permissions=${grant.permissions.join(',')} | status=${grant.status}`;
}
