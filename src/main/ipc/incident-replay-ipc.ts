import { ipcMain } from 'electron/main';
import {
    getReplayScenario,
    REPLAY_SCENARIOS,
    runReplay,
    sanitizeReplaySelection,
    type ReplayResponse
} from '../../features/action-board/incident-replay';
import type { AuthorizationResult } from '../../features/action-board/operator-access';

interface IncidentReplayIpcDependencies {
    authorizeRead: () => AuthorizationResult;
    recordActivity?: (entry: { area: 'monitoring'; level: 'info'; message: string; detail?: string }) => void;
}

/** Registers isolated replay endpoints. No IBM i service or command runner is accepted here. */
export function registerIncidentReplayIpc(dependencies: IncidentReplayIpcDependencies) {
    ipcMain.handle('get-incident-replay-catalog', () => {
        const authorization = dependencies.authorizeRead();
        if (!authorization.allowed) return { success: false, scenarios: [], error: authorization.reason || 'The operator cannot open training replays.' };
        return { success: true, scenarios: REPLAY_SCENARIOS };
    });

    ipcMain.handle('run-incident-replay', (_event, payload: { scenarioId: string; response?: ReplayResponse }) => {
        const authorization = dependencies.authorizeRead();
        if (!authorization.allowed) return { success: false, result: null, error: authorization.reason || 'The operator cannot run training replays.' };
        const scenario = getReplayScenario(String(payload?.scenarioId || '').trim());
        if (!scenario) return { success: false, result: null, error: 'The selected training scenario is unavailable.' };
        const result = runReplay(scenario, sanitizeReplaySelection(payload?.response));
        dependencies.recordActivity?.({ area: 'monitoring', level: 'info', message: 'Training replay completed.', detail: `${scenario.id} · ${result.outcome} · live action=false` });
        return { success: true, result };
    });
}
