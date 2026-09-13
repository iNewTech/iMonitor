import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createObservabilityLedger, normalizeObservabilitySettings, type ObservabilityAuditCategory, type ObservabilityEvent, type ObservabilityScope, type ObservabilitySettings } from '../../features/observability/observability-ledger';

interface ObservabilityRuntimeDependencies {
    userDataPath: string;
    getSettings: () => ObservabilitySettings;
    getScope: () => ObservabilityScope;
}

/** Persists the redacted local observability ledger without coupling it to the knowledge store. */
export function createAiabObservabilityRuntime(dependencies: ObservabilityRuntimeDependencies) {
    const filePath = () => path.join(dependencies.userDataPath, 'imonitor-observability', 'observability.json');
    let ledger = createObservabilityLedger(dependencies.getSettings());
    let loaded = false;
    let loadPromise: Promise<void> | null = null;
    let writeQueue = Promise.resolve();

    function enqueue(operation: () => Promise<void>) {
        const run = writeQueue.then(operation, operation);
        writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    async function load() {
        if (loaded) return;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            try {
                const parsed = JSON.parse(await fs.readFile(filePath(), 'utf8')) as { settings?: Partial<ObservabilitySettings>; state?: unknown };
                ledger = createObservabilityLedger(normalizeObservabilitySettings({ ...dependencies.getSettings(), ...(parsed.settings || {}) }), parsed.state);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Unable to load iMonitor observability ledger.', error);
            } finally {
                loaded = true;
                loadPromise = null;
            }
        })();
        return loadPromise;
    }

    function persist() {
        return enqueue(async () => {
            const target = filePath();
            const temporary = `${target}.tmp`;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(temporary, JSON.stringify({ settings: dependencies.getSettings(), state: ledger.state() }, null, 2), 'utf8');
            await fs.rename(temporary, target);
        });
    }

    function recordMetric(name: Parameters<typeof ledger.recordMetric>[0], value: number, attributes: ObservabilityEvent['attributes'] = {}) {
        void load().then(() => { ledger.recordMetric(name, value, dependencies.getScope(), attributes); return persist(); });
    }

    function recordAudit(category: ObservabilityAuditCategory, name: string, outcome: ObservabilityEvent['outcome'] = 'success', attributes: ObservabilityEvent['attributes'] = {}) {
        void load().then(() => { ledger.recordAudit(category, name, outcome, dependencies.getScope(), attributes); return persist(); });
    }

    return {
        recordMetric,
        recordAudit,
        async getSnapshot() { await load(); return ledger.snapshot(dependencies.getScope()); },
        async getEvents() { await load(); return ledger.list(dependencies.getScope()); },
        async export() { await load(); return ledger.export(dependencies.getScope()); },
        async setSettings(settings: Partial<ObservabilitySettings>) {
            await load();
            ledger = createObservabilityLedger(normalizeObservabilitySettings(settings), ledger.state());
            await persist();
            return dependencies.getSettings();
        },
        async purge(before: string) { await load(); const result = ledger.purge(before, dependencies.getScope()); await persist(); return result; },
        async flush() { await load(); await writeQueue; }
    };
}
