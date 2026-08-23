import * as crypto from 'crypto';

export const LEGACY_FALLBACK_SECRET = 'imonitor-local-secret';
const IV_LENGTH = 16;
const ALGORITHM = 'aes-256-cbc';

function deriveKey(secret: string) {
    if (!secret) {
        throw new Error('Encryption secret is required.');
    }

    return crypto.createHash('sha256').update(secret).digest();
}

export function encryptWithSecret(text: string, secret: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptWithSecret(text: string, secret: string): string {
    const [ivHex, encryptedHex] = text.split(':');
    if (!ivHex || !encryptedHex) {
        throw new Error('Invalid encrypted payload');
    }

    const iv = Buffer.from(ivHex, 'hex');
    if (iv.length !== IV_LENGTH) {
        throw new Error('Invalid initialization vector');
    }

    const encryptedText = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
}

export function encrypt(text: string): string {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('ENCRYPTION_KEY is required when Electron safeStorage is unavailable.');
    }

    return encryptWithSecret(text, secret);
}

export function decrypt(text: string): string {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('ENCRYPTION_KEY is required when Electron safeStorage is unavailable.');
    }

    return decryptWithSecret(text, secret);
}
