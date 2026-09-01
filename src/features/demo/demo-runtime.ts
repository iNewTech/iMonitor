import type { DaemonServer } from '@ibm/mapepire-js';

/**
 * Describes whether development-only demo mode is available in the current build.
 */
export interface DemoAvailability {
    enabled: boolean;
    reason?: string;
}

export const DEMO_CONNECTION_ID = 'demo-connection';
export const DEMO_CONNECTION_NAME = 'Demo connection';
export const DEMO_CONNECTION_USER = 'Gajtyagi';
export const DEMO_CONNECTION_PASSWORD = 'welcome';

/**
 * Returns the runtime availability of demo mode.
 */
export function getDemoAvailability(isPackaged: boolean): DemoAvailability {
    if (isPackaged) {
        return {
            enabled: false,
            reason: 'Demo mode is disabled in packaged production builds.'
        };
    }

    return {
        enabled: true
    };
}

/**
 * Detects whether a connection request is targeting the local demo system.
 */
export function isDemoRequest(
    config: DaemonServer & { mode?: 'live' | 'dummy'; host?: string; user?: string }
) {
    return config.mode === 'dummy'
        || ['dummy', 'dummy.local'].includes(config.host?.trim().toLowerCase() || '')
        || config.user?.trim().toLowerCase() === 'dummy';
}
