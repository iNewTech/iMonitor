import type { DaemonServer } from '@ibm/mapepire-js';

/**
 * Describes whether development-only demo mode is available in the current build.
 */
export interface DemoAvailability {
    enabled: boolean;
    reason?: string;
}

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
        || config.host?.trim().toLowerCase() === 'dummy'
        || config.user?.trim().toLowerCase() === 'dummy';
}
