import { Client } from 'ssh2';
import * as net from 'net';

export type DeployMode = 'rpm' | 'manual';
export type DeployStatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface MapepireDeployConfig {
    host: string;
    user: string;
    password: string;
    sshPort: number;
    preferredPort: number;
    mode: DeployMode;
}

export interface MapepireDeployStatus {
    level: DeployStatusLevel;
    message: string;
    detail?: string;
}

export interface MapepireDeployResult {
    installPath: string;
    logPath: string;
    mode: DeployMode;
    port: number;
    startCommand: string;
}

export interface MapepireEnsureResult {
    installPath: string;
    logPath?: string;
    mode: DeployMode | 'existing';
    port: number;
    startCommand?: string;
}

interface SshCommandResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

const MAPEPIRE_DOWNLOAD_URL = 'https://github.com/Mapepire-IBMi/mapepire-server/releases/latest/download/mapepire-server-dist.zip';

function shellQuote(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function delay(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function canAutoShiftPort(preferredPort: number) {
    return preferredPort === 8076;
}

async function isTcpPortOpen(host: string, port: number, timeoutMs = 1500) {
    return new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (isOpen: boolean) => {
            if (settled) {
                return;
            }

            settled = true;
            socket.destroy();
            resolve(isOpen);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, host);
    });
}

async function waitForPort(host: string, port: number, attempts = 10, delayMs = 1000) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await isTcpPortOpen(host, port)) {
            return true;
        }

        await delay(delayMs);
    }

    return false;
}

async function findReachablePort(host: string, preferredPort: number) {
    const candidates = new Set<number>([preferredPort]);
    candidates.add(8076);
    for (let candidate = 8076; candidate <= 8166; candidate += 10) {
        candidates.add(candidate);
    }

    for (const candidate of candidates) {
        if (await isTcpPortOpen(host, candidate)) {
            return candidate;
        }
    }

    return null;
}

function createConnection(config: MapepireDeployConfig) {
    return new Promise<Client>((resolve, reject) => {
        const client = new Client();

        client.once('ready', () => resolve(client));
        client.once('error', (error) => reject(error));
        client.connect({
            host: config.host,
            port: config.sshPort,
            username: config.user,
            password: config.password,
            readyTimeout: 15000,
            keepaliveInterval: 5000
        });
    });
}

function execCommand(client: Client, command: string) {
    return new Promise<SshCommandResult>((resolve, reject) => {
        client.exec(command, (error, stream) => {
            if (error) {
                reject(error);
                return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('close', (code: number | null) => {
                resolve({
                    code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
            });
            stream.on('data', (chunk: Buffer | string) => {
                stdout += chunk.toString();
            });
            stream.stderr.on('data', (chunk: Buffer | string) => {
                stderr += chunk.toString();
            });
        });
    });
}

async function expectSuccess(client: Client, command: string, failureMessage: string) {
    const result = await execCommand(client, command);
    if (result.code !== 0) {
        throw new Error(`${failureMessage}\n${result.stderr || result.stdout || 'Unknown remote command failure.'}`);
    }

    return result;
}

async function choosePort(config: MapepireDeployConfig) {
    let candidate = config.preferredPort;

    if (candidate !== 8076) {
        if (await isTcpPortOpen(config.host, candidate)) {
            throw new Error(`Requested Mapepire port ${candidate} is already in use on ${config.host}.`);
        }

        return candidate;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
        const inUse = await isTcpPortOpen(config.host, candidate);
        if (!inUse) {
            return candidate;
        }

        if (!canAutoShiftPort(config.preferredPort)) {
            break;
        }

        candidate += 10;
    }

    throw new Error(`Unable to find a free Mapepire port starting at ${config.preferredPort}.`);
}

async function installRpmMode(client: Client) {
    await expectSuccess(
        client,
        'command -v yum >/dev/null 2>&1',
        'IBM i RPM tooling is not available on the remote host.'
    );
    await expectSuccess(
        client,
        'yum install -y mapepire-server',
        'RPM installation of mapepire-server failed.'
    );

    return {
        mode: 'rpm' as const,
        installPath: '/QOpenSys/pkgs/bin/mapepire',
        startCommand: '/QOpenSys/pkgs/bin/mapepire'
    };
}

async function installManualMode(client: Client) {
    await expectSuccess(
        client,
        'mkdir -p /opt/download /opt/mapepire',
        'Unable to prepare /opt download/install directories.'
    );
    await expectSuccess(
        client,
        [
            'cd /opt/download',
            'if command -v wget >/dev/null 2>&1; then',
            `  wget -O mapepire-server-dist.zip ${MAPEPIRE_DOWNLOAD_URL}`,
            'elif command -v curl >/dev/null 2>&1; then',
            `  curl -L ${MAPEPIRE_DOWNLOAD_URL} -o mapepire-server-dist.zip`,
            'else',
            '  echo "Neither wget nor curl is available." >&2',
            '  exit 1',
            'fi'
        ].join('\n'),
        'Unable to download the Mapepire distribution zip.'
    );
    await expectSuccess(
        client,
        [
            'cd /opt/mapepire',
            'rm -rf ./*',
            'jar xvf /opt/download/mapepire-server-dist.zip',
            'chown -R qsys .'
        ].join('\n'),
        'Unable to unpack the Mapepire distribution under /opt/mapepire.'
    );

    return {
        mode: 'manual' as const,
        installPath: '/opt/mapepire/bin/mapepire',
        startCommand: '/opt/mapepire/bin/mapepire'
    };
}

async function detectInstalledMapepire(client: Client) {
    const rpmCheck = await execCommand(client, 'if [ -x /QOpenSys/pkgs/bin/mapepire ]; then echo rpm; fi');
    if (rpmCheck.stdout.trim() === 'rpm') {
        return {
            mode: 'rpm' as const,
            installPath: '/QOpenSys/pkgs/bin/mapepire',
            startCommand: '/QOpenSys/pkgs/bin/mapepire'
        };
    }

    const manualCheck = await execCommand(client, 'if [ -x /opt/mapepire/bin/mapepire ]; then echo manual; fi');
    if (manualCheck.stdout.trim() === 'manual') {
        return {
            mode: 'manual' as const,
            installPath: '/opt/mapepire/bin/mapepire',
            startCommand: '/opt/mapepire/bin/mapepire'
        };
    }

    return null;
}

async function installBestAvailableMode(client: Client, emit: (status: MapepireDeployStatus) => void) {
    const yumCheck = await execCommand(client, 'command -v yum >/dev/null 2>&1 && echo yes || echo no');
    if (yumCheck.stdout.trim() === 'yes') {
        emit({
            level: 'info',
            message: 'Mapepire is not installed. Deploying through IBM i RPM tooling.'
        });
        return installRpmMode(client);
    }

    emit({
        level: 'warning',
        message: 'IBM i RPM tooling is not available. Falling back to manual Mapepire deployment.'
    });
    return installManualMode(client);
}

async function startMapepire(client: Client, startCommand: string, port: number) {
    const remoteLogPath = `/tmp/ibmeye-mapepire-${port}.log`;
    const command = `PORT=${port} nohup ${shellQuote(startCommand)} > ${shellQuote(remoteLogPath)} 2>&1 < /dev/null &`;

    await expectSuccess(
        client,
        command,
        `Unable to start Mapepire on port ${port}.`
    );

    return remoteLogPath;
}

async function readRemoteLogTail(client: Client, remoteLogPath: string) {
    const result = await execCommand(client, `tail -n 40 ${shellQuote(remoteLogPath)} 2>/dev/null || true`);
    return result.stdout || result.stderr;
}

/**
 * Installs and starts Mapepire on the remote IBM i host using the explicit deployment mode.
 */
export async function deployMapepire(
    config: MapepireDeployConfig,
    onStatus?: (status: MapepireDeployStatus) => void
) {
    const emit = (status: MapepireDeployStatus) => {
        onStatus?.(status);
    };

    emit({
        level: 'info',
        message: `Opening SSH session to ${config.user}@${config.host}:${config.sshPort}.`
    });

    const port = await choosePort(config);
    if (port !== config.preferredPort) {
        emit({
            level: 'warning',
            message: `Default Mapepire port ${config.preferredPort} is busy. Switching to ${port}.`
        });
    } else {
        emit({
            level: 'info',
            message: `Using Mapepire port ${port}.`
        });
    }

    const client = await createConnection(config);

    try {
        emit({
            level: 'success',
            message: 'SSH session established.'
        });

        const installInfo = config.mode === 'rpm'
            ? await installRpmMode(client)
            : await installManualMode(client);

        emit({
            level: 'success',
            message: config.mode === 'rpm'
                ? 'Mapepire RPM installation completed.'
                : 'Manual Mapepire installation completed.',
            detail: installInfo.installPath
        });

        const logPath = await startMapepire(client, installInfo.startCommand, port);
        emit({
            level: 'info',
            message: 'Mapepire start command sent.',
            detail: `Remote log: ${logPath}`
        });

        const isReachable = await waitForPort(config.host, port, 12, 1000);
        if (!isReachable) {
            const logTail = await readRemoteLogTail(client, logPath);
            throw new Error(`Mapepire did not start listening on port ${port}.\n${logTail || 'No remote log output was captured.'}`);
        }

        emit({
            level: 'success',
            message: `Mapepire is reachable on ${config.host}:${port}.`
        });

        return {
            installPath: installInfo.installPath,
            logPath,
            mode: config.mode,
            port,
            startCommand: installInfo.startCommand
        } satisfies MapepireDeployResult;
    } finally {
        client.end();
    }
}

/**
 * Ensures a usable Mapepire service exists for the requested host before IBMEye opens a session.
 */
export async function ensureMapepireAvailable(
    config: Omit<MapepireDeployConfig, 'mode'>,
    onStatus?: (status: MapepireDeployStatus) => void
) {
    const emit = (status: MapepireDeployStatus) => {
        onStatus?.(status);
    };

    emit({
        level: 'info',
        message: 'Checking for an already running Mapepire service.'
    });

    const reachablePort = await findReachablePort(config.host, config.preferredPort);
    if (reachablePort) {
        emit({
            level: 'success',
            message: `Mapepire is already running on port ${reachablePort}.`
        });
        return {
            installPath: 'existing-service',
            mode: 'existing',
            port: reachablePort
        } satisfies MapepireEnsureResult;
    }

    emit({
        level: 'info',
        message: `Opening SSH session to ${config.user}@${config.host}:${config.sshPort}.`
    });

    const client = await createConnection({
        ...config,
        mode: 'rpm'
    });

    try {
        emit({
            level: 'success',
            message: 'SSH session established.'
        });

        const installInfo = await detectInstalledMapepire(client);
        const installedOrDeployed = installInfo ?? await installBestAvailableMode(client, emit);
        const port = await choosePort({
            ...config,
            mode: installedOrDeployed.mode
        });

        if (installInfo) {
            emit({
                level: 'info',
                message: `Mapepire is installed (${installInfo.mode}). Starting the daemon on port ${port}.`
            });
        }

        const logPath = await startMapepire(client, installedOrDeployed.startCommand, port);
        emit({
            level: 'info',
            message: `Waiting for Mapepire to listen on port ${port}.`,
            detail: `Remote log: ${logPath}`
        });

        const isReachable = await waitForPort(config.host, port, 12, 1000);
        if (!isReachable) {
            const logTail = await readRemoteLogTail(client, logPath);
            throw new Error(`Mapepire did not start listening on port ${port}.\n${logTail || 'No remote log output was captured.'}`);
        }

        emit({
            level: 'success',
            message: `Mapepire is ready on ${config.host}:${port}.`
        });

        return {
            installPath: installedOrDeployed.installPath,
            logPath,
            mode: installedOrDeployed.mode,
            port,
            startCommand: installedOrDeployed.startCommand
        } satisfies MapepireEnsureResult;
    } finally {
        client.end();
    }
}
