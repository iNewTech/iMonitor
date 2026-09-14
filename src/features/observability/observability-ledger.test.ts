import { describe, expect, it } from 'vitest';
import { createObservabilityLedger, normalizeObservabilityState } from './observability-ledger';

describe('observability ledger', () => {
    it('redacts prompt-like and secret attributes while retaining useful metrics', () => {
        const ledger = createObservabilityLedger({ retentionDays: 30, maxEvents: 100 });
        ledger.recordMetric('model_latency_ms', 120, {}, { provider: 'Open Models', prompt: 'private question', apiKey: 'secret', model: 'gemma3:latest' });
        const event = ledger.list()[0];
        expect(event.attributes).toEqual({ provider: 'Open Models', model: 'gemma3:latest' });
        expect(JSON.stringify(ledger.state())).not.toContain('private question');
        expect(JSON.stringify(ledger.state())).not.toContain('secret');
    });

    it('summarizes metrics by scope and purges only selected old records', () => {
        const ledger = createObservabilityLedger({ retentionDays: 30, maxEvents: 100 });
        const old = new Date('2026-08-20T00:00:00.000Z');
        ledger.recordMetric('retrieval_latency_ms', 100, { customerScope: 'a', systemScope: 'one' }, {}, old);
        ledger.recordMetric('retrieval_latency_ms', 300, { customerScope: 'a', systemScope: 'one' }, {}, new Date('2026-09-10T00:00:00.000Z'));
        ledger.recordAudit('action', 'hold-job', 'success', { customerScope: 'b', systemScope: 'two' }, {}, old);
        expect(ledger.snapshot({ customerScope: 'a', systemScope: 'one' }).metrics.retrievalAverageMs).toBe(200);
        expect(ledger.purge('2026-09-01T00:00:00.000Z', { customerScope: 'a', systemScope: 'one' }).deletedCount).toBe(1);
        expect(ledger.list({ customerScope: 'b', systemScope: 'two' })).toHaveLength(1);
    });

    it('normalizes persisted events and drops credential-bearing fields', () => {
        const state = normalizeObservabilityState({ events: [{ id: '1', timestamp: '2026-09-10T00:00:00.000Z', kind: 'audit', name: 'test', attributes: { token: 'x', result: 'ok' } }] });
        expect(state.events[0].attributes).toEqual({ result: 'ok' });
    });

    it('treats equivalent UTC cutoffs equally and keeps an event exactly at the cutoff', () => {
        const ledger = createObservabilityLedger();
        ledger.recordAudit('system', 'at-cutoff', 'success', {}, {}, new Date('2026-09-10T00:00:00.000Z'));
        expect(ledger.purge('2026-09-10T00:00:00Z').deletedCount).toBe(0);
        expect(ledger.purge('2026-09-10T00:00:00.001Z').deletedCount).toBe(1);
    });

    it('prevents callers from mutating stored scope and attributes through returned events', () => {
        const ledger = createObservabilityLedger();
        const event = ledger.recordMetric('cache_hit', 1, { customerScope: 'a' }, { result: 'safe' });
        event.scope.customerScope = 'other';
        ledger.list()[0].attributes.result = 'changed';
        ledger.state().events[0].attributes.prompt = 'private';
        expect(ledger.export().events[0]).toMatchObject({ scope: { customerScope: 'a' }, attributes: { result: 'safe' } });
        expect(ledger.export().events[0].attributes).not.toHaveProperty('prompt');
    });

    it('drops malformed dates and prunes restored records to retention and size limits', () => {
        const initial = { events: [
            { id: 'bad', timestamp: '2026-99-99T00:00:00Z', kind: 'audit', name: 'invalid' },
            { id: 'old', timestamp: '2026-01-01T00:00:00Z', kind: 'audit', name: 'expired' },
            ...Array.from({ length: 105 }, (_, id) => ({ id: String(id), timestamp: '2026-09-10T00:00:00Z', kind: 'audit', name: 'recent' }))
        ] };
        const ledger = createObservabilityLedger({ maxEvents: 100, retentionDays: 7 }, initial, new Date('2026-09-14T00:00:00Z'));
        expect(ledger.list()).toHaveLength(100);
        expect(ledger.list().every((event) => event.name === 'recent')).toBe(true);
    });
});
