import type { StoredConnection } from '../../utils/connections';

export interface ConnectionState {
    isConnected: boolean;
    currentConnection: StoredConnection | null;
}

/**
 * Stores the active IBM i connection session in the main process.
 */
export function createConnectionStateStore(initialState?: Partial<ConnectionState>) {
    let state: ConnectionState = {
        isConnected: false,
        currentConnection: null,
        ...initialState
    };

    return {
        getState() {
            return state;
        },
        setCurrentConnection(connection: StoredConnection | null) {
            state = {
                isConnected: Boolean(connection),
                currentConnection: connection
            };
        },
        clear() {
            state = {
                isConnected: false,
                currentConnection: null
            };
        }
    };
}
