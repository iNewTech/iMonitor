import {
    getKnowledgeFreshness,
    type ContextPack,
    type ContextPackScope,
    type KnowledgeCitation,
    type KnowledgeRecord,
    type KnowledgeSourceType
} from './knowledge-contract';
import type { KnowledgeExclusion } from './knowledge-access';
import type { KnowledgeRetrievalMatch } from './knowledge-retrieval';

export type KnowledgeFreshnessPolicy = Partial<Record<KnowledgeSourceType, number>>;

export const DEFAULT_KNOWLEDGE_FRESHNESS_POLICY: KnowledgeFreshnessPolicy = {
    incident: 7 * 24 * 60 * 60 * 1_000,
    evidence: 24 * 60 * 60 * 1_000,
    job: 15 * 60 * 1_000,
    runbook: 30 * 24 * 60 * 60 * 1_000,
    resolution: 30 * 24 * 60 * 60 * 1_000,
    'object-analysis': 7 * 24 * 60 * 60 * 1_000,
    'operator-guide': 90 * 24 * 60 * 60 * 1_000,
    'integration-history': 30 * 24 * 60 * 60 * 1_000
};

export interface BuildKnowledgeContextPackInput {
    scope: ContextPackScope;
    matches: readonly KnowledgeRetrievalMatch[];
    excluded?: readonly KnowledgeExclusion[];
    missingEvidence?: readonly string[];
    maxRecords?: number;
    maxCharacters?: number;
    freshnessPolicy?: KnowledgeFreshnessPolicy;
    now?: string;
}

const DEFAULT_MAX_RECORDS = 12;
const DEFAULT_MAX_CHARACTERS = 12_000;
const MAX_RECORDS = 50;
const MAX_CHARACTERS = 50_000;

function text(value: unknown, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
    const candidate = Number(value);
    return Number.isFinite(candidate) ? Math.min(Math.max(Math.floor(candidate), min), max) : fallback;
}

function safeList(values: readonly string[] | undefined, max = 100) {
    return Array.from(new Set((values || [])
        .filter((item): item is string => typeof item === 'string')
        .map((item) => text(item, 240))
        .filter(Boolean))).slice(0, max);
}

function isStale(record: KnowledgeRecord, policy: KnowledgeFreshnessPolicy, now: string) {
    if (getKnowledgeFreshness(record, now) === 'stale') return true;
    const maxAge = policy[record.sourceType];
    if (!maxAge || maxAge < 1) return false;
    const observedAt = Date.parse(record.observedAt);
    const current = Date.parse(now);
    return Number.isFinite(observedAt) && Number.isFinite(current) && observedAt + maxAge <= current;
}

function citationFor(record: KnowledgeRecord, match: KnowledgeRetrievalMatch, stale: boolean) : KnowledgeCitation {
    return {
        ...match.citation,
        id: `citation:${record.id}`,
        recordId: record.id,
        label: text(record.title, 240),
        sourceRef: record.sourceRef,
        sourceType: record.sourceType,
        status: stale ? 'stale' : match.citation.status,
        excerpt: text(record.content, 500),
        observedAt: record.observedAt
    };
}

function aggregateFreshness(citations: readonly KnowledgeCitation[]): ContextPack['freshness'] {
    if (!citations.length) return 'unknown';
    const stale = citations.filter((citation) => citation.status === 'stale').length;
    if (!stale) return 'current';
    return stale === citations.length ? 'stale' : 'mixed';
}

function excludedRows(values: readonly KnowledgeExclusion[] | undefined) {
    return Array.from(new Map((values || [])
        .filter((item) => item && typeof item.recordId === 'string' && typeof item.reason === 'string')
        .map((item) => [item.recordId, { recordId: text(item.recordId), reason: text(item.reason, 160) }]))
        .values()).slice(0, 100);
}

/** Builds the bounded evidence pack passed to grounded AI and source detail UI. */
export function buildKnowledgeContextPack(input: BuildKnowledgeContextPackInput): ContextPack {
    const now = text(input.now, 40) || new Date().toISOString();
    const policy = { ...DEFAULT_KNOWLEDGE_FRESHNESS_POLICY, ...(input.freshnessPolicy || {}) };
    const maxRecords = boundedNumber(input.maxRecords, DEFAULT_MAX_RECORDS, 1, MAX_RECORDS);
    const maxCharacters = boundedNumber(input.maxCharacters, DEFAULT_MAX_CHARACTERS, 500, MAX_CHARACTERS);
    const selected: KnowledgeRecord[] = [];
    const citations: KnowledgeCitation[] = [];
    const relevanceReasons: NonNullable<ContextPack['relevanceReasons']> = [];
    const excluded = excludedRows(input.excluded);
    let characters = 0;

    for (const match of input.matches) {
        if (selected.length >= maxRecords) {
            excluded.push({ recordId: text(match.record.id), reason: 'context-record-limit' });
            continue;
        }
        const remaining = maxCharacters - characters;
        if (remaining <= 0) {
            excluded.push({ recordId: text(match.record.id), reason: 'context-character-budget' });
            continue;
        }
        const content = text(match.record.content, Math.max(1, remaining));
        const clipped = content.length < match.record.content.length ? `${content.slice(0, Math.max(0, content.length - 1))}…` : content;
        const record = { ...match.record, content: clipped };
        const stale = isStale(match.record, policy, now);
        selected.push(record);
        citations.push(citationFor(record, match, stale));
        relevanceReasons.push({ recordId: record.id, reasons: safeList(match.reasons, 8), source: match.source });
        characters += clipped.length;
    }

    const missingEvidence = safeList(input.missingEvidence);
    if (!selected.length && !missingEvidence.length) missingEvidence.push('No matching support evidence was found.');
    return {
        schemaVersion: 1,
        generatedAt: now,
        records: selected,
        citations,
        excluded: excluded.slice(0, 100),
        freshness: aggregateFreshness(citations),
        missingEvidence,
        scope: {
            customerScope: text(input.scope.customerScope, 160),
            systemScope: text(input.scope.systemScope, 160),
            operatorId: text(input.scope.operatorId, 160) || undefined,
            qualifiedJob: text(input.scope.qualifiedJob, 240) || undefined,
            incidentId: text(input.scope.incidentId, 240) || undefined
        },
        budget: {
            maxCharacters,
            characters,
            estimatedTokens: Math.ceil(characters / 4),
            recordCount: selected.length
        },
        relevanceReasons
    };
}
