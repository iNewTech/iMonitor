import { escapeHtml } from '../connection/shared.js';

const PERMISSIONS = ['read', 'investigate', 'execute'];

function defaultExpiryValue() {
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const offset = expiry.getTimezoneOffset();
    return new Date(expiry.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? 'Unknown expiry'
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status) {
    return status === 'active' ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1);
}

function grantMarkup(grant, currentOperator) {
    const ownInvitation = grant.operatorId === currentOperator;
    const canAccept = ownInvitation && grant.status === 'pending';
    const canRevoke = !ownInvitation && grant.status !== 'revoked';
    const actions = [
        canAccept ? `<button type="button" class="btn btn-primary-strong btn-sm" data-support-access-accept="${escapeHtml(grant.id)}">Accept</button>` : '',
        canRevoke ? `<button type="button" class="btn btn-outline-danger btn-sm" data-support-access-revoke="${escapeHtml(grant.id)}">Revoke</button>` : ''
    ].filter(Boolean).join('');

    return `
        <article class="support-access-grant" data-support-access-grant="${escapeHtml(grant.id)}">
            <div class="support-access-grant-main">
                <div class="support-access-grant-heading">
                    <strong>${escapeHtml(grant.displayName)}</strong>
                    <span class="support-access-status" data-state="${escapeHtml(grant.status)}">${escapeHtml(statusLabel(grant.status))}</span>
                </div>
                <p class="support-access-grant-id">${escapeHtml(grant.operatorId)}</p>
                <p class="support-access-grant-scope"><i class="bi bi-hdd-stack me-1" aria-hidden="true"></i>${escapeHtml(grant.systemIds.join(' · '))}</p>
                <p class="support-access-grant-scope"><i class="bi bi-shield-check me-1" aria-hidden="true"></i>${escapeHtml(grant.permissions.join(' · '))} · expires ${escapeHtml(formatDate(grant.expiresAt))}</p>
            </div>
            ${actions ? `<div class="support-access-grant-actions">${actions}</div>` : ''}
        </article>
    `;
}

/** Initializes the client-controlled support access settings surface. */
export function initSupportAccessSettings({ root, navStatus }) {
    const form = root.querySelector('#settings-support-access-form');
    const displayName = root.querySelector('#settings-support-display-name');
    const operatorId = root.querySelector('#settings-support-operator-id');
    const systems = root.querySelector('#settings-support-systems');
    const expires = root.querySelector('#settings-support-expires');
    const list = root.querySelector('#settings-support-access-list');
    const summary = root.querySelector('#settings-support-access-summary');
    const status = root.querySelector('#settings-support-access-status');
    const refreshButton = root.querySelector('#settings-support-access-refresh');
    let grants = [];
    let currentOperator = '';

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        const active = grants.filter((grant) => grant.status === 'active').length;
        if (summary) summary.textContent = `${active} active · ${grants.length} total`;
        if (navStatus) navStatus.textContent = grants.length ? `${active} active · ${grants.length} total` : 'No grants yet';
        if (list) {
            list.innerHTML = grants.length
                ? grants.map((grant) => grantMarkup(grant, currentOperator)).join('')
                : '<div class="support-access-empty"><i class="bi bi-person-plus" aria-hidden="true"></i><strong>No support grants yet</strong><span>Invitations you create will appear here.</span></div>';
        }
    }

    async function refresh() {
        setStatus('Loading support access...');
        try {
            const [result, flags, connection] = await Promise.all([
                window.electronAPI.getSupportAccessGrants(),
                window.electronAPI.getAppFlags(),
                window.electronAPI.getConnectionState()
            ]);
            if (!result.success) throw new Error(result.error || 'Unable to load support access.');
            grants = Array.isArray(result.grants) ? result.grants : [];
            currentOperator = String(flags?.operatorName || '').trim();
            if (systems && !systems.value && connection?.currentConnection?.id) {
                systems.value = connection.currentConnection.id;
            }
            render();
            setStatus('Support access is ready.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to load support access.', true);
        }
    }

    if (expires && !expires.value) expires.value = defaultExpiryValue();

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        try {
            const selectedPermissions = Array.from(form.querySelectorAll('input[name="support-permission"]:checked'))
                .map((input) => input.value)
                .filter((permission) => PERMISSIONS.includes(permission));
            const expiryDate = new Date(expires?.value || '');
            if (Number.isNaN(expiryDate.getTime())) throw new Error('Choose a valid access expiry.');
            const result = await window.electronAPI.createSupportAccessGrant({
                operatorId: operatorId?.value || '',
                displayName: displayName?.value || '',
                systemIds: (systems?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
                permissions: selectedPermissions,
                expiresAt: expiryDate.toISOString()
            });
            if (!result.success) throw new Error(result.error || 'Unable to create invitation.');
            form.reset();
            if (expires) expires.value = defaultExpiryValue();
            if (systems) systems.value = '';
            await refresh();
            setStatus('Invitation created. The named operator must accept it before access starts.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to create invitation.', true);
        } finally {
            if (button) button.disabled = false;
        }
    });

    list?.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const acceptButton = target?.closest('[data-support-access-accept]');
        const revokeButton = target?.closest('[data-support-access-revoke]');
        const grantId = acceptButton?.getAttribute('data-support-access-accept') || revokeButton?.getAttribute('data-support-access-revoke');
        if (!grantId) return;
        const action = acceptButton ? 'acceptSupportAccessGrant' : 'revokeSupportAccessGrant';
        const result = await window.electronAPI[action](grantId);
        if (!result.success) {
            setStatus(result.error || `Unable to ${acceptButton ? 'accept' : 'revoke'} access.`, true);
            return;
        }
        await refresh();
        setStatus(acceptButton ? 'Support access accepted.' : 'Support access revoked.');
    });

    refreshButton?.addEventListener('click', refresh);

    return { refresh };
}
