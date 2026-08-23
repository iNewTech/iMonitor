import {
    LEGACY_FALLBACK_SECRET,
    decryptWithSecret,
    encryptWithSecret
} from './crypto';

export interface SafeStorageLike {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(buffer: Buffer): string;
}

interface PasswordProtectionOptions {
    safeStorage?: SafeStorageLike;
    encryptionKey?: string;
}

const SAFE_STORAGE_PREFIX = 'safe:';
const ENV_KEY_PREFIX = 'env:';

function getConfiguredSecret(encryptionKey?: string): string | undefined {
    return encryptionKey ?? process.env.ENCRYPTION_KEY;
}

export function protectPassword(password: string, options: PasswordProtectionOptions = {}): string {
    if (options.safeStorage?.isEncryptionAvailable()) {
        return `${SAFE_STORAGE_PREFIX}${options.safeStorage.encryptString(password).toString('base64')}`;
    }

    const secret = getConfiguredSecret(options.encryptionKey);
    if (!secret) {
        throw new Error(
            'Credential encryption is unavailable. Configure ENCRYPTION_KEY or use a platform that supports Electron safeStorage.'
        );
    }

    return `${ENV_KEY_PREFIX}${encryptWithSecret(password, secret)}`;
}

export function revealPassword(storedPassword: string, options: PasswordProtectionOptions = {}): string {
    if (storedPassword.startsWith(SAFE_STORAGE_PREFIX)) {
        if (!options.safeStorage?.isEncryptionAvailable()) {
            throw new Error('OS-backed credential storage is unavailable.');
        }

        const encrypted = storedPassword.slice(SAFE_STORAGE_PREFIX.length);
        return options.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }

    if (storedPassword.startsWith(ENV_KEY_PREFIX)) {
        const secret = getConfiguredSecret(options.encryptionKey);
        if (!secret) {
            throw new Error('ENCRYPTION_KEY is required to decrypt saved credentials.');
        }

        return decryptWithSecret(storedPassword.slice(ENV_KEY_PREFIX.length), secret);
    }

    return revealLegacyPassword(storedPassword, options.encryptionKey);
}

export function revealLegacyPassword(storedPassword: string, encryptionKey?: string): string {
    const candidateSecrets = [encryptionKey, LEGACY_FALLBACK_SECRET].filter(Boolean) as string[];

    for (const secret of candidateSecrets) {
        try {
            return decryptWithSecret(storedPassword, secret);
        } catch {
            continue;
        }
    }

    return storedPassword;
}

export function needsCredentialMigration(
    storedPassword: string,
    options: PasswordProtectionOptions = {}
): boolean {
    if (options.safeStorage?.isEncryptionAvailable()) {
        return !storedPassword.startsWith(SAFE_STORAGE_PREFIX);
    }

    return !storedPassword.startsWith(SAFE_STORAGE_PREFIX) && !storedPassword.startsWith(ENV_KEY_PREFIX);
}
