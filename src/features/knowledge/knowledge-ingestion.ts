import { createHash } from 'node:crypto';
import {
    type KnowledgeRecord,
    type KnowledgeSourceType,
    type KnowledgeSourceRef,
    type KnowledgeConfidence,
    type KnowledgeStatus
} from './knowledge-contract';
import { createKnowledgeStore } from './knowledge-store';

export const MAX_KNOWLEDGE_SOURCE_LENGTH = 200_000;
export const MAX_KNOWLEDGE_CHUNK_LENGTH = 4_000;
export const MAX_KNOWLEDGE_CHUNKS = 100;

export type KnowledgeAdapterKind =
    | 'incident-evidence'
    | 'runbook'
    | 'resolution'
    | 'job-context'
    | 'object-analysis'
    | 'customer-document';

export interface KnowledgeSourceInput {
    adapter: KnowledgeAdapterKind;
    sourceId: string;
    sourceName: string;
    sourceKind?: KnowledgeSourceRef['kind'];
    sourceLocator?: string;
    sourceType?: KnowledgeSourceType;
    content: string;
    customerScope: string;
    systemScope: string;
    operational?: boolean;
    permissions?: string[];
    observedAt?: string;
    confidence?: KnowledgeConfidence;
    status?: KnowledgeStatus;
    redactionProfile?: string;
    signal?: string;
    sourceLabel?: string;
    signalType?: string;
    objectNames?: string[];
    runbookId?: string;
    runbookVersion?: number;
    abortSignal?: AbortSignal;
}

export interface KnowledgeChunk {
    index: number;
    unit: 'message' | 'job' | 'runbook-step' | 'evidence' | 'timeline' | 'source';
    content: string;
}

export interface KnowledgeIngestionResult {
    sourceId: string;
    sourceHash: string;
    redacted: boolean;
    chunks: number;
    records: KnowledgeRecord[];
    retiredRecordIds: string[];
}

export interface KnowledgeIngestionFailure {
    sourceId: string;
    sourceName: string;
    error: string;
}

export interface KnowledgeBatchResult {
    results: KnowledgeIngestionResult[];
    failures: KnowledgeIngestionFailure[];
    cancelled: boolean;
}

export class KnowledgeIngestionCancelledError extends Error {
    constructor() {
        super('Knowledge ingestion was cancelled.');
        this.name = 'KnowledgeIngestionCancelledError';
    }
}

const REDACTED = '[REDACTED]';
const SECRET_KEY = /(?:password|passphrase|secret|token|api[_-]?key|authorization|credential|private[_-]?key)/i;
const SECRET_VALUE = /((?:password|passphrase|secret|token|api[_-]?key|authorization|credential|private[_-]?key)\s*[:=]\s*["']?)[^\s,"';}]+/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CONNECTION_VALUE = /\b(?:jdbc:|db2:\/\/|odbc:\/\/|ssh:\/\/)[^\s"']+/gi;
const UNIT_START = /^(?:message|msgid|job(?:\s+name)?|step|runbook\s+step|evidence|timeline|event|procedure|command|call|error|warning)\s*(?::|#)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function text(value: unknown, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeList(value: unknown, max = 100) {
    return Array.isArray(value)
        ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => text(item, 160)).filter(Boolean))).slice(0, max)
        : [];
}

function abortIfRequested(signal?: AbortSignal) {
    if (signal?.aborted) throw new KnowledgeIngestionCancelledError();
}

/** Removes credentials and connection-shaped values before any chunk is made. */
export function redactSensitiveText(value: string) {
    let redacted = value;
    redacted = redacted.replace(SECRET_VALUE, `$1${REDACTED}`);
    redacted = redacted.replace(BEARER_VALUE, `Bearer ${REDACTED}`);
    redacted = redacted.replace(CONNECTION_VALUE, REDACTED);
    return redacted;
}

function redactRecordValue(value: unknown): unknown {
    if (typeof value === 'string') return redactSensitiveText(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(redactRecordValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
            key,
            SECRET_KEY.test(key) ? REDACTED : redactRecordValue(item)
        ]));
    }
    return value;
}

/** Formats a structured source record without carrying unredacted nested values. */
export function formatKnowledgeSourceRecord(value: unknown) {
    return redactSensitiveText(JSON.stringify(redactRecordValue(value), null, 2));
}

function unitFor(line: string): KnowledgeChunk['unit'] {
    if (/^(?:message|msgid)\b/i.test(line)) return 'message';
    if (/^job(?:\s+name)?\b/i.test(line)) return 'job';
    if (/^(?:step|runbook\s+step|procedure|command)\b/i.test(line)) return 'runbook-step';
    if (/^evidence\b/i.test(line)) return 'evidence';
    if (/^(?:timeline|event)\b/i.test(line)) return 'timeline';
    return 'source';
}

/** Chunks at operational headings and bounded line boundaries. */
export function chunkKnowledgeText(value: string, signal?: AbortSignal): KnowledgeChunk[] {
    abortIfRequested(signal);
    const source = redactSensitiveText(String(value || '')).replace(/\r\n?/g, '\n').trim();
    if (!source) return [];
    const lines = source.split('\n');
    const chunks: KnowledgeChunk[] = [];
    let current = '';
    let unit: KnowledgeChunk['unit'] = 'source';

    const flush = () => {
        const content = current.trim();
        if (content) chunks.push({ index: chunks.length, unit, content });
        current = '';
    };

    lines.forEach((line) => {
        abortIfRequested(signal);
        const normalized = line.trim();
        if (!normalized) {
            if (current.length > MAX_KNOWLEDGE_CHUNK_LENGTH * 0.75) flush();
            return;
        }
        const nextUnit = unitFor(normalized);
        const isHeading = UNIT_START.test(normalized);
        if (current && (isHeading || current.length + normalized.length + 1 > MAX_KNOWLEDGE_CHUNK_LENGTH)) flush();
        if (!current) unit = nextUnit;
        let remaining = normalized;
        while (remaining.length > MAX_KNOWLEDGE_CHUNK_LENGTH) {
            current = remaining.slice(0, MAX_KNOWLEDGE_CHUNK_LENGTH);
            flush();
            remaining = remaining.slice(MAX_KNOWLEDGE_CHUNK_LENGTH);
        }
        current = current ? `${current}\n${remaining}` : remaining;
    });
    flush();
    if (chunks.length > MAX_KNOWLEDGE_CHUNKS) return chunks.slice(0, MAX_KNOWLEDGE_CHUNKS);
    return chunks;
}

function contentHash(content: string) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

function validDate(value: string | undefined) {
    return Boolean(value) && ISO_DATE.test(value as string) && Number.isFinite(Date.parse(value as string));
}

function sourceTypeFor(adapter: KnowledgeAdapterKind, explicit?: KnowledgeSourceType): KnowledgeSourceType {
    if (explicit) return explicit;
    switch (adapter) {
        case 'incident-evidence': return 'evidence';
        case 'runbook': return 'runbook';
        case 'resolution': return 'resolution';
        case 'job-context': return 'job';
        case 'object-analysis': return 'object-analysis';
        case 'customer-document': return 'operator-guide';
    }
}

function defaultSourceKind(adapter: KnowledgeAdapterKind): KnowledgeSourceRef['kind'] {
    return adapter === 'customer-document' ? 'file' : 'record';
}

/** Converts a bounded, redacted source into validated records for the local store. */
export function createKnowledgeRecords(input: KnowledgeSourceInput): { sourceHash: string; redacted: boolean; chunks: KnowledgeChunk[]; records: KnowledgeRecord[] } {
    const sourceId = text(input.sourceId, 240);
    const sourceName = text(input.sourceName, 240);
    const customerScope = text(input.customerScope, 160);
    const systemScope = text(input.systemScope, 160);
    const raw = String(input.content || '');
    if (!sourceId || !sourceName || !customerScope || !systemScope) throw new Error('Source identity and customer/system scope are required.');
    if (raw.length > MAX_KNOWLEDGE_SOURCE_LENGTH) throw new Error(`Source exceeds ${MAX_KNOWLEDGE_SOURCE_LENGTH} characters.`);
    const sourceFileName = text(input.sourceLocator, 500).split('/').pop() || '';
    if (input.adapter === 'customer-document' && !isSupportedDocument(sourceName) && !isSupportedDocument(sourceFileName)) throw new Error('This document type is not supported yet. Use a text, Markdown, JSON, CL, RPGLE, SQL, or CSV file.');
    const redactedText = redactSensitiveText(raw);
    const chunks = chunkKnowledgeText(redactedText, input.abortSignal);
    if (!chunks.length) throw new Error('The source does not contain readable text.');
    const sourceHash = contentHash(redactedText);
    const observedAt = validDate(input.observedAt) ? input.observedAt as string : new Date().toISOString();
    const sourceLocator = text(input.sourceLocator, 500) || `${input.adapter}://${sourceId}`;
    const sourceType = sourceTypeFor(input.adapter, input.sourceType);
    const permissions = safeList(input.permissions?.length ? input.permissions : ['read']);
    const redactionProfile = text(input.redactionProfile, 120) || 'ibmi-default';
    const records = chunks.map((chunk) => {
        const hash = contentHash(chunk.content);
        const sourceRef: KnowledgeSourceRef = {
            kind: input.sourceKind || defaultSourceKind(input.adapter),
            id: sourceId,
            locator: `${sourceLocator}#chunk-${chunk.index + 1}`
        };
        const record: KnowledgeRecord = {
            id: `${sourceId}:chunk:${chunk.index + 1}:${hash.slice(0, 12)}`,
            schemaVersion: 1,
            sourceType,
            title: `${sourceName} · ${chunk.unit} ${chunk.index + 1}`.slice(0, 240),
            content: chunk.content,
            operational: input.operational !== false,
            customerScope,
            systemScope,
            permissions,
            sourceRef,
            evidenceRefs: [{ id: `${sourceId}:evidence:${chunk.index + 1}`, label: input.sourceLabel || sourceName, sourceRef }],
            observedAt,
            contentHash: hash,
            redactionProfile,
            confidence: input.confidence || 'medium',
            status: input.status || 'observed',
            incidentKind: text(input.signalType, 120) || undefined,
            objectNames: safeList(input.objectNames),
            runbookId: text(input.runbookId, 240) || undefined,
            runbookVersion: input.runbookVersion
        };
        return record;
    });
    return { sourceHash, redacted: redactedText !== raw, chunks, records };
}

/** Upserts one source incrementally and retires only chunks no longer present. */
export async function ingestKnowledgeSource(
    store: ReturnType<typeof createKnowledgeStore>,
    input: KnowledgeSourceInput
): Promise<KnowledgeIngestionResult> {
    const prepared = createKnowledgeRecords(input);
    abortIfRequested(input.abortSignal);
    const scope = { customerScope: text(input.customerScope, 160), systemScope: text(input.systemScope, 160) };
    const existing = (await store.list(scope)).filter((record) => record.sourceRef.id === text(input.sourceId, 240) && record.status !== 'retired');
    const incomingHashes = new Set(prepared.records.map((record) => record.contentHash));
    const retiredRecordIds: string[] = [];
    for (const previous of existing) {
        abortIfRequested(input.abortSignal);
        if (incomingHashes.has(previous.contentHash)) continue;
        const retired = await store.retire(previous.id, new Date().toISOString());
        retiredRecordIds.push(retired.id);
    }
    const records: KnowledgeRecord[] = [];
    for (const next of prepared.records) {
        abortIfRequested(input.abortSignal);
        records.push((await store.upsert(next)).record);
    }
    return {
        sourceId: text(input.sourceId, 240),
        sourceHash: prepared.sourceHash,
        redacted: prepared.redacted,
        chunks: prepared.chunks.length,
        records,
        retiredRecordIds
    };
}

/** Continues unrelated sources when one adapter fails. */
export async function ingestKnowledgeSources(
    store: ReturnType<typeof createKnowledgeStore>,
    sources: KnowledgeSourceInput[],
    onProgress?: (completed: number, total: number) => void
): Promise<KnowledgeBatchResult> {
    const results: KnowledgeIngestionResult[] = [];
    const failures: KnowledgeIngestionFailure[] = [];
    let cancelled = false;
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        try {
            results.push(await ingestKnowledgeSource(store, source));
        } catch (error) {
            if (error instanceof KnowledgeIngestionCancelledError) {
                cancelled = true;
                break;
            }
            failures.push({ sourceId: text(source.sourceId, 240), sourceName: text(source.sourceName, 240), error: error instanceof Error ? error.message : 'Source ingestion failed.' });
        } finally {
            onProgress?.(index + 1, sources.length);
        }
    }
    return { results, failures, cancelled };
}

export function isSupportedDocument(fileName: string) {
    return /\.(txt|md|markdown|json|cl|clle|rpg|rpgle|sql|csv)$/i.test(fileName.trim());
}

type StructuredSource = Omit<KnowledgeSourceInput, 'adapter' | 'sourceType'>;

export function adaptIncidentEvidence(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'incident-evidence', sourceType: 'evidence' }); }
export function adaptRunbook(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'runbook', sourceType: 'runbook' }); }
export function adaptApprovedResolution(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'resolution', sourceType: 'resolution', status: 'approved' }); }
export function adaptJobContext(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'job-context', sourceType: 'job' }); }
export function adaptObjectAnalysis(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'object-analysis', sourceType: 'object-analysis' }); }
export function adaptCustomerDocument(input: StructuredSource) { return createKnowledgeRecords({ ...input, adapter: 'customer-document', sourceType: 'operator-guide', operational: false }); }
