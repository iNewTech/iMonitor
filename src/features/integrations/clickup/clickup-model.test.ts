import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CLICKUP_SETTINGS,
    DEFAULT_STORED_CLICKUP_SETTINGS,
    normalizeClickUpSettings,
    normalizeStoredClickUpSettings,
    toRenderableClickUpSettings,
    toStoredClickUpSettings
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
            syncComments: false
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
            syncComments: false
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
});
