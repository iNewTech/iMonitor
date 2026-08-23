export interface StoredConnection {
    id: string;
    name: string;
    host: string;
    user: string;
    encryptedPassword: string;
    port?: number;
}

export interface PublicConnection {
    id: string;
    name: string;
    host: string;
    user: string;
    port: number;
}

export interface RenderableConnection extends PublicConnection {
    password: string;
}

export const DEFAULT_PORT = 8076;

export function toPublicConnection(connection: StoredConnection): PublicConnection {
    return {
        id: connection.id,
        name: connection.name,
        host: connection.host,
        user: connection.user,
        port: connection.port ?? DEFAULT_PORT
    };
}

export function toRenderableConnection(connection: StoredConnection, password: string): RenderableConnection {
    return {
        ...toPublicConnection(connection),
        password
    };
}

export function hasDuplicateConnectionName(connections: StoredConnection[], name: string): boolean {
    const normalizedName = name.trim().toLowerCase();
    return connections.some((connection) => connection.name.trim().toLowerCase() === normalizedName);
}

export function findDuplicateHostUserConnection(
    connections: StoredConnection[],
    host: string,
    user: string
): StoredConnection | undefined {
    const normalizedHost = host.trim().toLowerCase();
    const normalizedUser = user.trim().toLowerCase();

    return connections.find(
        (connection) =>
            connection.host.trim().toLowerCase() === normalizedHost &&
            connection.user.trim().toLowerCase() === normalizedUser
    );
}

export function removeConnectionById(connections: StoredConnection[], id: string): StoredConnection[] {
    return connections.filter((connection) => connection.id !== id);
}
