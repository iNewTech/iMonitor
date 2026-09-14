import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    createObservabilityLedger,
    normalizeObservabilitySettings,
    type ObservabilityAuditCategory,
    type ObservabilityEvent,
    type ObservabilityScope,
    type ObservabilitySettings
} from '../../features/observability/observability-ledger';

interface ObservabilityRuntimeDependencies {
    userDataPath: string;
    getSettings: () => ObservabilitySettings;
    getScope: () => ObservabilityScope;
}

/** Serializes ledger reads and writes, preserving the scope captured when each request starts. */
export function createAiabObservabilityRuntime(dependencies: ObservabilityRuntimeDependencies) {
    const filePath = path.join(dependencies.userDataPath, 'imonitor-observability', 'observability.json');
    let settings = normalizeObservabilitySettings(dependencies.getSettings());
    let ledger = createObservabilityLedger(settings);
    let loaded = false;
    let pending = Promise.resolve();
    let storageError = '';

    async function load() {
        if (loaded) return;
        try {
            const saved = JSON.parse(await fs.readFile(filePath, 'utf8')) as { state?: unknown };
            // The settings store is authoritative; an older ledger copy must not override it.
            ledger = createObservabilityLedger(settings, saved.state);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                storageError = 'Telemetry could not be loaded. Check local storage access.';
            }
        }
        loaded = true;
    }

    function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
        const result = pending.then(async () => { await load(); return operation(); });
        // A failed write must not block later reads or a retry.
        pending = result.then(() => undefined, () => undefined);
        return result;
    }

    async function persist() {
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(`${filePath}.tmp`, JSON.stringify({ settings, state: ledger.state() }, null, 2), 'utf8');
            await fs.rename(`${filePath}.tmp`, filePath);
            storageError = '';
        } catch {
            storageError = 'Telemetry could not be saved. Check free space and local storage access.';
            throw new Error(storageError);
        }
    }

    function record(write: (scope: ObservabilityScope, now: Date) => void) {
        const scope = { ...dependencies.getScope() };
        const now = new Date();
        void enqueue(async () => { write(scope, now); await persist(); }).catch(() => {
            // Best-effort telemetry never rejects into the monitoring loop; health exposes the failure.
        });
    }

    return {
        recordMetric(name: Parameters<typeof ledger.recordMetric>[0], value: number, attributes: ObservabilityEvent['attributes'] = {}) {
            const capturedAttributes = { ...attributes };
            record((scope, now) => ledger.recordMetric(name, value, scope, capturedAttributes, now));
        },
        recordAudit(category: ObservabilityAuditCategory, name: string, outcome: ObservabilityEvent['outcome'] = 'success', attributes: ObservabilityEvent['attributes'] = {}) {
            const capturedAttributes = { ...attributes };
            record((scope, now) => ledger.recordAudit(category, name, outcome, scope, capturedAttributes, now));
        },
        getSnapshot() {
            const scope = { ...dependencies.getScope() };
            return enqueue(() => {
                const snapshot = ledger.snapshot(scope);
                if (storageError) {
                    snapshot.state = 'degraded';
                    snapshot.degradedReasons = [storageError];
                }
                return snapshot;
            });
        },
        getEvents() {
            const scope = { ...dependencies.getScope() };
            return enqueue(() => ledger.list(scope));
        },
        export() {
            const scope = { ...dependencies.getScope() };
            return enqueue(() => ledger.export(scope));
        },
        setSettings(candidate: Partial<ObservabilitySettings>) {
            const capturedSettings = { ...candidate };
            return enqueue(async () => {
                settings = normalizeObservabilitySettings({ ...settings, ...capturedSettings });
                ledger = createObservabilityLedger(settings, ledger.state());
                await persist();
                return { ...settings };
            });
        },
        purge(before: string) {
            const scope = { ...dependencies.getScope() };
            return enqueue(async () => {
                const result = ledger.purge(before, scope);
                await persist();
                return result;
            });
        },
        async flush() { await pending; }
    };
}
