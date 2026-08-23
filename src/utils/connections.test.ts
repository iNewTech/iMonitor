import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PORT,
    findDuplicateHostUserConnection,
    hasDuplicateConnectionName,
    removeConnectionById,
    toPublicConnection,
    toRenderableConnection,
    type StoredConnection
} from './connections';

const firstConnection: StoredConnection = {
    id: '1',
    name: 'Primary',
    host: 'my-ibmi',
    user: 'ADMIN',
    encryptedPassword: 'secret'
};

const secondConnection: StoredConnection = {
    id: '2',
    name: 'Secondary',
    host: 'backup-ibmi',
    user: 'backup',
    encryptedPassword: 'secret-2',
    port: 9000
};

describe('connections helpers', () => {
    it('toPublicConnection applies the default port when one is not stored', () => {
        expect(toPublicConnection(firstConnection)).toEqual({
            id: '1',
            name: 'Primary',
            host: 'my-ibmi',
            user: 'ADMIN',
            port: DEFAULT_PORT
        });
    });

    it('toRenderableConnection includes the decrypted password for renderer use', () => {
        expect(toRenderableConnection(secondConnection, 'plain-text')).toEqual({
            id: '2',
            name: 'Secondary',
            host: 'backup-ibmi',
            user: 'backup',
            port: 9000,
            password: 'plain-text'
        });
    });

    it('duplicate connection name checks are case-insensitive', () => {
        expect(hasDuplicateConnectionName([firstConnection, secondConnection], ' primary ')).toBe(true);
        expect(hasDuplicateConnectionName([firstConnection, secondConnection], 'Archive')).toBe(false);
    });

    it('duplicate host and user checks are case-insensitive', () => {
        expect(
            findDuplicateHostUserConnection([firstConnection, secondConnection], 'MY-IBMI', 'admin')
        ).toBe(firstConnection);
        expect(
            findDuplicateHostUserConnection([firstConnection, secondConnection], 'new-host', 'admin')
        ).toBeUndefined();
    });

    it('removeConnectionById only removes the targeted record', () => {
        expect(removeConnectionById([firstConnection, secondConnection], '1')).toEqual([secondConnection]);
    });
});
