import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    buildSupportContactBody,
    buildSupportDiagnosticsBody,
    buildSupportDiagnosticsFileName,
    buildSupportMailtoUrl
} from '../../features/support/support-utils';

interface SupportRuntimeDependencies {
    appName: string;
    appVersion: string;
    supportEmail: string;
    downloadsPath: string;
    openExternal: (target: string) => Promise<void>;
    showItemInFolder: (fullPath: string) => void;
    recordActivity: (entry: {
        area: 'support';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    getLatestReadableLogFilePath: () => Promise<string>;
    getOperatorLogText: () => string;
}

/**
 * Creates the support runtime that opens contact mail and prepares diagnostics bundles.
 */
export function createSupportRuntime(dependencies: SupportRuntimeDependencies) {
    const getAppInfo = () => ({
        appName: dependencies.appName,
        appVersion: dependencies.appVersion,
        supportEmail: dependencies.supportEmail
    });

    return {
        getAppInfo,
        async contactSupport() {
            const mailtoUrl = buildSupportMailtoUrl({
                supportEmail: dependencies.supportEmail,
                subject: `${dependencies.appName} support`,
                body: buildSupportContactBody({
                    appName: dependencies.appName,
                    appVersion: dependencies.appVersion
                })
            });

            await dependencies.openExternal(mailtoUrl);
            dependencies.recordActivity({
                area: 'support',
                level: 'success',
                message: 'Opened support contact mail draft.',
                detail: dependencies.supportEmail
            });

            return {
                success: true,
                mailtoUrl
            };
        },
        async sendSupportDiagnostics() {
            const latestReadableLogFilePath = await dependencies.getLatestReadableLogFilePath();
            const latestReadableLogText = await fs.readFile(latestReadableLogFilePath, 'utf8');
            const diagnosticsPath = path.join(
                dependencies.downloadsPath,
                buildSupportDiagnosticsFileName(dependencies.appName, new Date().toISOString())
            );
            const diagnosticsBody = [
                `${dependencies.appName} Diagnostics`,
                `Version: ${dependencies.appVersion}`,
                `Generated: ${new Date().toISOString()}`,
                `Platform: ${process.platform}`,
                `Architecture: ${process.arch}`,
                `OS Release: ${os.release()}`,
                `Electron: ${process.versions.electron || 'unknown'}`,
                `Node: ${process.versions.node}`,
                '',
                'Operator Summary',
                '----------------',
                dependencies.getOperatorLogText(),
                '',
                'Current Day Readable Log',
                '------------------------',
                latestReadableLogText
            ].join('\n');

            await fs.mkdir(path.dirname(diagnosticsPath), { recursive: true });
            await fs.writeFile(diagnosticsPath, diagnosticsBody, 'utf8');

            const mailtoUrl = buildSupportMailtoUrl({
                supportEmail: dependencies.supportEmail,
                subject: `${dependencies.appName} diagnostics`,
                body: buildSupportDiagnosticsBody({
                    appName: dependencies.appName,
                    appVersion: dependencies.appVersion,
                    diagnosticsPath
                })
            });

            await dependencies.openExternal(mailtoUrl);
            dependencies.showItemInFolder(diagnosticsPath);
            dependencies.recordActivity({
                area: 'support',
                level: 'success',
                message: 'Prepared support diagnostics and opened a mail draft.',
                detail: diagnosticsPath
            });

            return {
                success: true,
                filePath: diagnosticsPath,
                mailtoUrl
            };
        }
    };
}
