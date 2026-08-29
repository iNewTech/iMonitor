import type { MonitorAlert, StoredAlertWorkflowState } from '../../features/alerts/alert-model';
import {
    matchClickUpUserByEmail,
    matchClickUpUserForOperator,
    type ClickUpListOption,
    type ClickUpSettings,
    type ClickUpTargetOptions,
    type ClickUpTaskReference
} from '../../features/integrations/clickup/clickup-model';

interface ClickUpRuntimeDependencies {
    getSettings: () => ClickUpSettings;
    saveSettings?: (settings: Partial<ClickUpSettings>) => ClickUpSettings;
    getOperatorName?: () => string;
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

    async function resolveAssigneeIdForAlert(settings: ClickUpSettings, alert: MonitorAlert): Promise<string | undefined> {
        const savedMemberId = settings.memberId?.trim() || settings.assigneeUserId?.trim();
        if (savedMemberId) {
            return savedMemberId;
        }

        const configuredEmail = settings.userEmail?.trim();
        const operatorName = alert.owner?.trim() || dependencies.getOperatorName?.() || '';
        if (!settings.workspaceId || (!configuredEmail && !operatorName)) {
            return undefined;
        }

        try {
            const membersResponse = await request<{ users?: Array<{ id?: string | number; username?: string; email?: string; first_name?: string; last_name?: string; }> }>(
                settings,
                `/team/${encodeURIComponent(settings.workspaceId)}/user`
            );

            const matchedId = configuredEmail
                ? matchClickUpUserByEmail(configuredEmail, membersResponse.users)
                : matchClickUpUserForOperator(operatorName, membersResponse.users);

            if (matchedId && dependencies.saveSettings) {
                dependencies.saveSettings({
                    ...settings,
                    memberId: matchedId,
                    assigneeUserId: matchedId,
                    userEmail: configuredEmail || settings.userEmail || ''
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

    async function createTaskForAlert(alert: MonitorAlert): Promise<ClickUpTaskReference> {
        const settings = getConfiguredSettings();
        if (!settings.listId) {
            throw new Error('Choose a ClickUp target list in Settings before creating tasks.');
        }

        const assigneeId = await resolveAssigneeIdForAlert(settings, alert);
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
        const normalizedText = String(commentText || '').trim();
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
        loadTargetOptions,
        createTaskForAlert,
        syncAlertWorkflowComment
    };
}
