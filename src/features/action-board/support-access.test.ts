import { describe, expect, it } from 'vitest';
import {
    acceptSupportAccessGrant,
    authorizeSupportAccess,
    createSupportAccessGrant,
    getActionsForSupportPermissions,
    getEffectiveSupportAccessGrant,
    listSupportAccessGrants,
    normalizeSupportAccessGrants,
    revokeSupportAccessGrant
} from './support-access';

const now = '2026-09-12T10:00:00.000Z';
const expiry = '2026-09-13T10:00:00.000Z';

function makeGrant(operatorId = 'support-a', systemIds = ['customer-a/system-1']) {
    return createSupportAccessGrant({
        id: `grant-${operatorId}`,
        organizationId: 'customer-a',
        operatorId,
        displayName: 'Support A',
        systemIds,
        permissions: ['read', 'investigate'],
        createdBy: 'client-owner',
        expiresAt: expiry,
        now
    });
}

describe('support access grants', () => {
    it('requires an explicit system and future expiry', () => {
        expect(() => makeGrant('support-a', ['*'])).toThrow('specific IBM i systems');
        expect(() => createSupportAccessGrant({
            ...makeGrant(),
            expiresAt: now,
            now
        })).toThrow('future time');
    });

    it('maps permissions to least-privilege actions', () => {
        expect(getActionsForSupportPermissions(['read'])).toEqual(['read']);
        expect(getActionsForSupportPermissions(['investigate'])).toEqual(['read', 'incident-workflow', 'incident-handoff']);
        expect(getActionsForSupportPermissions(['execute'])).toEqual([
            'read', 'incident-workflow', 'incident-handoff', 'job-action', 'queue-action'
        ]);
    });

    it('accepts only the invited operator and blocks unaccepted access', () => {
        const grant = makeGrant();
        const grants = { [grant.id]: grant };
        expect(getEffectiveSupportAccessGrant(grants, 'support-a', grant.systemIds[0], now)).toBeUndefined();
        expect(() => acceptSupportAccessGrant(grants, grant.id, 'support-b', now)).toThrow('belongs to another operator');
        const accepted = acceptSupportAccessGrant(grants, grant.id, 'support-a', now);
        expect(accepted.status).toBe('active');
        expect(getEffectiveSupportAccessGrant(grants, 'support-a', grant.systemIds[0], now)?.id).toBe(grant.id);
    });

    it('blocks revoked, expired, and out-of-scope access', () => {
        const grant = makeGrant();
        const grants = { [grant.id]: grant };
        acceptSupportAccessGrant(grants, grant.id, 'support-a', now);
        expect(authorizeSupportAccess(grants, 'support-a', 'incident-workflow', grant.systemIds[0], now).allowed).toBe(true);
        expect(authorizeSupportAccess(grants, 'support-a', 'job-action', grant.systemIds[0], now).allowed).toBe(false);
        expect(authorizeSupportAccess(grants, 'support-a', 'read', 'customer-b/system-1', now).allowed).toBe(false);
        revokeSupportAccessGrant(grants, grant.id, 'client-owner', now);
        expect(authorizeSupportAccess(grants, 'support-a', 'read', grant.systemIds[0], now)).toMatchObject({ allowed: false });
        expect(listSupportAccessGrants(grants, '2026-09-14T10:00:00.000Z')[0].status).toBe('revoked');
    });

    it('normalizes malformed stored grants without crossing customer scope', () => {
        const grant = makeGrant();
        const normalized = normalizeSupportAccessGrants({
            [grant.id]: grant,
            bad: { operatorId: 'missing-required-fields', systemIds: ['*'] }
        });
        expect(Object.keys(normalized)).toEqual([grant.id]);
        expect(normalized[grant.id].organizationId).toBe('customer-a');
    });
});
