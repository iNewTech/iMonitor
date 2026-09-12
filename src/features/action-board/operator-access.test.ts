import { describe, expect, it } from 'vitest';
import { authorizeOperatorAction, createLocalOperatorSession } from './operator-access';

describe('operator access', () => {
    it('allows the local operator on an active system', () => {
        const session = createLocalOperatorSession('operator-a', { organizationId: 'customer-a' });
        expect(authorizeOperatorAction(session, 'queue-action', 'system-a').allowed).toBe(true);
    });

    it('rejects expired sessions and systems outside the grant', () => {
        const session = createLocalOperatorSession('operator-a', {
            allowedSystemIds: ['system-a'],
            expiresAt: '2026-09-12T10:00:00.000Z'
        });
        expect(authorizeOperatorAction(session, 'job-action', 'system-a', '2026-09-12T10:00:01.000Z')).toMatchObject({
            allowed: false,
            reason: 'The operator session has expired.'
        });
        expect(authorizeOperatorAction(session, 'job-action', 'system-b', '2026-09-12T09:00:00.000Z').allowed).toBe(false);
    });

    it('rejects an action outside the session grant', () => {
        const session = createLocalOperatorSession('operator-a', { allowedActions: ['incident-workflow'] });
        expect(authorizeOperatorAction(session, 'queue-action', 'system-a')).toMatchObject({ allowed: false });
    });
});
