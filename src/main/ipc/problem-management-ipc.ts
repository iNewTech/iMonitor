import { ipcMain } from 'electron/main';
import type { ActiveJobRecord } from '../../services/ibmi';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import {
    addProblemOccurrence,
    buildProblemOccurrence,
    confirmProblem,
    createProblemCandidate,
    findProblemMatches,
    matchProblem,
    normalizeProblemManagement,
    resolveProblem,
    type ProblemManagementStore,
    type ProblemTicketProvider
} from '../../features/action-board/problem-management';
import type { AuthorizationResult, ProtectedAction } from '../../features/action-board/operator-access';

interface ProblemManagementIpcDependencies {
    getProblems: () => ProblemManagementStore;
    saveProblems: (store: ProblemManagementStore) => ProblemManagementStore;
    getJob: (jobName: string) => ActiveJobRecord | undefined;
    getAlert: (jobName: string) => MonitorAlert | undefined;
    getSystemId: () => string | undefined;
    getSystemLabel: () => string | undefined;
    getOperatorName: () => string;
    authorizeAction: (action: ProtectedAction, systemId: string | undefined) => AuthorizationResult;
    recordActivity?: (entry: { area: 'monitoring'; level: 'info'; message: string; detail?: string }) => void;
}

type ProblemPayload = {
    jobName: string;
    problemId?: string;
    rootCause?: string;
    workaround?: string;
    ticketProvider?: ProblemTicketProvider;
    ticketKey?: string;
    ticketUrl?: string;
};

/** Registers the scoped L3 problem and known-error workspace. */
export function registerProblemManagementIpc(dependencies: ProblemManagementIpcDependencies) {
    const authorizeRead = () => dependencies.authorizeAction('read', dependencies.getSystemId());
    const authorizeWrite = () => dependencies.authorizeAction('incident-workflow', dependencies.getSystemId());
    const getContext = (jobName: string) => {
        const systemId = dependencies.getSystemId();
        const job = dependencies.getJob(jobName);
        const alert = dependencies.getAlert(jobName);
        if (!systemId || !job || !alert) return null;
        return { systemId, systemLabel: dependencies.getSystemLabel(), job, alert, now: new Date().toISOString() };
    };
    const scopedRecords = () => {
        const systemId = dependencies.getSystemId();
        return dependencies.getProblems().records.filter((record) => record.systemId === systemId);
    };

    ipcMain.handle('get-problem-workspace', (_event, jobName: string) => {
        const authorization = authorizeRead();
        if (!authorization.allowed) return { success: false, records: [], matches: [], error: authorization.reason || 'The operator cannot inspect L3 problem records.' };
        const context = getContext(String(jobName || '').trim());
        if (!context) return { success: true, records: scopedRecords(), matches: [], currentOccurrence: null };
        const records = scopedRecords();
        return {
            success: true,
            records,
            matches: findProblemMatches(context, { records }),
            currentOccurrence: buildProblemOccurrence(context),
            recurringSignal: Number(context.alert.occurrence || 1) > 1
        };
    });

    ipcMain.handle('create-problem-candidate', (_event, payload: ProblemPayload) => {
        const authorization = authorizeWrite();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot create an L3 problem record.' };
        const context = getContext(String(payload?.jobName || '').trim());
        if (!context) return { success: false, error: 'A current incident and connected system are required.' };
        const current = dependencies.getProblems();
        const matches = findProblemMatches(context, current);
        if (matches[0]) return { success: false, error: 'This incident already matches a tracked problem. Add it as a recurrence instead.' };
        const record = createProblemCandidate(context);
        const saved = dependencies.saveProblems({ records: [record, ...current.records].slice(0, 250) });
        recordChange('L3 problem candidate created.', record.title);
        return { success: true, record, records: saved.records.filter((item) => item.systemId === context.systemId) };
    });

    ipcMain.handle('record-problem-occurrence', (_event, payload: ProblemPayload) => {
        const authorization = authorizeWrite();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot update an L3 problem record.' };
        const context = getContext(String(payload?.jobName || '').trim());
        if (!context || !payload?.problemId) return { success: false, error: 'Select a current problem and incident first.' };
        const current = dependencies.getProblems();
        const index = current.records.findIndex((record) => record.id === payload.problemId && record.systemId === context.systemId);
        if (index < 0) return { success: false, error: 'The selected problem is no longer available.' };
        if (!matchProblem(current.records[index], context)) return { success: false, error: 'The current incident does not match this problem environment.' };
        const records = current.records.slice();
        records[index] = addProblemOccurrence(records[index], buildProblemOccurrence(context), context.now);
        const saved = dependencies.saveProblems({ records });
        recordChange('L3 problem occurrence recorded.', records[index].title);
        return { success: true, record: records[index], records: saved.records.filter((item) => item.systemId === context.systemId) };
    });

    ipcMain.handle('confirm-problem-record', (_event, payload: ProblemPayload) => {
        const authorization = authorizeWrite();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot confirm an L3 problem.' };
        const systemId = dependencies.getSystemId();
        if (!systemId || !payload?.problemId) return { success: false, error: 'Select a problem before confirming it.' };
        const current = dependencies.getProblems();
        const index = current.records.findIndex((record) => record.id === payload.problemId && record.systemId === systemId);
        if (index < 0) return { success: false, error: 'The selected problem is no longer available.' };
        if (!String(payload.rootCause || '').trim() || !String(payload.workaround || '').trim()) return { success: false, error: 'Root cause and workaround are required before confirmation.' };
        const records = current.records.slice();
        records[index] = confirmProblem(records[index], {
            rootCause: payload.rootCause,
            workaround: payload.workaround,
            linkedTicket: payload.ticketProvider && payload.ticketKey ? { provider: payload.ticketProvider, key: payload.ticketKey, url: payload.ticketUrl } : undefined
        }, dependencies.getOperatorName(), new Date().toISOString());
        const saved = dependencies.saveProblems({ records });
        recordChange('L3 problem confirmed.', records[index].title);
        return { success: true, record: records[index], records: saved.records.filter((item) => item.systemId === systemId) };
    });

    ipcMain.handle('resolve-problem-record', (_event, payload: ProblemPayload) => {
        const authorization = authorizeWrite();
        if (!authorization.allowed) return { success: false, error: authorization.reason || 'The operator cannot resolve an L3 problem.' };
        const systemId = dependencies.getSystemId();
        if (!systemId || !payload?.problemId) return { success: false, error: 'Select a problem before marking the fix verified.' };
        const current = dependencies.getProblems();
        const index = current.records.findIndex((record) => record.id === payload.problemId && record.systemId === systemId);
        if (index < 0) return { success: false, error: 'The selected problem is no longer available.' };
        if (current.records[index].status === 'candidate') return { success: false, error: 'Confirm the problem and record its fix before resolving it.' };
        const records = current.records.slice();
        records[index] = resolveProblem(records[index], dependencies.getOperatorName(), new Date().toISOString());
        const saved = dependencies.saveProblems({ records });
        recordChange('L3 problem fix marked verified.', records[index].title);
        return { success: true, record: records[index], records: saved.records.filter((item) => item.systemId === systemId) };
    });

    function recordChange(message: string, detail: string) {
        dependencies.recordActivity?.({ area: 'monitoring', level: 'info', message, detail });
    }
}

export { normalizeProblemManagement };
