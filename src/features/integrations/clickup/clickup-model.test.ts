import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CLICKUP_SETTINGS,
    DEFAULT_STORED_CLICKUP_SETTINGS,
    normalizeClickUpSettingsUserKey,
    normalizeClickUpSettings,
    normalizeStoredClickUpSettingsByUser,
    normalizeStoredClickUpSettings,
    toRenderableClickUpSettings,
    toStoredClickUpSettings,
    matchClickUpUserForOperator
} from './clickup-model';

describe('clickup-model', () => {
    it('normalizes renderable settings and trims values', () => {
        const settings = normalizeClickUpSettings({
            enabled: true,
            apiToken: '  pk_demo  ',
            workspaceId: ' 123 ',
            workspaceName: ' Ops ',
            spaceId: ' 456 ',
            spaceName: ' NOC ',
            listId: ' 789 ',
            listName: ' Incidents ',
            syncComments: false,
            userEmail: '  ops@example.com  ',
            memberId: ' 44 ',
            assigneeUserId: ' 44 '
        });

        expect(settings).toEqual({
            ...DEFAULT_CLICKUP_SETTINGS,
            enabled: true,
            apiToken: 'pk_demo',
            workspaceId: '123',
            workspaceName: 'Ops',
            spaceId: '456',
            spaceName: 'NOC',
            listId: '789',
            listName: 'Incidents',
            syncComments: false,
            userEmail: 'ops@example.com',
            memberId: '44',
            assigneeUserId: '44'
        });
    });

    it('normalizes stored settings and preserves encrypted token', () => {
        const settings = normalizeStoredClickUpSettings({
            enabled: true,
            encryptedApiToken: ' encrypted ',
            workspaceId: '1',
            spaceId: '2',
            listId: '3'
        });

        expect(settings).toEqual({
            ...DEFAULT_STORED_CLICKUP_SETTINGS,
            enabled: true,
            encryptedApiToken: 'encrypted',
            workspaceId: '1',
            spaceId: '2',
            listId: '3'
        });
    });

    it('converts between renderable and stored token formats', () => {
        const stored = toStoredClickUpSettings({
            ...DEFAULT_CLICKUP_SETTINGS,
            enabled: true,
            apiToken: 'pk_secret'
        }, (value) => `enc:${value}`);

        expect(stored.encryptedApiToken).toBe('enc:pk_secret');

        const renderable = toRenderableClickUpSettings(stored, (value) => value.replace(/^enc:/, ''));
        expect(renderable.apiToken).toBe('pk_secret');
    });

    it('normalizes per-user settings keys and values', () => {
        const settingsByUser = normalizeStoredClickUpSettingsByUser({
            ' GajenderT ': {
                ...DEFAULT_STORED_CLICKUP_SETTINGS,
                encryptedApiToken: ' enc:gajender '
            },
            '': {
                ...DEFAULT_STORED_CLICKUP_SETTINGS,
                encryptedApiToken: ' enc:fallback '
            }
        });

        expect(normalizeClickUpSettingsUserKey(' GajenderT ')).toBe('GajenderT');
        expect(normalizeClickUpSettingsUserKey('')).toBe('local-operator');
        expect(settingsByUser.GajenderT.encryptedApiToken).toBe('enc:gajender');
        expect(settingsByUser['local-operator'].encryptedApiToken).toBe('enc:fallback');
    });

    it('matches the active operator to a ClickUp assignee by username or email', () => {
        const match = matchClickUpUserForOperator('GajenderT', [
            { id: 123, username: 'gajender', email: 'gajender@example.com' },
            { id: 456, username: 'ops', email: 'ops@example.com', first_name: 'Gajender', last_name: 'Tyagi' }
        ]);

        expect(match).toBe('123');
    });
});
