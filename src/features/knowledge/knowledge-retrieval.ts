import { getKnowledgeFreshness, type KnowledgeCitation, type KnowledgeRecord } from './knowledge-contract';
import type { KnowledgeIndexSearchRequest } from './knowledge-index';

export type KnowledgeRetrievalSource = 'lexical' | 'semantic' | 'hybrid';

export interface KnowledgeRetrievalInput {
    customerScope: string;
    systemScope: string;
    operatorId: string;
    operatorPermissions: string[];
    query: string;
    qualifiedJob?: string;
    incidentKind?: string;
    signal?: string;
    objectIdentifiers?: string[];
    runtimeFingerprint?: string;
    limit?: number;
}

export interface KnowledgeRetrievalQuery {
    indexRequest: KnowledgeIndexSearchRequest;
    customerScope: string;
    systemScope: string;
    operatorScope: { operatorId: string; permissions: string[] };
    exactIdentifiers: string[];
    terms: string[];
}

export interface KnowledgeRetrievalMatch {
    record: KnowledgeRecord;
    citation: KnowledgeCitation;
    reasons: string[];
    reviewState: 'approved' | 'observed' | 'needs-review' | 'stale';
    source: KnowledgeRetrievalSource;
}

export interface KnowledgeRetrievalResult {
    matches: KnowledgeRetrievalMatch[];
    citations: KnowledgeCitation[];
    noMatchReason?: 'no-match' | 'no-fresh-match';
}

const TOKEN_PATTERN = /[a-z0-9_:#./-]+/gi;

function text(value: unknown, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, max = 100) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
        .filter((item): item is string => typeof item === 'string')
        .map((item) => text(item, 160))
        .filter(Boolean))).slice(0, max);
}

function tokens(value: string) {
    return Array.from(new Set((value.match(TOKEN_PATTERN) || []).map((item) => item.toLocaleLowerCase())));
}

function normalizedIdentifiers(input: KnowledgeRetrievalInput) {
    return Array.from(new Set([
        input.qualifiedJob,
        input.incidentKind,
        input.signal,
        input.runtimeFingerprint,
        ...(input.objectIdentifiers || [])
    ].map((value) => text(value, 240)).filter(Boolean)));
}

/** Builds a bounded query while retaining the operator scope for audit and later MCP use. */
export function buildKnowledgeRetrievalQuery(input: KnowledgeRetrievalInput): KnowledgeRetrievalQuery {
    const exactIdentifiers = normalizedIdentifiers(input);
    const queryParts = [text(input.query, 500), ...exactIdentifiers];
    const terms = tokens(queryParts.join(' '));
    const indexRequest: KnowledgeIndexSearchRequest = {
        customerScope: text(input.customerScope, 160),
        systemScope: text(input.systemScope, 160),
        query: terms.join(' ').slice(0, 1_000),
        limit: Math.min(Math.max(Number(input.limit) || 20, 1), 100)
    };
    return {
        indexRequest,
        customerScope: indexRequest.customerScope,
        systemScope: indexRequest.systemScope,
        operatorScope: {
            operatorId: text(input.operatorId, 160),
            permissions: list(input.operatorPermissions)
        },
        exactIdentifiers,
        terms
    };
}

function searchableFields(record: KnowledgeRecord) {
    return {
        title: text(record.title, 240).toLocaleLowerCase(),
        content: text(record.content, 32_000).toLocaleLowerCase(),
        identifiers: [record.qualifiedJob, record.incidentKind, record.queue, record.subsystem, record.sourceType, ...record.objectNames]
            .map((value) => text(value, 240).toLocaleLowerCase()).filter(Boolean)
    };
}

function reviewState(record: KnowledgeRecord, now: string) {
    const freshness = getKnowledgeFreshness(record, now);
    if (freshness === 'stale') return 'stale' as const;
    if (record.status === 'approved') return 'approved' as const;
    if (record.status === 'observed') return 'observed' as const;
    return 'needs-review' as const;
}

function citationFor(record: KnowledgeRecord, now: string): KnowledgeCitation {
    return {
        id: `citation:${record.id}`,
        recordId: record.id,
        label: record.title,
        sourceRef: record.sourceRef,
        status: getKnowledgeFreshness(record, now),
        observedAt: record.observedAt
    };
}

function scoreRecord(record: KnowledgeRecord, query: KnowledgeRetrievalQuery, now: string) {
    const fields = searchableFields(record);
    const exact = query.exactIdentifiers.map((value) => value.toLocaleLowerCase());
    let score = 0;
    const reasons: string[] = [];
    const matchedTerms = query.terms.filter((term) => fields.title.includes(term) || fields.content.includes(term) || fields.identifiers.some((item) => item.includes(term)));
    if (matchedTerms.length) {
        score += matchedTerms.length;
        reasons.push(`Matches ${matchedTerms.slice(0, 3).join(', ')}`);
    }
    const exactMatches = exact.filter((identifier) => fields.identifiers.includes(identifier) || fields.title.includes(identifier));
    const exactTitleMatches = exact.filter((identifier) => fields.title.includes(identifier));
    if (exactMatches.length) {
        // An exact job, message, queue, object, or command identifier is the
        // strongest signal in production support; it must beat a broad symptom hit.
        score += exactMatches.length * 40;
        score += exactTitleMatches.length * 20;
        reasons.unshift(`Exact identifier: ${exactMatches.slice(0, 2).join(', ')}`);
    }
    if (record.status === 'approved') {
        score += 2;
        reasons.push('Approved source');
    }
    const state = reviewState(record, now);
    if (state === 'stale') reasons.push('Stale evidence; verify before use');
    if (state === 'needs-review') reasons.push('Needs review before use');
    if (record.operational && record.systemScope === query.systemScope) reasons.push('Matches active IBM i system');
    return { score, reasons: reasons.length ? reasons : ['Related operational source'], state };
}

/** Ranks bounded adapter results without exposing numeric ranking scores to the UI. */
export function rankKnowledgeRecords(
    records: readonly KnowledgeRecord[],
    query: KnowledgeRetrievalQuery,
    source: KnowledgeRetrievalSource = 'lexical',
    now = new Date().toISOString()
): KnowledgeRetrievalResult {
    const seen = new Set<string>();
    const ranked = records
        .filter((record) => {
            const key = record.contentHash || record.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return !['retired', 'blocked'].includes(record.status);
        })
        .map((record) => ({ record, ...scoreRecord(record, query, now) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || right.record.observedAt.localeCompare(left.record.observedAt))
        .slice(0, query.indexRequest.limit || 20)
        .map(({ record, reasons, state }) => ({
            record,
            citation: citationFor(record, now),
            reasons,
            reviewState: state,
            source
        }));

    return {
        matches: ranked,
        citations: ranked.map((item) => item.citation),
        noMatchReason: ranked.length ? undefined : records.some((record) => reviewState(record, now) === 'stale') ? 'no-fresh-match' : 'no-match'
    };
}
