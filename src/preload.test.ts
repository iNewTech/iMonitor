import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

type BridgeApi = Record<string, (...args: unknown[]) => unknown>;
const projectRoot = path.resolve(__dirname, '..');
const config = ts.readConfigFile(path.join(projectRoot, 'tsconfig.json'), ts.sys.readFile);
const { options } = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, projectRoot);
const compiledPreload = ts.transpileModule(readFileSync(path.join(__dirname, 'preload.ts'), 'utf8'), {
    compilerOptions: options,
    fileName: 'preload.ts'
}).outputText;

function loadPreload() {
    const ipcRenderer = Object.assign(new EventEmitter(), {
        invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve(undefined)),
        send: vi.fn()
    });
    const exposeInMainWorld = vi.fn<(name: string, api: BridgeApi) => void>();
    // Model the restricted loader instead of letting Vitest resolve local imports.
    const sandboxRequire = vi.fn((moduleName: string) => {
        if (moduleName !== 'electron') throw new Error(`Unexpected preload dependency: ${moduleName}`);
        return { contextBridge: { exposeInMainWorld }, ipcRenderer };
    });
    new Script(compiledPreload, { filename: 'preload.js' }).runInNewContext({
        exports: {},
        require: sandboxRequire
    }, { timeout: 1000 });
    return { api: exposeInMainWorld.mock.calls[0][1], ipcRenderer, exposeInMainWorld, sandboxRequire };
}

// Public surface before the refactor; helpers and group objects must stay private.
const exposedMethods = [
    'navigateToMonitor', 'navigateToConnection', 'navigateToKnowledge', 'navigateToSettings',
    'navigateToObjectAnalysis', 'getKnowledgeLibrary', 'searchKnowledge', 'getKnowledgeRecord',
    'addKnowledgeSource', 'deleteKnowledgeRecord', 'reindexKnowledge', 'getKnowledgeStats',
    'purgeKnowledge', 'exportKnowledge', 'getAiabObservability', 'saveAiabObservabilitySettings',
    'purgeAiabObservability', 'exportAiabObservability', 'getKnowledgeIndexSettings', 'saveKnowledgeIndexSettings',
    'testKnowledgeIndexConnection', 'getMcpRegistry', 'installMcpCapability', 'configureMcpCapability',
    'setMcpCapabilityEnabled', 'testMcpCapability', 'revokeMcpCapability', 'readMcpResource',
    'getMcpActionCatalog', 'previewMcpAction', 'runMcpAction', 'openJobTaskWindow',
    'openExternalUrl', 'getConnectionState', 'getAppInfo', 'getEntitlements',
    'activateDevelopmentLicense', 'setDevelopmentPlan', 'getAppFlags', 'getThemeSettings',
    'saveThemeSettings', 'getObjectAnalysisSettings', 'saveObjectAnalysisSettings', 'saveObjectAnalysisLibraryList',
    'selectObjectAnalysisDirectory', 'getObjectAnalysisLibraryList', 'getObjectAnalysisWorkspace', 'loadObjectAnalysisSource',
    'analyzeObject', 'analyzeObjectWithAi', 'approveObjectAnalysis', 'saveObjectAnalysisReport',
    'generateObjectAnalysisCompilePlan', 'getAiProviderCatalog', 'getAiSettings', 'saveAiSettings',
    'getAiAvailability', 'askAiAssistant', 'getMonitoringState', 'getCollectorSettings',
    'saveCollectorSettings', 'getCollectorStatus', 'getCollectionInventory', 'previewCollectionPurge',
    'purgeCollection', 'contactSupport', 'sendSupportDiagnostics', 'getMonitoringHistory',
    'getActiveAlerts', 'getSupportMetrics', 'exportSupportMetrics', 'getClickUpSettings',
    'saveClickUpSettings', 'loadClickUpTargetOptions', 'resolveClickUpAssignee', 'createClickUpTaskForAlert',
    'updateAlertWorkflow', 'createIncidentHandoff', 'acceptIncidentHandoff', 'getAlertSettings',
    'getBusinessServiceSettings', 'saveBusinessServiceSettings', 'getResolutionMemory', 'saveResolutionMemoryDraft',
    'approveResolutionMemory', 'rejectResolutionMemory', 'reviseResolutionMemory', 'retireResolutionMemory',
    'exportResolutionMemory', 'getProblemWorkspace', 'createProblemCandidate', 'recordProblemOccurrence',
    'confirmProblemRecord', 'resolveProblemRecord', 'getIncidentReplayCatalog', 'runIncidentReplay',
    'saveAlertSettings', 'getEmailNotificationSettings', 'saveEmailNotificationSettings', 'sendTestEmailNotification',
    'getSlackSettings', 'saveSlackSettings', 'sendTestSlackMessage', 'getSmsSettings',
    'saveSmsSettings', 'sendTestSms', 'getJiraSettings', 'saveJiraSettings',
    'sendTestJiraMessage', 'getSupportAccessGrants', 'createSupportAccessGrant', 'acceptSupportAccessGrant',
    'revokeSupportAccessGrant', 'deployMapepire', 'getJobDetails', 'getJobContext',
    'getJobResourceGraph', 'getJobLog', 'getJobMessages', 'getJobQueues',
    'getJobQueueDetails', 'getQueuedJobs', 'getQueueTriage', 'runJobQueueAction',
    'runJobAction', 'getVerifiedRunbook', 'startVerifiedRunbook', 'runVerifiedRunbookStep',
    'recheckAlert', 'getSystemMessages', 'connectToSystem', 'disconnect',
    'saveConnection', 'loadConnections', 'deleteConnection', 'getSystemStatus',
    'startMonitoring', 'stopMonitoring', 'onStatusUpdate', 'onMonitoringError',
    'onConnectionTestStatus', 'onConnectionActionStatus', 'onConnectionsUpdated', 'onMonitoringHistoryUpdated',
    'onJobQueuesUpdated', 'onQueueTriageUpdated', 'onJobQueueActionVerification', 'onAlertsUpdated',
    'onAlertSettingsUpdated', 'onDeploymentStatus', 'onCollectorStatusUpdated'
];

const groupedCalls: Array<[method: string, channel: string, args: unknown[]]> = [
    ['getKnowledgeLibrary', 'get-knowledge-library', []],
    ['searchKnowledge', 'search-knowledge', ['batch recovery', 17]],
    ['getKnowledgeRecord', 'get-knowledge-record', ['record-1']],
    ['addKnowledgeSource', 'add-knowledge-source', [{ sourceName: 'Runbook', sourceType: 'runbook', fileName: 'runbook.md', content: 'Inspect job.' }]],
    ['deleteKnowledgeRecord', 'delete-knowledge-record', ['record-1']],
    ['reindexKnowledge', 'reindex-knowledge', []],
    ['getKnowledgeStats', 'get-knowledge-stats', []],
    ['purgeKnowledge', 'purge-knowledge', [{ before: '2026-01-01', confirmed: false }]],
    ['exportKnowledge', 'export-knowledge', []],
    ['getAiabObservability', 'get-aiab-observability', []],
    ['saveAiabObservabilitySettings', 'save-aiab-observability-settings', [{ retentionDays: 30 }]],
    ['purgeAiabObservability', 'purge-aiab-observability', [{ before: '2026-01-01', confirmed: false }]],
    ['exportAiabObservability', 'export-aiab-observability', []],
    ['getKnowledgeIndexSettings', 'get-knowledge-index-settings', []],
    ['saveKnowledgeIndexSettings', 'save-knowledge-index-settings', [{ backend: 'local', endpoint: '', collection: 'knowledge', apiKey: '' }]],
    ['testKnowledgeIndexConnection', 'test-knowledge-index-connection', []],
    ['getMcpRegistry', 'get-mcp-registry', []],
    ['installMcpCapability', 'install-mcp-capability', [{ id: 'test-skill', version: '1.0' }]],
    ['configureMcpCapability', 'configure-mcp-capability', [{ id: 'test-skill', endpoint: 'https://example.test/mcp' }]],
    ['setMcpCapabilityEnabled', 'set-mcp-capability-enabled', [{ id: 'test-skill', enabled: false }]],
    ['testMcpCapability', 'test-mcp-capability', ['test-skill']],
    ['revokeMcpCapability', 'revoke-mcp-capability', ['test-skill']],
    ['readMcpResource', 'read-mcp-resource', [{ capabilityId: 'test-skill', kind: 'prompt', name: 'job-guide', input: 'inspect', jobName: 'JOB1', timeoutMs: 2500 }]],
    ['getMcpActionCatalog', 'get-mcp-action-catalog', ['JOB1']],
    ['previewMcpAction', 'preview-mcp-action', [{ capabilityId: 'test-skill', tool: 'inspect', jobName: 'JOB1', input: { detail: true }, timeoutMs: 2500 }]],
    ['runMcpAction', 'run-mcp-action', [{ previewId: 'preview-1', approved: false }]]
];

const subscriptions = [
    ['onStatusUpdate', 'status-update'],
    ['onMonitoringError', 'monitoring-error'],
    ['onConnectionTestStatus', 'connection-test-status'],
    ['onConnectionActionStatus', 'connection-action-status'],
    ['onConnectionsUpdated', 'connections-updated'],
    ['onMonitoringHistoryUpdated', 'monitoring-history-updated'],
    ['onJobQueuesUpdated', 'job-queues-updated'],
    ['onQueueTriageUpdated', 'job-queue-triage-updated'],
    ['onJobQueueActionVerification', 'job-queue-action-verification'],
    ['onAlertsUpdated', 'alerts-updated'],
    ['onAlertSettingsUpdated', 'alert-settings-updated'],
    ['onDeploymentStatus', 'deployment-status'],
    ['onCollectorStatusUpdated', 'collector-status-updated']
];

describe('preload bridge', () => {
    it('loads with only electron available and exposes exactly the existing flat API', () => {
        const { api, ipcRenderer, exposeInMainWorld, sandboxRequire } = loadPreload();
        expect(sandboxRequire.mock.calls).toEqual([['electron']]);
        expect(exposeInMainWorld.mock.calls).toEqual([['electronAPI', api]]);
        expect(Object.keys(api)).toEqual(exposedMethods);
        expect(Object.values(api).every((value) => typeof value === 'function')).toBe(true);
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
        expect(ipcRenderer.send).not.toHaveBeenCalled();
        expect(ipcRenderer.eventNames()).toEqual([]);
    });

    it.each(groupedCalls)('%s keeps its fixed channel, arguments and response', async (method, channel, args) => {
        const { api, ipcRenderer } = loadPreload();
        const response = { success: false, error: 'access denied', extra: { retained: true } };
        const pending = Promise.resolve(response);
        ipcRenderer.invoke.mockReturnValueOnce(pending);
        args.forEach((arg) => { if (arg && typeof arg === 'object') Object.freeze(arg); });
        const result = api[method](...args, 'untrusted-channel', { ignored: true });
        expect(ipcRenderer.invoke.mock.calls).toEqual([[channel, ...args]]);
        args.forEach((arg, index) => expect(ipcRenderer.invoke.mock.calls[0][index + 1]).toBe(arg));
        expect(result).toBe(pending);
        await expect(result).resolves.toBe(response);
        expect(ipcRenderer.send).not.toHaveBeenCalled();
    });

    it('preserves omitted and falsy search limits without shifting arguments', () => {
        const { api, ipcRenderer } = loadPreload();
        api.searchKnowledge('query');
        api.searchKnowledge('query', undefined);
        api.searchKnowledge('', 0);
        expect(ipcRenderer.invoke.mock.calls).toEqual([
            ['search-knowledge', 'query', undefined],
            ['search-knowledge', 'query', undefined],
            ['search-knowledge', '', 0]
        ]);
    });

    it('leaves IPC rejections visible to the renderer', async () => {
        const { api, ipcRenderer } = loadPreload();
        const error = new Error('IPC unavailable');
        ipcRenderer.invoke.mockRejectedValueOnce(error);
        await expect(api.getMcpRegistry()).rejects.toBe(error);
    });

    it('keeps monitoring controls fire-and-forget', () => {
        const { api, ipcRenderer } = loadPreload();
        expect(api.startMonitoring(0, 'ignored')).toBeUndefined();
        expect(api.stopMonitoring('ignored')).toBeUndefined();
        expect(ipcRenderer.send.mock.calls).toEqual([['start-monitoring', 0], ['stop-monitoring']]);
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it.each(subscriptions)('%s delivers only the payload and retains independent, persistent listeners', (method, channel) => {
        const { api, ipcRenderer } = loadPreload();
        const calls: string[] = [];
        const first = vi.fn(() => { calls.push('first'); });
        const second = vi.fn(() => { calls.push('second'); });
        expect(api[method](first)).toBeUndefined();
        expect(api[method](first)).toBeUndefined();
        expect(api[method](second)).toBeUndefined();
        expect(ipcRenderer.eventNames()).toEqual([channel]);
        expect(ipcRenderer.listenerCount(channel)).toBe(3);
        expect(ipcRenderer.listeners(channel)[0]).not.toBe(ipcRenderer.listeners(channel)[1]);
        const event = { sender: ipcRenderer, secret: 'must not reach renderer' };
        const payload = { value: 'payload' };
        ipcRenderer.emit('unrelated-channel', event, payload);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
        ipcRenderer.emit(channel, event, payload, 'extra IPC argument');
        ipcRenderer.emit(channel, event); // A missing payload still invokes the callbacks.
        expect(first.mock.calls).toEqual([[payload], [payload], [undefined], [undefined]]);
        expect(second.mock.calls).toEqual([[payload], [undefined]]);
        expect(calls).toEqual(['first', 'first', 'second', 'first', 'first', 'second']);
        expect(ipcRenderer.listenerCount(channel)).toBe(3);
    });

    it('does not catch or defer callback errors', () => {
        const { api, ipcRenderer } = loadPreload();
        const error = new Error('callback failed');
        api.onMonitoringError(() => { throw error; });
        expect(() => ipcRenderer.emit('monitoring-error', {}, 'failed')).toThrow(error);
    });
});
