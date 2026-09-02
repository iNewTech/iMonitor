import {
    constants,
    createCipheriv,
    createDecipheriv,
    privateDecrypt,
    publicEncrypt,
    randomBytes
} from 'node:crypto';

const FORMAT = 'imonitor-diagnostics-v1';

/** Removes common credential patterns before diagnostic content is encrypted. */
export function redactDiagnosticText(value: string) {
    return String(value ?? '')
        .replace(/(["']?(?:password|api[_ -]?(?:key|token)|token|secret|webhook(?:url)?|authorization)["']?\s*[:=]\s*["'])([^"'\r\n,;}]*)/gi, '$1[REDACTED]')
        .replace(/((?:password|api[_ -]?(?:key|token)|token|secret|webhook(?:url)?|authorization)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/https:\/\/hooks\.slack\.com\/services\/[^\s)]+/gi, '[SLACK WEBHOOK REDACTED]');
}

/** Encrypts diagnostics with a support public key using a hybrid envelope. */
export function encryptDiagnostics(value: string, supportPublicKey: string) {
    const publicKey = supportPublicKey.trim();
    if (!publicKey) {
        throw new Error('Support encryption is not configured on this build.');
    }

    const contentKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
    const ciphertext = Buffer.concat([
        cipher.update(redactDiagnosticText(value), 'utf8'),
        cipher.final()
    ]);
    const wrappedKey = publicEncrypt({
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
    }, contentKey);

    return JSON.stringify({
        format: FORMAT,
        algorithm: 'RSA-OAEP-SHA256 + AES-256-GCM',
        key: wrappedKey.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
    }, null, 2);
}

/** Used by developer tooling and tests to open a diagnostics envelope. */
export function decryptDiagnostics(envelopeText: string, supportPrivateKey: string) {
    const envelope = JSON.parse(envelopeText) as {
        format?: string;
        key?: string;
        iv?: string;
        tag?: string;
        ciphertext?: string;
    };
    if (
        envelope.format !== FORMAT
        || !envelope.key
        || !envelope.iv
        || !envelope.tag
        || !envelope.ciphertext
    ) {
        throw new Error('Invalid iMonitor diagnostics envelope.');
    }

    const contentKey = privateDecrypt({
        key: supportPrivateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
    }, Buffer.from(envelope.key, 'base64'));
    const decipher = createDecipheriv(
        'aes-256-gcm',
        contentKey,
        Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
}
