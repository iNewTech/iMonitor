import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { ActiveJobRecord } from '../../services/ibmi';
import { buildWidgetSummary } from '../../features/widget/widget-summary';

interface WidgetSummaryRuntimeDependencies {
    userDataPath: string;
    appGroupIdentifier?: string;
    getConnectionContext: () => {
        name: string | null;
        host: string | null;
        user: string | null;
        port: number | null;
    };
    isMonitoringActive: () => boolean;
}

export function getWidgetSummaryDirectory(userDataPath: string) {
    return path.join(userDataPath, 'widget');
}

export function getWidgetSummaryPath(userDataPath: string) {
    return path.join(getWidgetSummaryDirectory(userDataPath), 'imonitor-widget-summary.json');
}

export function getWidgetAppGroupSummaryPath(appGroupIdentifier: string) {
    return path.join(
        os.homedir(),
        'Library',
        'Group Containers',
        appGroupIdentifier,
        'widget',
        'imonitor-widget-summary.json'
    );
}

export function createWidgetSummaryRuntime(dependencies: WidgetSummaryRuntimeDependencies) {
    const summaryPath = getWidgetSummaryPath(dependencies.userDataPath);
    const appGroupSummaryPath = process.platform === 'darwin' && dependencies.appGroupIdentifier
        ? getWidgetAppGroupSummaryPath(dependencies.appGroupIdentifier)
        : null;

    async function writeSummaryFile(filePath: string, json: string) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, json, 'utf8');
    }

    return {
        summaryPath,
        appGroupSummaryPath,
        async writeSummary(jobs: ActiveJobRecord[], alerts: MonitorAlert[], generatedAt: string) {
            const summary = buildWidgetSummary({
                jobs,
                alerts,
                generatedAt,
                connection: dependencies.getConnectionContext(),
                active: dependencies.isMonitoringActive()
            });
            const json = `${JSON.stringify(summary, null, 2)}\n`;

            await writeSummaryFile(summaryPath, json);
            if (appGroupSummaryPath) {
                await writeSummaryFile(appGroupSummaryPath, json);
            }
            return summary;
        }
    };
}
