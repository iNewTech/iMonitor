import { ipcMain, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron/main';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
    buildAiAvailabilityEvents,
    calculateSupportMetrics,
    type SupportMetricsInput
} from '../../features/history/support-metrics';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { ActivityLogEntry } from '../types';
import type { AuthorizationResult } from '../../features/action-board/operator-access';

interface RegisterSupportMetricsIpcDependencies {
    getSystemId: () => string | undefined;
    getIncidents: () => MonitorAlert[];
    getActivityLog: () => ActivityLogEntry[];
    authorizeRead: () => AuthorizationResult;
    getDownloadsPath: () => string;
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    recordActivity?: (entry: { area: 'monitoring'; level: 'info' | 'error'; message: string; detail?: string }) => void;
}

interface SupportMetricsRequest {
    from?: string;
    to?: string;
    timeZone?: string;
}

/** Registers customer-scoped support outcome reporting without exposing live action APIs. */
export function registerSupportMetricsIpc(dependencies: RegisterSupportMetricsIpcDependencies) {
    const buildReport = (payload: SupportMetricsRequest | undefined) => {
        const systemId = dependencies.getSystemId();
        if (!systemId) {
            throw new Error('Connect to an IBM i system before opening support outcomes.');
        }

        const to = payload?.to || new Date().toISOString();
        const toMs = new Date(to).getTime();
        const from = payload?.from || new Date(toMs - 7 * 24 * 60 * 60 * 1000).toISOString();
        const aiEvents = buildAiAvailabilityEvents(dependencies.getActivityLog(), systemId);
        const input: SupportMetricsInput = {
            systemId,
            incidents: dependencies.getIncidents(),
            aiEvents,
            from,
            to,
            timeZone: payload?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        return calculateSupportMetrics(input);
    };

    ipcMain.handle('get-support-metrics', (_event, payload?: SupportMetricsRequest) => {
        const authorization = dependencies.authorizeRead();
        if (!authorization.allowed) {
            return { success: false, report: null, error: authorization.reason || 'The operator cannot inspect support outcomes.' };
        }

        try {
            return { success: true, report: buildReport(payload) };
        } catch (error) {
            return { success: false, report: null, error: error instanceof Error ? error.message : 'Unable to calculate support outcomes.' };
        }
    });

    ipcMain.handle('export-support-metrics', async (_event, payload?: SupportMetricsRequest) => {
        const authorization = dependencies.authorizeRead();
        if (!authorization.allowed) {
            return { success: false, error: authorization.reason || 'The operator cannot export support outcomes.' };
        }

        try {
            const report = buildReport(payload);
            const selection = await dependencies.showSaveDialog({
                title: 'Export support outcomes',
                defaultPath: path.join(dependencies.getDownloadsPath(), `imonitor-support-outcomes-${report.window.from.slice(0, 10)}.json`),
                filters: [{ name: 'JSON report', extensions: ['json'] }]
            });
            if (selection.canceled || !selection.filePath) {
                return { success: false, canceled: true };
            }

            await writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            dependencies.recordActivity?.({
                area: 'monitoring',
                level: 'info',
                message: 'Support outcomes exported.',
                detail: `${report.systemId} | ${selection.filePath}`
            });
            return { success: true, filePath: selection.filePath };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to export support outcomes.';
            dependencies.recordActivity?.({ area: 'monitoring', level: 'error', message: 'Support outcomes export failed.', detail: message });
            return { success: false, error: message };
        }
    });
}
