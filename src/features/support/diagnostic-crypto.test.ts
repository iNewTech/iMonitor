import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptDiagnostics, encryptDiagnostics, redactDiagnosticText } from './diagnostic-crypto';

describe('diagnostic crypto', () => {
    it('redacts credentials before encryption', () => {
        expect(redactDiagnosticText('password=secret token:abc123')).toBe(
            'password=[REDACTED] token:[REDACTED]'
        );
        expect(redactDiagnosticText('{"password":"secret","apiToken":"abc123"}')).toBe(
            '{"password":"[REDACTED]","apiToken":"[REDACTED]"}'
        );
    });

    it('creates a diagnostics envelope that only the support private key can open', () => {
        const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const publicKey = keyPair.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
        const privateKey = keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

        const envelope = encryptDiagnostics('SQL activity\npassword=secret', publicKey);

        expect(envelope).not.toContain('SQL activity');
        expect(decryptDiagnostics(envelope, privateKey)).toBe('SQL activity\npassword=[REDACTED]');
    });
});
