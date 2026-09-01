import { app } from 'electron/main';
import os from 'node:os';
import type { DaemonServer } from '@ibm/mapepire-js';
import type Db from '../../services/ibmi';
import dB, { type ActiveJobRecord, type QueryResult, type ServiceLogEntry } from '../../services/ibmi';
import {
    DEMO_CONNECTION_ID,
    DEMO_CONNECTION_NAME,
    DEMO_CONNECTION_PASSWORD,
    DEMO_CONNECTION_USER,
    getDemoAvailability,
    isDemoRequest
} from '../../features/demo/demo-runtime';
import {
    DEFAULT_PORT,
    findDuplicateHostUserConnection,
    removeConnectionById,
    toPublicConnection,
    toRenderableConnection,
    type StoredConnection
} from '../../utils/connections';
import {
    needsCredentialMigration,
    protectPassword,
    revealPassword
} from '../../utils/password-store';
import {
    deployMapepire,
    ensureMapepireAvailable
} from '../../utils/mapepire-deploy';
import { getDemoDataFilePath, writeDemoSnapshot } from '../../utils/demo-system';
import { THEME_OPTIONS, normalizeThemeId } from '../../features/theme/theme-model';
import type { AppStore } from '../store';
import type { createConnectionStateStore } from '../state/connection-state';
import type { createMonitoringStateStore } from '../state/monitoring-state';
import type { ConnectionErrorPayload, MapepireDeployPayload, MonitorMode } from '../types';

interface SessionRuntimeDependencies {
    store: AppStore;
    connectionState: ReturnType<typeof createConnectionStateStore>;
    monitoringState: ReturnType<typeof createMonitoringStateStore>;
    clearRuntimeMonitoringState: () => void;
    clearDemoWorkflowLinks?: () => void;
    loadConnectionPage: () => void;
    sendToWindow: (channel: string, payload: unknown) => void;
    emitConnectionAction: (message: string, detail?: string) => void;
    emitDeploymentStatus: (status: { level: 'info' | 'success' | 'warning' | 'error'; message: string; detail?: string; }) => void;
    getThemeId: () => string;
    getCredentialOptions: () => { safeStorage: Electron.SafeStorage; encryptionKey?: string | undefined; };
    recordActivity: (entry: {
        area: 'connection' | 'storage' | 'navigation' | 'monitoring';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    createIbmiService: (onLogEntry: (entry: ServiceLogEntry) => void) => Db;
    onServiceLogEntry: (entry: ServiceLogEntry) => void;
    notifyDisconnect: () => void | Promise<void>;
}

/**
 * Owns connection profiles, live IBM i sessions, and theme/session IPC actions.
 */
export function createSessionRuntime(dependencies: SessionRuntimeDependencies) {
    let ibmiService: Db | null = null;
    const localOperatorName = os.userInfo().username?.trim() || 'local-operator';
    const demoOperatorName = 'GajenderT';

    function seedDemoConnection() {
        if (!getDemoAvailability(app.isPackaged).enabled) {
            return;
        }

        const connections = dependencies.store.get('connections');
        if (connections.some((connection) => connection.id === DEMO_CONNECTION_ID)) {
            return;
        }

        try {
            dependencies.store.set('connections', [
                ...connections,
                {
                    id: DEMO_CONNECTION_ID,
                    name: DEMO_CONNECTION_NAME,
                    host: 'dummy',
                    user: DEMO_CONNECTION_USER,
                    encryptedPassword: protectStoredPassword(DEMO_CONNECTION_PASSWORD),
                    port: DEFAULT_PORT
                }
            ]);
        } catch (error) {
            console.warn('Unable to seed the development demo connection.', error);
        }
    }

    const getCurrentOperatorName = () => {
        const currentConnection = dependencies.connectionState.getState().currentConnection;
        const isDemoSession = dependencies.monitoringState.getMonitorMode() === 'dummy'
            || currentConnection?.host === 'dummy.local'
            || currentConnection?.user === demoOperatorName;

        return isDemoSession
            ? demoOperatorName
            : localOperatorName
    };

    const getErrorMessage = (error: unknown) => {
        if (error instanceof Error) {
            return error.message;
        }

        return typeof error === 'string' ? error : 'Unknown error occurred';
    };

    const describeConnectionTarget = (config: Pick<DaemonServer, 'host' | 'user' | 'port'>) => (
        `${config.user}@${config.host}:${config.port ?? DEFAULT_PORT}`
    );

    const buildConnectionErrorPayload = (
        error: unknown,
        context: Pick<DaemonServer, 'host' | 'user' | 'port'>
    ): ConnectionErrorPayload => {
        const rawMessage = getErrorMessage(error);
        const normalizedMessage = rawMessage.toLowerCase();
        const target = describeConnectionTarget(context);
        let summary = 'iMonitor could not open a session to the remote IBM i system.';
        let hint = 'Review the raw error below and confirm the remote service is reachable.';

        if (normalizedMessage.includes('econnrefused') || normalizedMessage.includes('connection refused')) {
            summary = 'The remote Mapepire service refused the connection.';
            hint = 'Confirm the Mapepire daemon is running and listening on the configured port.';
        } else if (normalizedMessage.includes('timed out') || normalizedMessage.includes('etimedout')) {
            summary = 'The connection attempt timed out before the remote system responded.';
            hint = 'Check host reachability, firewall rules, VPN state, and the configured port.';
        } else if (
            normalizedMessage.includes('certificate')
            || normalizedMessage.includes('self signed')
            || normalizedMessage.includes('unable to verify')
            || normalizedMessage.includes('hostname/ip does not match certificate')
        ) {
            summary = 'TLS certificate validation failed for the remote Mapepire service.';
            hint = 'Verify the host name and confirm the remote certificate is valid for that endpoint.';
        } else if (
            normalizedMessage.includes('password')
            || normalizedMessage.includes('not authorized')
            || normalizedMessage.includes('authentication')
            || normalizedMessage.includes('credential')
            || normalizedMessage.includes('user profile')
            || normalizedMessage.includes('signon')
        ) {
            summary = 'Authentication or IBM i authority checks failed for this connection.';
            hint = 'Confirm the user profile, password, and required IBM i monitoring authority.';
        }

        return {
            summary,
            detail: [
                `Target: ${target}`,
                `Raw error: ${rawMessage}`,
                `Hint: ${hint}`
            ].join('\n')
        };
    };

    const protectStoredPassword = (password: string) => (
        protectPassword(password, dependencies.getCredentialOptions())
    );

    seedDemoConnection();

    const decryptStoredPassword = (encryptedPassword: string) => {
        try {
            return revealPassword(encryptedPassword, dependencies.getCredentialOptions());
        } catch (error) {
            console.info('A saved connection password needs to be entered again because its local encryption key is unavailable.');
            return '';
        }
    };

    const testConnection = async (config: DaemonServer) => {
        const testService = dependencies.createIbmiService(dependencies.onServiceLogEntry);

        try {
            await testService.connect({
                host: config.host,
                user: config.user,
                password: config.password,
                port: config.port || DEFAULT_PORT,
                rejectUnauthorized: true
            });

            await testService.query('SELECT CURRENT_TIMESTAMP FROM SYSIBM.SYSDUMMY1');
            return { success: true as const };
        } catch (error) {
            return {
                success: false as const,
                error: buildConnectionErrorPayload(error, {
                    host: config.host,
                    user: config.user,
                    port: config.port || DEFAULT_PORT
                })
            };
        } finally {
            testService.close();
        }
    };

    return {
        getCurrentService() {
            return ibmiService;
        },
        getConnectionState() {
            const state = dependencies.connectionState.getState();
            return {
                isConnected: state.isConnected,
                currentConnection: state.currentConnection ? toPublicConnection(state.currentConnection) : null
            };
        },
        getMonitoringState() {
            return dependencies.monitoringState.getMonitoringState();
        },
        getAppFlags() {
            const demoAvailability = getDemoAvailability(app.isPackaged);
            return {
                demoModeEnabled: demoAvailability.enabled,
                demoModeReason: demoAvailability.reason,
                operatorName: getCurrentOperatorName(),
                themeId: dependencies.getThemeId(),
                themes: THEME_OPTIONS
            };
        },
        getThemeSettings() {
            return {
                themeId: dependencies.getThemeId(),
                themes: THEME_OPTIONS
            };
        },
        saveThemeSettings(candidateThemeId: string | undefined) {
            const normalizedThemeId = normalizeThemeId(candidateThemeId);
            dependencies.store.set('themeId', normalizedThemeId);
            dependencies.recordActivity({
                area: 'navigation',
                level: 'info',
                message: 'Theme updated.',
                detail: `UI theme set to ${normalizedThemeId}.`
            });

            return {
                themeId: normalizedThemeId,
                themes: THEME_OPTIONS
            };
        },
        async saveConnection(connection: {
            id?: string;
            name: string;
            host: string;
            port?: number;
            user: string;
            password: string;
        }) {
            try {
                const existingConnections = dependencies.store.get('connections');
                const nameExists = existingConnections.some((item) => item.name.trim().toLowerCase() === connection.name.trim().toLowerCase() && item.id !== connection.id);
                if (nameExists) {
                    throw new Error(`Connection name "${connection.name}" is already in use. Please choose a different name.`);
                }

                const existingConnection = findDuplicateHostUserConnection(
                    existingConnections,
                    connection.host,
                    connection.user
                );
                if (existingConnection && existingConnection.id !== connection.id) {
                    throw new Error(`A connection to ${connection.host} with user ${connection.user} already exists as "${existingConnection.name}".`);
                }

                dependencies.sendToWindow('connection-test-status', {
                    status: 'testing',
                    message: 'Testing connection...'
                });

                dependencies.recordActivity({
                    area: 'storage',
                    level: 'info',
                    message: `Validating profile "${connection.name}" before saving.`,
                    detail: describeConnectionTarget({
                        host: connection.host,
                        user: connection.user,
                        port: connection.port || DEFAULT_PORT
                    })
                });

                const connectionTestResult = await testConnection({
                    host: connection.host,
                    user: connection.user,
                    password: connection.password,
                    port: connection.port
                });

                if (!connectionTestResult.success) {
                    dependencies.sendToWindow('connection-test-status', {
                        status: 'failed',
                        message: connectionTestResult.error.summary,
                        detail: connectionTestResult.error.detail
                    });
                    return {
                        success: false,
                        error: connectionTestResult.error.summary,
                        detail: connectionTestResult.error.detail
                    };
                }

                dependencies.sendToWindow('connection-test-status', {
                    status: 'success',
                    message: 'Connection test successful. Saving connection...'
                });

                const id = connection.id || Date.now().toString();
                const storedConnection: StoredConnection = {
                    id,
                    name: `${connection.name}`,
                    host: connection.host,
                    user: connection.user,
                    encryptedPassword: protectStoredPassword(connection.password),
                    port: connection.port || DEFAULT_PORT
                };

                const updatedConnections = connection.id
                    ? existingConnections.map((item) => item.id === connection.id ? storedConnection : item)
                    : [...existingConnections, storedConnection];
                dependencies.store.set('connections', updatedConnections);
                dependencies.recordActivity({
                    area: 'storage',
                    level: 'success',
                    message: `${connection.id ? 'Updated' : 'Saved'} profile "${storedConnection.name}".`,
                    detail: describeConnectionTarget(storedConnection)
                });
                dependencies.sendToWindow(
                    'connections-updated',
                    updatedConnections.map((conn) => toPublicConnection(conn))
                );

                return { success: true, id };
            } catch (error: unknown) {
                const errorMessage = getErrorMessage(error);
                dependencies.recordActivity({
                    area: 'storage',
                    level: 'error',
                    message: 'Failed to save connection profile.',
                    detail: errorMessage
                });
                return { success: false, error: errorMessage };
            }
        },
        loadConnections() {
            let hasChanges = false;
            const connections = dependencies.store.get('connections');
            const renderedConnections = connections.map((connection) => {
                let password = decryptStoredPassword(connection.encryptedPassword);

                // The development demo has a known password, so it can self-heal after
                // switching between Electron profiles or clearing the local Keychain.
                if (!password && connection.id === DEMO_CONNECTION_ID) {
                    password = DEMO_CONNECTION_PASSWORD;
                    const repairedConnection = {
                        ...connection,
                        encryptedPassword: protectStoredPassword(password)
                    };
                    dependencies.store.set('connections', connections.map((item) => (
                        item.id === connection.id ? repairedConnection : item
                    )));
                    hasChanges = true;
                }

                return toRenderableConnection(connection, password);
            });

            if (hasChanges) {
                dependencies.recordActivity({
                    area: 'storage',
                    level: 'info',
                    message: 'Repaired the local demo connection credential.'
                });
            }

            return renderedConnections;
        },
        deleteConnection(id: string) {
            try {
                const currentConnections = dependencies.store.get('connections');
                const deletedConnection = currentConnections.find((connection) => connection.id === id) ?? null;
                const updatedConnections = removeConnectionById(currentConnections, id);
                dependencies.store.set('connections', updatedConnections);
                dependencies.recordActivity({
                    area: 'storage',
                    level: 'warning',
                    message: deletedConnection
                        ? `Deleted profile "${deletedConnection.name}".`
                        : 'Deleted a saved profile.',
                    detail: deletedConnection ? describeConnectionTarget(deletedConnection) : undefined
                });
                dependencies.sendToWindow(
                    'connections-updated',
                    updatedConnections.map((conn) => toPublicConnection(conn))
                );
                return { success: true };
            } catch (error: unknown) {
                const errorMessage = getErrorMessage(error);
                dependencies.recordActivity({
                    area: 'storage',
                    level: 'error',
                    message: 'Failed to delete a saved profile.',
                    detail: errorMessage
                });
                return { success: false, error: errorMessage };
            }
        },
        async deployMapepire(payload: MapepireDeployPayload) {
            try {
                dependencies.emitDeploymentStatus({
                    level: 'info',
                    message: `Starting ${payload.mode === 'rpm' ? 'RPM' : 'manual'} Mapepire deployment.`
                });

                const result = await deployMapepire(payload, (status) => {
                    dependencies.emitDeploymentStatus(status);
                });

                dependencies.emitDeploymentStatus({
                    level: 'success',
                    message: `Mapepire deployment completed on port ${result.port}.`,
                    detail: `Install path: ${result.installPath}\nRemote log: ${result.logPath}`
                });

                return {
                    success: true,
                    port: result.port,
                    installPath: result.installPath,
                    logPath: result.logPath,
                    mode: result.mode
                };
            } catch (error: unknown) {
                const errorMessage = getErrorMessage(error);
                dependencies.emitDeploymentStatus({
                    level: 'error',
                    message: 'Mapepire deployment failed.',
                    detail: errorMessage
                });
                return {
                    success: false,
                    error: 'Mapepire deployment failed.',
                    detail: errorMessage
                };
            }
        },
        async connectToSystem(config: DaemonServer & { name?: string; mode?: MonitorMode }) {
            try {
                if (isDemoRequest(config)) {
                    const demoAvailability = getDemoAvailability(app.isPackaged);
                    if (!demoAvailability.enabled) {
                        return {
                            success: false,
                            error: 'Demo mode is unavailable in this build.',
                            detail: demoAvailability.reason
                        };
                    }

                    dependencies.emitConnectionAction('Launching demo system.');
                    if (dependencies.monitoringState.clearMonitoringTimer()) {
                        dependencies.recordActivity({
                            area: 'monitoring',
                            level: 'warning',
                            message: 'Stopped the previous monitoring loop before switching systems.'
                        });
                    }

                    ibmiService?.close();
                    ibmiService = null;
                    dependencies.clearDemoWorkflowLinks?.();
                    dependencies.clearRuntimeMonitoringState();
                    dependencies.monitoringState.setMonitorMode('dummy');
                    const demoDataFilePath = getDemoDataFilePath(app.getPath('userData'));
                    dependencies.monitoringState.setDemoDataFilePath(demoDataFilePath);
                    await writeDemoSnapshot(demoDataFilePath, dependencies.monitoringState.getDummyPollCount());
                    dependencies.connectionState.setCurrentConnection({
                        id: `demo-${Date.now()}`,
                        name: config.name?.trim() || 'iMonitor Demo System',
                        host: 'dummy.local',
                        user: demoOperatorName,
                        encryptedPassword: '',
                        port: DEFAULT_PORT
                    });

                    dependencies.recordActivity({
                        area: 'connection',
                        level: 'success',
                        message: 'Connected to the iMonitor demo system.',
                        detail: `Using generated JSON data at ${demoDataFilePath} with rotating RUN, LCKW, DLYW, and MSGW states.`
                    });
                    dependencies.emitConnectionAction('Demo system ready.');
                    return { success: true, port: DEFAULT_PORT };
                }

                dependencies.emitConnectionAction('Checking Mapepire service.');
                const requestedPort = config.port ?? DEFAULT_PORT;
                const mapepireSetup = await ensureMapepireAvailable({
                    host: config.host,
                    user: config.user,
                    password: config.password,
                    sshPort: 22,
                    preferredPort: requestedPort
                }, (status) => {
                    dependencies.emitConnectionAction(status.message, status.detail);
                });

                const connectionConfig: DaemonServer = {
                    ...config,
                    port: mapepireSetup.port,
                    rejectUnauthorized: true
                };

                dependencies.emitConnectionAction(`Opening iMonitor session on port ${connectionConfig.port}.`);
                dependencies.recordActivity({
                    area: 'connection',
                    level: 'info',
                    message: 'Opening iMonitor system session.',
                    detail: describeConnectionTarget(connectionConfig)
                });

                const nextService = dependencies.createIbmiService(dependencies.onServiceLogEntry);
                await nextService.connect(connectionConfig);

                if (dependencies.monitoringState.clearMonitoringTimer()) {
                    dependencies.recordActivity({
                        area: 'monitoring',
                        level: 'warning',
                        message: 'Stopped the previous monitoring loop before switching systems.'
                    });
                }

                ibmiService?.close();
                ibmiService = nextService;
                dependencies.clearRuntimeMonitoringState();
                dependencies.monitoringState.setMonitorMode('live');
                dependencies.connectionState.setCurrentConnection({
                    id: `session-${Date.now()}`,
                    name: config.name?.trim() || `${config.host}:${connectionConfig.port}`,
                    host: config.host,
                    user: config.user,
                    encryptedPassword: '',
                    port: connectionConfig.port
                });

                dependencies.recordActivity({
                    area: 'connection',
                    level: 'success',
                    message: 'Connected to remote IBM i system.',
                    detail: 'Monitoring will start automatically when the dashboard opens.'
                });
                dependencies.emitConnectionAction('Connection ready.');
                return { success: true, port: connectionConfig.port };
            } catch (error: unknown) {
                dependencies.connectionState.clear();
                dependencies.clearRuntimeMonitoringState();
                const connectionError = buildConnectionErrorPayload(error, {
                    host: config.host,
                    user: config.user,
                    port: config.port ?? DEFAULT_PORT
                });
                dependencies.recordActivity({
                    area: 'connection',
                    level: 'error',
                    message: 'Remote system connection failed.',
                    detail: connectionError.detail
                });
                dependencies.emitConnectionAction(connectionError.summary, connectionError.detail);
                return {
                    success: false,
                    error: connectionError.summary,
                    detail: connectionError.detail
                };
            }
        },
        async getSystemStatus(): Promise<QueryResult<ActiveJobRecord>> {
            if (dependencies.monitoringState.getMonitorMode() === 'dummy') {
                throw new Error('Demo mode status must be served by monitoring runtime.');
            }

            if (!ibmiService) {
                throw new Error('Not connected to IBM i');
            }

            return ibmiService.getActiveJobs();
        },
        async disconnect() {
            try {
                if (ibmiService) {
                    ibmiService.close();
                    ibmiService = null;
                }

                dependencies.monitoringState.setMonitorMode('live');
                if (dependencies.monitoringState.clearMonitoringTimer()) {
                    dependencies.recordActivity({
                        area: 'monitoring',
                        level: 'warning',
                        message: 'Monitoring stopped because the session was disconnected.'
                    });
                }

                await dependencies.notifyDisconnect();
                dependencies.connectionState.clear();
                dependencies.clearRuntimeMonitoringState();
                dependencies.loadConnectionPage();
                dependencies.recordActivity({
                    area: 'connection',
                    level: 'success',
                    message: 'Disconnected from the remote IBM i system.'
                });
                return { success: true };
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                dependencies.recordActivity({
                    area: 'connection',
                    level: 'error',
                    message: 'Disconnect failed.',
                    detail: errorMessage
                });
                return { success: false, error: errorMessage };
            }
        },
        migrateStoredConnections() {
            const currentConnections = dependencies.store.get('connections');
            let hasChanges = false;

            const migratedConnections = currentConnections.map((connection) => {
                if (!needsCredentialMigration(connection.encryptedPassword, dependencies.getCredentialOptions())) {
                    return connection;
                }

                const password = decryptStoredPassword(connection.encryptedPassword);
                if (!password) {
                    return connection;
                }

                try {
                    const nextEncryptedPassword = protectStoredPassword(password);
                    if (nextEncryptedPassword === connection.encryptedPassword) {
                        return connection;
                    }

                    hasChanges = true;
                    return {
                        ...connection,
                        encryptedPassword: nextEncryptedPassword
                    };
                } catch (error) {
                    console.warn(`Unable to migrate saved credentials for "${connection.name}".`, error);
                    return connection;
                }
            });

            if (hasChanges) {
                dependencies.store.set('connections', migratedConnections);
            }
        },
        handleWindowClosed() {
            dependencies.monitoringState.clearMonitoringTimer();
            if (ibmiService) {
                ibmiService.close();
                ibmiService = null;
            }
            dependencies.connectionState.clear();
            dependencies.clearRuntimeMonitoringState();
        }
    };
}
