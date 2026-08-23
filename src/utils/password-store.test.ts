import { describe, expect, it } from 'vitest';

import { LEGACY_FALLBACK_SECRET, encryptWithSecret } from './crypto';
import {
    needsCredentialMigration,
    protectPassword,
    revealPassword
} from './password-store';

function createSafeStorageMock() {
    return {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(`mock:${text}`, 'utf8'),
        decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^mock:/, '')
    };
}

describe('password protection helpers', () => {
    it('protectPassword prefers Electron safeStorage when it is available', () => {
        const safeStorage = createSafeStorageMock();
        const protectedPassword = protectPassword('p@ssw0rd', { safeStorage });

        expect(protectedPassword).toMatch(/^safe:/);
        expect(revealPassword(protectedPassword, { safeStorage })).toBe('p@ssw0rd');
    });

    it('protectPassword falls back to ENCRYPTION_KEY-backed AES when safeStorage is unavailable', () => {
        const protectedPassword = protectPassword('db2-pass', {
            encryptionKey: 'test-secret',
            safeStorage: {
                isEncryptionAvailable: () => false,
                encryptString: () => Buffer.alloc(0),
                decryptString: () => ''
            }
        });

        expect(protectedPassword).toMatch(/^env:/);
        expect(revealPassword(protectedPassword, { encryptionKey: 'test-secret' })).toBe('db2-pass');
    });

    it('protectPassword throws when no credential protection mechanism is available', () => {
        expect(() =>
            protectPassword('db2-pass', {
                safeStorage: {
                    isEncryptionAvailable: () => false,
                    encryptString: () => Buffer.alloc(0),
                    decryptString: () => ''
                }
            })
        ).toThrow(/Credential encryption is unavailable/);
    });

    it('revealPassword supports legacy unprefixed payloads so older saved connections can migrate', () => {
        const legacyPayload = encryptWithSecret('older-password', LEGACY_FALLBACK_SECRET);

        expect(revealPassword(legacyPayload)).toBe('older-password');
        expect(needsCredentialMigration(legacyPayload, { safeStorage: createSafeStorageMock() })).toBe(true);
    });

    it('needsCredentialMigration treats safeStorage-protected values as current', () => {
        const safeStorage = createSafeStorageMock();
        const protectedPassword = protectPassword('current-password', { safeStorage });

        expect(needsCredentialMigration(protectedPassword, { safeStorage })).toBe(false);
    });
});
