import { ipcMain } from 'electron/main';
import type { EntitlementState } from '../../features/entitlements/entitlements';

interface RegisterEntitlementsIpcDependencies {
    getEntitlements: () => EntitlementState;
    activateDevelopmentLicense: (key: string) => EntitlementState;
}

/** Registers plan visibility and development-only license activation. */
export function registerEntitlementsIpc(dependencies: RegisterEntitlementsIpcDependencies) {
    ipcMain.handle('get-entitlements', () => dependencies.getEntitlements());
    ipcMain.handle('activate-development-license', (_event, key: string) => {
        return dependencies.activateDevelopmentLicense(String(key || '').trim());
    });
}
