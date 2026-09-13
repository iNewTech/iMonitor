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
});
