import { ipcMain } from 'electron/main';
import {
    acceptSupportAccessGrant,
    createSupportAccessGrant,
    isClientOwner,
    listSupportAccessGrants,
    revokeSupportAccessGrant,
    supportAccessAuditDetail,
    type SupportAccessGrantInput,
    type SupportAccessGrants
} from '../../features/action-board/support-access';

interface RegisterSupportAccessIpcDependencies {
    getGrants: () => SupportAccessGrants;
    saveGrants: (grants: SupportAccessGrants) => void;
    getCurrentOperatorName: () => string;
    getClientOwnerName: () => string;
    recordActivity: (entry: { area: 'monitoring'; level: 'info' | 'error'; message: string; detail?: string }) => void;
}

function denied(message: string) {
    return { success: false as const, error: message };
}

/** Registers client-controlled delegated support access handlers. */
export function registerSupportAccessIpc(dependencies: RegisterSupportAccessIpcDependencies) {
    ipcMain.handle('get-support-access-grants', () => {
        const operator = dependencies.getCurrentOperatorName();
        const owner = isClientOwner(operator, dependencies.getClientOwnerName());
        const grants = listSupportAccessGrants(dependencies.getGrants());
        return {
            success: true,
            grants: owner ? grants : grants.filter((grant) => grant.operatorId === operator)
        };
    });

    ipcMain.handle('create-support-access-grant', (_event, payload: Partial<SupportAccessGrantInput> = {}) => {
        const operator = dependencies.getCurrentOperatorName();
        if (!isClientOwner(operator, dependencies.getClientOwnerName())) {
            return denied('Only the client owner can grant support access.');
        }

        try {
            const grant = createSupportAccessGrant({
                organizationId: payload.organizationId || 'local',
                operatorId: payload.operatorId || '',
                displayName: payload.displayName || '',
                systemIds: payload.systemIds || [],
                permissions: payload.permissions || [],
                createdBy: operator,
                expiresAt: payload.expiresAt || ''
            });
            const grants = dependencies.getGrants();
            grants[grant.id] = grant;
            dependencies.saveGrants(grants);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Support access invitation created.',
                detail: supportAccessAuditDetail(grant, operator)
            });
            return { success: true, grant };
        } catch (error) {
            return denied(error instanceof Error ? error.message : 'Unable to create support access.');
        }
    });

    ipcMain.handle('accept-support-access-grant', (_event, grantId: string) => {
        const operator = dependencies.getCurrentOperatorName();
        try {
            const grants = dependencies.getGrants();
            const grant = acceptSupportAccessGrant(grants, grantId, operator);
            dependencies.saveGrants(grants);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Support access invitation accepted.',
                detail: supportAccessAuditDetail(grant, operator)
            });
            return { success: true, grant };
        } catch (error) {
            return denied(error instanceof Error ? error.message : 'Unable to accept support access.');
        }
    });

    ipcMain.handle('revoke-support-access-grant', (_event, grantId: string) => {
        const operator = dependencies.getCurrentOperatorName();
        if (!isClientOwner(operator, dependencies.getClientOwnerName())) {
            return denied('Only the client owner can revoke support access.');
        }

        try {
            const grants = dependencies.getGrants();
            const grant = revokeSupportAccessGrant(grants, grantId, operator);
            dependencies.saveGrants(grants);
            dependencies.recordActivity({
                area: 'monitoring',
                level: 'info',
                message: 'Support access revoked.',
                detail: supportAccessAuditDetail(grant, operator)
            });
            return { success: true, grant };
        } catch (error) {
            return denied(error instanceof Error ? error.message : 'Unable to revoke support access.');
        }
    });
}
