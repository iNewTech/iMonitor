import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import {
    matchClickUpUserByEmail,
    matchClickUpUserForOperator,
    type ClickUpListOption,
    type ClickUpSettings,
    type ClickUpTargetOptions,
    type ClickUpTaskReference
} from '../../features/integrations/clickup/clickup-model';
import { formatClickUpComment } from '../../features/integrations/clickup/clickup-markdown';

interface ClickUpRuntimeDependencies {
    getSettings: () => ClickUpSettings;
    saveSettings?: (settings: Partial<ClickUpSettings>) => ClickUpSettings;
    getOperatorName?: () => string;
    getJobReadableLogFilePath?: (jobName: string) => Promise<string>;
    recordActivity: (entry: {
        area: 'storage' | 'monitoring';
        level: 'info' | 'success' | 'warning' | 'error';
        message: string;
        detail?: string;
    }) => void;
    fetchImpl?: typeof fetch;
}

interface ClickUpApiWorkspace {
    id: string;
    name: string;
}

interface ClickUpApiSpace {
    id: string;
    name: string;
}

interface ClickUpApiFolder {
    id: string;
    name: string;
}

interface ClickUpApiList {
    id: string;
    name: string;
}

interface ClickUpApiUser {
    id?: string | number;
    username?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
}

interface CreateClickUpTaskOptions {
    assignToOperator?: boolean;
}

/**
 * Creates the ClickUp integration runtime used by settings and alert actions.
 */
export function createClickUpRuntime(dependencies: ClickUpRuntimeDependencies) {
    const fetcher = dependencies.fetchImpl ?? fetch;
    const apiBaseUrl = 'https://api.clickup.com/api/v2';

    function getConfiguredSettings() {
        const settings = dependencies.getSettings();

        if (!settings.enabled) {
            throw new Error('ClickUp integration is turned off in settings.');
        }

        if (!settings.apiToken) {
            throw new Error('Add a ClickUp API token in Settings before creating tasks.');
        }

        return settings;
    }

    function canAutoCreateTasks() {
        const settings = dependencies.getSettings();
        return Boolean(settings.enabled && settings.apiToken && settings.listId);
    }

    async function request<T>(settings: ClickUpSettings, pathname: string, init?: RequestInit): Promise<T> {
        const response = await fetcher(`${apiBaseUrl}${pathname}`, {
            ...init,
            headers: {
                Authorization: settings.apiToken,
                'Content-Type': 'application/json',
                ...(init?.headers ?? {})
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ClickUp API ${response.status}: ${errorText || response.statusText}`);
        }

        return response.json() as Promise<T>;
    }

    async function requestMultipart<T>(settings: ClickUpSettings, pathname: string, body: FormData): Promise<T | undefined> {
        const response = await fetcher(`${apiBaseUrl}${pathname}`, {
            method: 'POST',
            headers: {
                Authorization: settings.apiToken
            },
            body
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ClickUp API ${response.status}: ${errorText || response.statusText}`);
        }

        const responseText = await response.text();
        return responseText ? JSON.parse(responseText) as T : undefined;
    }

    async function loadTargetOptions(): Promise<ClickUpTargetOptions> {
        const settings = getConfiguredSettings();
        const workspaceResponse = await request<{ teams: ClickUpApiWorkspace[]; }>(settings, '/team');
        const workspaces = Array.isArray(workspaceResponse.teams)
            ? workspaceResponse.teams.map((workspace) => ({
                id: String(workspace.id),
                name: String(workspace.name || workspace.id)
            }))
            : [];
        const workspaceId = settings.workspaceId || workspaces[0]?.id || '';

        if (!workspaceId) {
            return {
                workspaces,
                spaces: [],
                lists: []
            };
        }

        const spacesResponse = await request<{ spaces: ClickUpApiSpace[]; }>(
            settings,
            `/team/${encodeURIComponent(workspaceId)}/space?archived=false`
        );
        const spaces = Array.isArray(spacesResponse.spaces)
            ? spacesResponse.spaces.map((space) => ({
                id: String(space.id),
                name: String(space.name || space.id)
            }))
            : [];
        const spaceId = settings.spaceId || spaces[0]?.id || '';

        if (!spaceId) {
            return {
                workspaces,
                spaces,
                lists: []
            };
        }

        const [foldersResponse, folderlessResponse] = await Promise.all([
            request<{ folders: ClickUpApiFolder[]; }>(
                settings,
                `/space/${encodeURIComponent(spaceId)}/folder?archived=false`
            ),
            request<{ lists: ClickUpApiList[]; }>(
                settings,
                `/space/${encodeURIComponent(spaceId)}/list?archived=false`
            )
        ]);

        const folders = Array.isArray(foldersResponse.folders) ? foldersResponse.folders : [];
        const folderListResponses = await Promise.all(folders.map(async (folder) => {
            const response = await request<{ lists: ClickUpApiList[]; }>(
                settings,
                `/folder/${encodeURIComponent(String(folder.id))}/list?archived=false`
            );

            return {
                folderName: String(folder.name || folder.id),
                lists: Array.isArray(response.lists) ? response.lists : []
            };
        }));

        const lists: ClickUpListOption[] = [
            ...folderListResponses.flatMap((folderResponse) => folderResponse.lists.map((list) => ({
                id: String(list.id),
                name: String(list.name || list.id),
                source: 'folder' as const,
                folderName: folderResponse.folderName
            }))),
            ...(Array.isArray(folderlessResponse.lists)
                ? folderlessResponse.lists.map((list) => ({
                    id: String(list.id),
                    name: String(list.name || list.id),
                    source: 'folderless' as const
                }))
                : [])
        ];

        return {
            workspaces,
            spaces,
            lists
        };
    }

    async function loadAuthorizedUser(settings: ClickUpSettings): Promise<ClickUpApiUser | undefined> {
        const response = await request<{ user?: ClickUpApiUser }>(settings, '/user');
        return response.user;
    }

    async function resolveConfiguredAssigneeForSettings(settings: ClickUpSettings) {
        const savedMemberId = settings.memberId?.trim() || settings.assigneeUserId?.trim();
        const configuredEmail = settings.userEmail?.trim();
        if (savedMemberId) {
            return {
                memberId: savedMemberId,
                userEmail: configuredEmail || ''
            };
        }

        if (!configuredEmail) {
            return undefined;
        }

        if (!settings.apiToken) {
            throw new Error('Add a ClickUp API token before resolving the assignee email.');
        }

        const authorizedUser = await loadAuthorizedUser(settings);
        const authorizedUserId = authorizedUser?.id ? String(authorizedUser.id) : '';
        const authorizedUserEmail = String(authorizedUser?.email ?? '').trim();
        let matchedId = authorizedUserEmail.toLowerCase() === configuredEmail.toLowerCase()
            ? authorizedUserId
            : '';

        if (!matchedId) {
            if (!settings.workspaceId) {
                throw new Error('Load ClickUp targets and select a workspace before resolving this email.');
            }

            const membersResponse = await request<{ users?: ClickUpApiUser[] }>(
                settings,
                `/team/${encodeURIComponent(settings.workspaceId)}/user`
            );
            matchedId = matchClickUpUserByEmail(configuredEmail, membersResponse.users) || '';
        }

        if (!matchedId) {
            throw new Error(`No ClickUp workspace member was found for ${configuredEmail}.`);
        }

        dependencies.saveSettings?.({
            ...settings,
            memberId: matchedId,
            assigneeUserId: matchedId,
            userEmail: configuredEmail
        });
        dependencies.recordActivity({
            area: 'storage',
            level: 'success',
            message: 'Resolved and saved the ClickUp task assignee.',
            detail: `${configuredEmail} | member ${matchedId}`
        });

        return {
            memberId: matchedId,
            userEmail: configuredEmail
        };
    }

    async function resolveConfiguredAssignee() {
        return resolveConfiguredAssigneeForSettings(dependencies.getSettings());
    }

    async function resolveOperatorAssigneeId(settings: ClickUpSettings, alert: MonitorAlert): Promise<string | undefined> {
        const operatorName = alert.owner?.trim() || dependencies.getOperatorName?.()?.trim() || '';
        if (!operatorName || !settings.workspaceId) {
            return undefined;
        }

        const membersResponse = await request<{ users?: ClickUpApiUser[] }>(
            settings,
            `/team/${encodeURIComponent(settings.workspaceId)}/user`
        );
        const matchedId = matchClickUpUserForOperator(operatorName, membersResponse.users);
        if (!matchedId) {
            return undefined;
        }

        const matchedUser = membersResponse.users?.find((user) => String(user.id ?? '') === matchedId);
        dependencies.saveSettings?.({
            ...settings,
            memberId: matchedId,
            assigneeUserId: matchedId,
            userEmail: settings.userEmail || String(matchedUser?.email ?? '').trim()
        });
        return matchedId;
    }

    async function resolveAssigneeIdForAlert(
        settings: ClickUpSettings,
        alert: MonitorAlert,
        options: CreateClickUpTaskOptions = {}
    ): Promise<string | undefined> {
        const configuredEmail = settings.userEmail?.trim();
        const operatorName = alert.owner?.trim() || dependencies.getOperatorName?.() || '';

        try {
            if (options.assignToOperator) {
                const configuredAssignee = await resolveConfiguredAssigneeForSettings(settings);
                if (configuredAssignee?.memberId) {
                    return configuredAssignee.memberId;
                }

                const operatorAssignee = await resolveOperatorAssigneeId(settings, alert);
                if (operatorAssignee) {
                    return operatorAssignee;
                }
            }

            const configuredAssignee = await resolveConfiguredAssigneeForSettings(settings);
            if (configuredAssignee?.memberId) {
                return configuredAssignee.memberId;
            }

            const authorizedUser = await loadAuthorizedUser(settings);
            const authorizedUserId = authorizedUser?.id ? String(authorizedUser.id) : '';
            const authorizedUserEmail = String(authorizedUser?.email ?? '').trim();

            if (authorizedUserId) {
                if (dependencies.saveSettings) {
                    dependencies.saveSettings({
                        ...settings,
                        memberId: authorizedUserId,
                        assigneeUserId: authorizedUserId,
                        userEmail: configuredEmail || authorizedUserEmail || settings.userEmail || ''
                    });
                }

                return authorizedUserId;
            }

            if (!settings.workspaceId || !operatorName) {
                return undefined;
            }

            const membersResponse = await request<{ users?: Array<{ id?: string | number; username?: string; email?: string; first_name?: string; last_name?: string; }> }>(
                settings,
                `/team/${encodeURIComponent(settings.workspaceId)}/user`
            );

            const matchedId = matchClickUpUserForOperator(operatorName, membersResponse.users);

            if (matchedId && dependencies.saveSettings) {
                dependencies.saveSettings({
                    ...settings,
                    memberId: matchedId,
                    assigneeUserId: matchedId,
                    userEmail: authorizedUserEmail || settings.userEmail || ''
                });
            }

            return matchedId || undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'Unable to match a ClickUp assignee for this alert.',
                detail: message
            });
            return undefined;
        }
    }

    async function createTaskForAlert(
        alert: MonitorAlert,
        options: CreateClickUpTaskOptions = {}
    ): Promise<ClickUpTaskReference> {
        const settings = getConfiguredSettings();
        if (!settings.listId) {
            throw new Error('Choose a ClickUp target list in Settings before creating tasks.');
        }

        const assigneeId = await resolveAssigneeIdForAlert(settings, alert, options);
        const response = await request<{ id: string; name?: string; url?: string; }>(
            settings,
            `/list/${encodeURIComponent(settings.listId)}/task`,
            {
                method: 'POST',
                body: JSON.stringify({
                    name: `${alert.title}${alert.jobName ? ` | ${alert.jobName}` : ''}`,
                    description: [
                        `Alert: ${alert.title}`,
                        `Job: ${alert.jobName || 'N/A'}`,
                        `Severity: ${alert.severity}`,
                        `Status: ${alert.workflowStatus}`,
                        `Owner: ${alert.owner || 'Unassigned'}`,
                        '',
                        alert.message,
                        alert.detail || ''
                    ].filter(Boolean).join('\n'),
                    ...(assigneeId ? { assignees: [assigneeId] } : {})
                })
            }
        );

        const task = {
            id: String(response.id),
            name: String(response.name || alert.title),
            url: response.url ? String(response.url) : undefined
        };

        dependencies.recordActivity({
            area: 'monitoring',
            level: 'success',
            message: 'Created a ClickUp task for the alert.',
            detail: `${alert.id} | ${task.id}`
        });

        return task;
    }

    async function addCommentToTask(taskId: string, commentText: string) {
        const settings = getConfiguredSettings();
        const normalizedText = formatClickUpComment(commentText);
        if (!normalizedText) {
            return;
        }

        await request(
            settings,
            `/task/${encodeURIComponent(taskId)}/comment`,
            {
                method: 'POST',
                body: JSON.stringify({
                    comment_text: normalizedText,
                    notify_all: false
                })
            }
        );
    }

    async function attachLogFileToTask(taskId: string, filePath: string) {
        const settings = getConfiguredSettings();
        const fileContents = await fs.readFile(filePath);
        const formData = new FormData();
        formData.append(
            'attachment',
            new Blob([fileContents], { type: 'text/plain' }),
            path.basename(filePath)
        );

        await requestMultipart(
            settings,
            `/task/${encodeURIComponent(taskId)}/attachment`,
            formData
        );
    }

    /**
     * Posts the AI incident report and attaches only the matching job history to a ClickUp task.
     */
    async function publishAlertDiagnostic(params: {
        alertId: string;
        taskId: string;
        diagnostic: string;
        jobName?: string;
    }) {
        getConfiguredSettings();
        let logFilePath: string | undefined;
        try {
            logFilePath = params.jobName && dependencies.getJobReadableLogFilePath
                ? await dependencies.getJobReadableLogFilePath(params.jobName)
                : undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'The job history log could not be prepared for ClickUp.',
                detail: `${params.alertId} | ${message}`
            });
        }

        const commentText = [
            'IBMEye diagnostic report',
            `Alert id: ${params.alertId}`,
            `Generated: ${new Date().toISOString()}`,
            '',
            params.diagnostic,
            '',
            logFilePath
                ? `Readable iMonitor log attached: ${path.basename(logFilePath)}`
                : 'No job-specific log was attached because this alert has no job history.'
        ].join('\n');

        try {
            await addCommentToTask(params.taskId, commentText);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: 'Posted the alert diagnostic to ClickUp.',
                detail: `${params.alertId} | ${params.taskId}`
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'ClickUp task created, but the alert diagnostic comment failed.',
                detail: `${params.alertId} | ${message}`
            });
        }

        if (!logFilePath) {
            return;
        }

        try {
            await attachLogFileToTask(params.taskId, logFilePath);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'success',
                message: 'Attached the job-specific iMonitor history to ClickUp.',
                detail: `${params.alertId} | ${path.basename(logFilePath)}`
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'warning',
                message: 'ClickUp task created, but the job history could not be attached.',
                detail: `${params.alertId} | ${message}`
            });
        }
    }

    async function syncAlertWorkflowComment(params: {
        alertId: string;
        action: string;
        nextState: StoredAlertWorkflowState;
        note?: string;
    }) {
        const settings = dependencies.getSettings();
        if (!settings.enabled || !settings.syncComments || !params.nextState.clickUpTask?.id) {
            return;
        }

        const owner = params.nextState.owner || 'Unassigned';
        const commentText = [
            `IBMEye alert update: ${params.action}`,
            `Alert id: ${params.alertId}`,
            `Workflow status: ${params.nextState.status}`,
            `Assigned owner: ${owner}`,
            params.nextState.lastActionSummary ? `Summary: ${params.nextState.lastActionSummary}` : '',
            params.note ? `Note: ${params.note}` : ''
        ].filter(Boolean).join('\n');

        try {
            await addCommentToTask(params.nextState.clickUpTask.id, commentText);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Posted the latest alert update to ClickUp.',
                detail: `${params.alertId} | ${params.nextState.clickUpTask.id}`
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'error',
                message: 'Unable to sync the alert update to ClickUp.',
                detail: `${params.alertId} | ${message}`
            });
        }
    }

    return {
        canAutoCreateTasks,
        loadTargetOptions,
        resolveConfiguredAssignee,
        createTaskForAlert,
        publishAlertDiagnostic,
        syncAlertWorkflowComment
    };
}
