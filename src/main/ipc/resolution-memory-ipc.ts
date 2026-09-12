import { ipcMain } from 'electron/main';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import {
    approveResolution,
    createResolutionDraft,
    exportScopedResolutionMemory,
    retireResolution,
    type ResolutionMemoryEntry,
    type ResolutionMemoryStore
} from '../../features/action-board/resolution-memory';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { AuthorizationResult, ProtectedAction } from '../../features/action-board/operator-access';

interface ResolutionMemoryIpcDependencies {
    getMemory: () => ResolutionMemoryStore;
    saveMemory: (memory: ResolutionMemoryStore) => ResolutionMemoryStore;
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getAlert: (jobName: string) => MonitorAlert | undefined;
    getSystemId: () => string | undefined;
    getSystemLabel: () => string | undefined;
    getOperatorName: () => string;
    authorizeAction: (action: ProtectedAction, systemId: string | undefined) => AuthorizationResult;
    recordActivity?: (entry: { area: 'monitoring'; level: 'info'; message: string; detail?: string }) => void;
}

/** Registers the explicit draft, approve, retire, and export resolution-memory workflow. */
export function registerResolutionMemoryIpc(dependencies: ResolutionMemoryIpcDependencies) {
    const authorize = () => dependencies.authorizeAction('read', dependencies.getSystemId());
    const currentEntries = () => {
        const systemId = dependencies.getSystemId();
        return dependencies.getMemory().entries.filter((entry) => entry.systemId === systemId || entry.systemId === '*');
    };

    ipcMain.handle('get-resolution-memory', () => {
        const authorization = authorize();
        if (!authorization.allowed) return { success: false, entries: [], error: authorization.reason || 'The operator cannot inspect resolution memory.' };
        return { success: true, entries: currentEntries() };
    });

    ipcMain.handle('save-resolution-memory-draft', (_event, jobName: string) => {
        const authorization = authorize();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot save resolution memory.' };
        const systemId = dependencies.getSystemId();
        const job = dependencies.getJob(jobName);
        const alert = dependencies.getAlert(jobName);
        if (!systemId || !job || !alert) return { success: false, error: 'A current incident and system are required to prepare a resolution draft.' };
        const entry = createResolutionDraft({
            systemId,
            systemLabel: dependencies.getSystemLabel(),
            job,
            alert,
            now: new Date().toISOString()
        });
        const memory = dependencies.getMemory();
        const saved = dependencies.saveMemory({ entries: [entry, ...memory.entries].slice(0, 500) });
        dependencies.recordActivity?.({ area: 'monitoring', level: 'info', message: 'Resolution memory draft saved.', detail: entry.title });
        return { success: true, entry, entries: saved.entries.filter((item) => item.systemId === systemId || item.systemId === '*') };
    });

    ipcMain.handle('approve-resolution-memory', (_event, entryId: string) => mutateEntry(entryId, (entry) => approveResolution(entry, dependencies.getOperatorName(), new Date().toISOString()), 'approved'));
    ipcMain.handle('retire-resolution-memory', (_event, entryId: string) => mutateEntry(entryId, (entry) => retireResolution(entry, new Date().toISOString()), 'retired'));

    ipcMain.handle('export-resolution-memory', () => {
        const authorization = authorize();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot export resolution memory.' };
        const systemId = dependencies.getSystemId();
        if (!systemId) return { success: false, error: 'Connect to an IBM i system before exporting memory.' };
        return { success: true, export: exportScopedResolutionMemory(dependencies.getMemory(), systemId) };
    });

    function mutateEntry(id: string, update: (entry: ResolutionMemoryEntry) => ResolutionMemoryEntry, status: string) {
        const authorization = authorize();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot change resolution memory.' };
        const systemId = dependencies.getSystemId();
        const memory = dependencies.getMemory();
        const index = memory.entries.findIndex((entry) => entry.id === id && (entry.systemId === systemId || entry.systemId === '*'));
        if (index < 0) return { success: false, error: 'The selected memory entry is no longer available.' };
        const entries = memory.entries.slice();
        entries[index] = update(entries[index]);
        const saved = dependencies.saveMemory({ entries });
        dependencies.recordActivity?.({ area: 'monitoring', level: 'info', message: `Resolution memory ${status}.`, detail: entries[index].title });
        return { success: true, entry: entries[index], entries: saved.entries.filter((entry) => entry.systemId === systemId || entry.systemId === '*') };
    }
}
