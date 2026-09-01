import { ipcMain } from 'electron/main';
import type { EntitlementState } from '../../features/entitlements/entitlements';

interface RegisterEntitlementsIpcDependencies {
    getEntitlements: () => EntitlementState;
    activateDevelopmentLicense: (key: string) => EntitlementState;
    setDevelopmentPlan: (plan: 'free' | 'premium') => EntitlementState;
}

/** Registers plan visibility and development-only license activation. */
export function registerEntitlementsIpc(dependencies: RegisterEntitlementsIpcDependencies) {
    ipcMain.handle('get-entitlements', () => dependencies.getEntitlements());
    ipcMain.handle('activate-development-license', (_event, key: string) => {
        return dependencies.activateDevelopmentLicense(String(key || '').trim());
    });
    ipcMain.handle('set-development-plan', (_event, plan: 'free' | 'premium') => {
        return dependencies.setDevelopmentPlan(plan);
    });
}
