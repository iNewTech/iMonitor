import { redactSensitiveText } from '../knowledge/knowledge-ingestion';

export const OBSERVABILITY_SCHEMA_VERSION = 1;

export type ObservabilityMetricName =
    | 'retrieval_latency_ms'
    | 'model_latency_ms'
    | 'context_characters'
    | 'cache_hit'
    | 'provider_error'
    | 'estimated_tokens'
    | 'mcp_latency_ms';

export type ObservabilityAuditCategory =
    | 'ingestion'
    | 'retrieval'
    | 'provider'
    | 'mcp'
    | 'approval'
    | 'action'
    | 'purge'
    | 'export'
    | 'failure'
    | 'system';

export interface ObservabilityScope {
    customerScope?: string;
    systemScope?: string;
    operatorId?: string;
}

export interface ObservabilityEvent {
    id: string;
    timestamp: string;
    scope: ObservabilityScope;
    kind: 'metric' | 'audit';
    name: string;
    value?: number;
    outcome?: 'success' | 'failure' | 'denied' | 'warning';
    attributes: Record<string, string | number | boolean>;
}

export interface ObservabilitySettings {
    retentionDays: number;
    maxEvents: number;
}

export const DEFAULT_OBSERVABILITY_SETTINGS: ObservabilitySettings = {
    retentionDays: 30,
    maxEvents: 10_000
};

export interface ObservabilitySnapshot {
    state: 'empty' | 'ready' | 'degraded';
    retentionDays: number;
    eventCount: number;
    oldestAt: string | null;
    newestAt: string | null;
    auditCount: number;
    degradedReasons: string[];
    metrics: {
        retrievalCount: number;
        retrievalAverageMs: number;
        modelCount: number;
        modelAverageMs: number;
        averageContextCharacters: number;
        cacheHits: number;
        providerErrors: number;
        estimatedTokens: number;
        mcpCalls: number;
        mcpAverageMs: number;
    };
}

export interface ObservabilityLedgerState {
    schemaVersion: typeof OBSERVABILITY_SCHEMA_VERSION;
    events: ObservabilityEvent[];
}

const SECRET_KEY = /(password|passphrase|secret|token|api[_-]?key|authorization|credential|prompt|content|message)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function boundedText(value: unknown, max = 160) {
    return redactSensitiveText(typeof value === 'string' ? value : String(value ?? ''))
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, max);
}

function number(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeScope(scope?: ObservabilityScope): ObservabilityScope {
    return {
        customerScope: boundedText(scope?.customerScope, 160) || undefined,
        systemScope: boundedText(scope?.systemScope, 160) || undefined,
        operatorId: boundedText(scope?.operatorId, 160) || undefined
    };
}

export function normalizeObservabilitySettings(candidate?: Partial<ObservabilitySettings>): ObservabilitySettings {
    return {
        retentionDays: Math.min(Math.max(Math.round(number(candidate?.retentionDays, DEFAULT_OBSERVABILITY_SETTINGS.retentionDays)), 1), 3_650),
        maxEvents: Math.min(Math.max(Math.round(number(candidate?.maxEvents, DEFAULT_OBSERVABILITY_SETTINGS.maxEvents)), 100), 100_000)
    };
}

export function normalizeObservabilityState(candidate: unknown): ObservabilityLedgerState {
    const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as Partial<ObservabilityLedgerState>
        : {};
    const events = Array.isArray(value.events) ? value.events.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const raw = item as Partial<ObservabilityEvent>;
        if (typeof raw.id !== 'string' || typeof raw.timestamp !== 'string' || !ISO_DATE.test(raw.timestamp)
            || (raw.kind !== 'metric' && raw.kind !== 'audit') || typeof raw.name !== 'string') return [];
        const attributes = raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)
            ? Object.entries(raw.attributes).slice(0, 20).reduce<Record<string, string | number | boolean>>((result, [key, rawValue]) => {
                if (SECRET_KEY.test(key) || typeof rawValue === 'object' || rawValue === null) return result;
                if (typeof rawValue === 'string') result[boundedText(key, 80)] = boundedText(rawValue);
                else if (typeof rawValue === 'boolean') result[boundedText(key, 80)] = rawValue;
                else if (Number.isFinite(rawValue)) result[boundedText(key, 80)] = rawValue;
                return result;
            }, {})
            : {};
        return [{
            id: boundedText(raw.id, 120), timestamp: raw.timestamp, scope: normalizeScope(raw.scope), kind: raw.kind,
            name: boundedText(raw.name, 120), value: raw.value === undefined ? undefined : number(raw.value),
            outcome: ['success', 'failure', 'denied', 'warning'].includes(String(raw.outcome)) ? raw.outcome : undefined,
            attributes
        } satisfies ObservabilityEvent];
    }) : [];
    return { schemaVersion: OBSERVABILITY_SCHEMA_VERSION, events };
}

function average(events: ObservabilityEvent[]) {
    return events.length ? Math.round(events.reduce((total, event) => total + number(event.value), 0) / events.length) : 0;
}

/** Bounded, redacted metrics and audit ledger used by the local AI + ActionBoard runtime. */
export function createObservabilityLedger(
    settings: Partial<ObservabilitySettings> = {},
    initialState: unknown = { schemaVersion: OBSERVABILITY_SCHEMA_VERSION, events: [] }
) {
    const normalizedSettings = normalizeObservabilitySettings(settings);
    let state = normalizeObservabilityState(initialState);
    let sequence = state.events.length;

    function prune(now = new Date()) {
        const cutoff = now.getTime() - normalizedSettings.retentionDays * 24 * 60 * 60 * 1000;
        state.events = state.events.filter((event) => Date.parse(event.timestamp) >= cutoff).slice(-normalizedSettings.maxEvents);
    }

    function add(event: Omit<ObservabilityEvent, 'id' | 'timestamp'>, now = new Date()) {
        sequence += 1;
        state.events.push({
            id: `obs-${now.getTime()}-${sequence}`,
            timestamp: now.toISOString(),
            scope: normalizeScope(event.scope),
            kind: event.kind,
            name: boundedText(event.name, 120),
            value: event.value === undefined ? undefined : number(event.value),
            outcome: event.outcome,
            attributes: normalizeObservabilityState({ events: [{ ...event, id: 'temporary', timestamp: now.toISOString() }] }).events[0]?.attributes || {}
        });
        prune(now);
        return state.events[state.events.length - 1];
    }

    return {
        recordMetric(name: ObservabilityMetricName, value: number, scope?: ObservabilityScope, attributes: ObservabilityEvent['attributes'] = {}, now = new Date()) {
            return add({ kind: 'metric', name, value, scope: scope || {}, attributes }, now);
        },
        recordAudit(category: ObservabilityAuditCategory, name: string, outcome: ObservabilityEvent['outcome'] = 'success', scope?: ObservabilityScope, attributes: ObservabilityEvent['attributes'] = {}, now = new Date()) {
            return add({ kind: 'audit', name: `${category}:${name}`, outcome, scope: scope || {}, attributes }, now);
        },
        list(scope?: ObservabilityScope) {
            const normalized = normalizeScope(scope);
            return state.events.filter((event) => (!normalized.customerScope || event.scope.customerScope === normalized.customerScope)
                && (!normalized.systemScope || event.scope.systemScope === normalized.systemScope)).slice();
        },
        snapshot(scope?: ObservabilityScope): ObservabilitySnapshot {
            const events = this.list(scope);
            const metric = (name: ObservabilityMetricName) => events.filter((event) => event.kind === 'metric' && event.name === name);
            const retrieval = metric('retrieval_latency_ms');
            const models = metric('model_latency_ms');
            const contexts = metric('context_characters');
            const mcp = metric('mcp_latency_ms');
            const oldestAt = events.map((event) => event.timestamp).sort()[0] || null;
            const sortedTimestamps = events.map((event) => event.timestamp).sort();
            const newestAt = sortedTimestamps[sortedTimestamps.length - 1] || null;
            return {
                state: events.length ? 'ready' : 'empty', retentionDays: normalizedSettings.retentionDays, eventCount: events.length,
                oldestAt, newestAt, auditCount: events.filter((event) => event.kind === 'audit').length, degradedReasons: [],
                metrics: {
                    retrievalCount: retrieval.length, retrievalAverageMs: average(retrieval), modelCount: models.length, modelAverageMs: average(models),
                    averageContextCharacters: average(contexts), cacheHits: metric('cache_hit').reduce((total, event) => total + number(event.value), 0),
                    providerErrors: metric('provider_error').reduce((total, event) => total + number(event.value, 1), 0),
                    estimatedTokens: metric('estimated_tokens').reduce((total, event) => total + number(event.value), 0),
                    mcpCalls: mcp.length, mcpAverageMs: average(mcp)
                }
            };
        },
        purge(before: string, scope?: ObservabilityScope) {
            if (!ISO_DATE.test(before) || Number.isNaN(Date.parse(before))) throw new Error('Observability purge requires an ISO UTC cutoff.');
            const beforeCount = state.events.length;
            const normalized = normalizeScope(scope);
            state.events = state.events.filter((event) => {
                const inSelectedScope = (!normalized.customerScope || event.scope.customerScope === normalized.customerScope)
                    && (!normalized.systemScope || event.scope.systemScope === normalized.systemScope);
                return !(inSelectedScope && event.timestamp < before);
            });
            return { deletedCount: beforeCount - state.events.length, snapshot: this.snapshot(scope) };
        },
        export(scope?: ObservabilityScope) {
            return { schemaVersion: OBSERVABILITY_SCHEMA_VERSION, exportedAt: new Date().toISOString(), scope: normalizeScope(scope), events: this.list(scope) };
        },
        state() { return { schemaVersion: OBSERVABILITY_SCHEMA_VERSION, events: state.events.slice() }; }
    };
}
