const byId = (root, id) => root.getElementById(id);

function text(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function manifestOf(item) {
    return item?.manifest || item || {};
}

function labelFor(item) {
    return text(manifestOf(item).name, 'Unnamed capability');
}

function iconFor(item) {
    return manifestOf(item).kind === 'mcp-connection' ? 'bi-diagram-3' : 'bi-puzzle';
}

function makeElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
}

function makeChip(value, className = '') {
    return makeElement('span', `settings-mcp-chip ${className}`.trim(), value);
}

function itemId(item) {
    return text(manifestOf(item).id);
}

export function initMcpSkillsSettings({ root = document, navStatus } = {}) {
    const summary = byId(root, 'settings-mcp-summary');
    const status = byId(root, 'settings-mcp-status');
    const dialog = byId(root, 'settings-mcp-dialog');
    const form = byId(root, 'settings-mcp-form');
    const dialogTitle = byId(root, 'settings-mcp-dialog-title');
    const dialogCopy = byId(root, 'settings-mcp-dialog-copy');
    const dialogMeta = byId(root, 'settings-mcp-dialog-meta');
    const dialogCapabilities = byId(root, 'settings-mcp-dialog-capabilities');
    const dialogHealth = byId(root, 'settings-mcp-dialog-health');
    const endpointField = byId(root, 'settings-mcp-endpoint-field');
    const endpoint = byId(root, 'settings-mcp-endpoint');
    const installButton = byId(root, 'settings-mcp-install');
    const testButton = byId(root, 'settings-mcp-test');
    const toggleButton = byId(root, 'settings-mcp-toggle');
    const revokeButton = byId(root, 'settings-mcp-revoke');
    const saveButton = byId(root, 'settings-mcp-save');
    const lists = {
        installedSkills: byId(root, 'settings-mcp-installed-skills'),
        installedConnections: byId(root, 'settings-mcp-installed-connections'),
        availableSkills: byId(root, 'settings-mcp-available-skills'),
        availableConnections: byId(root, 'settings-mcp-available-connections')
    };
    const counts = {
        installedSkills: byId(root, 'settings-mcp-installed-skill-count'),
        installedConnections: byId(root, 'settings-mcp-installed-connection-count'),
        availableSkills: byId(root, 'settings-mcp-available-skill-count'),
        availableConnections: byId(root, 'settings-mcp-available-connection-count')
    };
    let snapshot = { installed: [], available: [] };
    let selected = null;

    function setStatus(message, isError = false) {
        if (status) {
            status.textContent = message;
            status.dataset.state = isError ? 'error' : 'ready';
        }
    }

    function card(item, available) {
        const manifest = manifestOf(item);
        const wrapper = makeElement('article', 'settings-mcp-card');
        wrapper.dataset.mcpId = itemId(item);
        const icon = makeElement('span', 'settings-mcp-card-icon');
        icon.append(makeElement('i', `bi ${iconFor(item)}`));
        const content = makeElement('div', 'settings-mcp-card-content');
        content.append(makeElement('strong', '', labelFor(item)));
        content.append(makeElement('small', '', `v${text(manifest.version, 'unknown')} · ${text(manifest.owner, 'unknown owner')}`));
        const chips = makeElement('div', 'settings-mcp-card-chips');
        chips.append(makeChip(text(manifest.capabilityClass, 'unknown')));
        chips.append(makeChip(text(manifest.transport, 'unknown')));
        if (!available) chips.append(makeChip(text(item.status, 'unknown'), `is-${text(item.status, 'unknown')}`));
        content.append(chips);
        const action = makeElement('button', 'btn btn-outline-ink btn-sm', available ? 'Inspect' : 'Manage');
        action.type = 'button';
        action.dataset.mcpAction = 'inspect';
        action.dataset.mcpId = itemId(item);
        action.setAttribute('aria-label', `${available ? 'Inspect' : 'Manage'} ${labelFor(item)}`);
        wrapper.append(icon, content, action);
        return wrapper;
    }

    function renderList(target, items, available, countTarget) {
        if (!target) return;
        target.replaceChildren();
        items.forEach((item) => target.append(card(item, available)));
        if (!items.length) target.append(makeElement('p', 'settings-mcp-empty', available ? 'No approved capabilities available.' : 'None installed.'));
        if (countTarget) countTarget.textContent = String(items.length);
    }

    function render() {
        const installedSkills = snapshot.installed.filter((item) => manifestOf(item).kind === 'skill');
        const installedConnections = snapshot.installed.filter((item) => manifestOf(item).kind === 'mcp-connection');
        const availableSkills = snapshot.available.filter((item) => manifestOf(item).kind === 'skill');
        const availableConnections = snapshot.available.filter((item) => manifestOf(item).kind === 'mcp-connection');
        renderList(lists.installedSkills, installedSkills, false, counts.installedSkills);
        renderList(lists.installedConnections, installedConnections, false, counts.installedConnections);
        renderList(lists.availableSkills, availableSkills, true, counts.availableSkills);
        renderList(lists.availableConnections, availableConnections, true, counts.availableConnections);
        const installedCount = snapshot.installed.length;
        const availableCount = snapshot.available.length;
        if (summary) summary.textContent = `${installedCount} installed · ${availableCount} available`;
        if (navStatus) navStatus.textContent = installedCount ? `${installedCount} installed · ${availableCount} available` : `${availableCount} available to install`;
    }

    function findCapability(id, available) {
        const items = available ? snapshot.available : snapshot.installed;
        return items.find((item) => itemId(item) === id) || null;
    }

    function renderDialog() {
        if (!selected) return;
        const manifest = manifestOf(selected.item);
        const installed = !selected.available;
        const health = installed ? selected.item.health || {} : {};
        if (dialogTitle) dialogTitle.textContent = labelFor(selected.item);
        if (dialogCopy) dialogCopy.textContent = `${text(manifest.provider, 'Unknown provider')} · ${text(manifest.transport, 'Unknown transport')} · ${selected.available ? 'Approved and available to install.' : 'Installed locally for this customer.'}`;
        if (dialogMeta) {
            dialogMeta.replaceChildren(
                makeChip(`v${text(manifest.version, 'unknown')}`),
                makeChip(`Owner: ${text(manifest.owner, 'unknown')}`),
                makeChip(`Scope: ${Array.isArray(manifest.scopes) ? manifest.scopes.join(', ') : 'unknown'}`),
                makeChip(text(manifest.approvalClass, 'operator approval'))
            );
        }
        if (dialogCapabilities) {
            const capabilities = [
                ...(Array.isArray(manifest.tools) ? manifest.tools.map((value) => `tool: ${value}`) : []),
                ...(Array.isArray(manifest.resources) ? manifest.resources.map((value) => `resource: ${value}`) : []),
                ...(Array.isArray(manifest.prompts) ? manifest.prompts.map((value) => `prompt: ${value}`) : [])
            ];
            const permissions = Array.isArray(manifest.requiredPermissions) ? manifest.requiredPermissions.join(', ') : 'unknown';
            const evidence = Array.isArray(manifest.evidenceRequirements) ? manifest.evidenceRequirements.join(', ') : 'none declared';
            dialogCapabilities.textContent = `${capabilities.length ? `Instructions and capabilities: ${capabilities.join(' · ')}` : 'Read-only capability with no direct action tools.'} · Permissions: ${permissions} · Evidence: ${evidence}`;
        }
        if (endpointField) endpointField.hidden = manifest.transport === 'local';
        if (endpoint) {
            endpoint.value = text(selected.item.configuration?.endpoint);
            endpoint.disabled = selected.available || manifest.transport === 'local';
        }
        if (dialogHealth) {
            const healthAt = text(health.checkedAt, 'not checked');
            const activity = text(selected.item.activity?.action, 'No activity recorded.');
            dialogHealth.textContent = installed
                ? `${text(health.state, 'unknown')}: ${text(health.message, 'Health has not been checked.')} Last health: ${healthAt}. Last activity: ${activity}.`
                : 'Install first, then configure and run a safe read-only test.';
        }
        if (installButton) installButton.hidden = !selected.available;
        if (testButton) testButton.hidden = selected.available;
        if (toggleButton) {
            toggleButton.hidden = selected.available;
            toggleButton.textContent = selected.item.status === 'enabled' ? 'Disable' : 'Enable';
            toggleButton.disabled = selected.item.status === 'revoked';
        }
        if (revokeButton) revokeButton.hidden = selected.available;
        if (saveButton) saveButton.hidden = selected.available || manifest.transport === 'local';
    }

    function open(id, available) {
        const item = findCapability(id, available);
        if (!item) return;
        selected = { item, available };
        renderDialog();
        if (dialog && !dialog.open) dialog.showModal();
    }

    function updateFromResponse(response, message) {
        if (!response?.success) {
            setStatus(text(response?.error, message || 'Operation failed.'), true);
            return false;
        }
        snapshot = { installed: Array.isArray(response.installed) ? response.installed : [], available: Array.isArray(response.available) ? response.available : [] };
        render();
        setStatus(message || 'Skills and MCP registry updated.');
        return true;
    }

    async function run(operation, message) {
        try {
            const response = await operation();
            return updateFromResponse(response, message);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Operation failed.', true);
            return false;
        }
    }

    root.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-mcp-action]') : null;
        if (!target) return;
        event.preventDefault();
        const available = target.closest('#settings-mcp-available-skills, #settings-mcp-available-connections') !== null;
        open(target.dataset.mcpId || '', available);
    });

    byId(root, 'settings-mcp-close')?.addEventListener('click', () => dialog?.close());
    dialog?.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    installButton?.addEventListener('click', async () => {
        if (!selected?.available || !window.electronAPI?.installMcpCapability) return;
        const installed = await run(() => window.electronAPI.installMcpCapability(manifestOf(selected.item)), 'Capability installed. It is disabled until you enable it.');
        if (installed) {
            const id = itemId(selected.item);
            selected = { item: findCapability(id, false), available: false };
            renderDialog();
        }
    });
    toggleButton?.addEventListener('click', async () => {
        if (!selected || selected.available || !window.electronAPI?.setMcpCapabilityEnabled) return;
        const enabled = selected.item.status !== 'enabled';
        if (await run(() => window.electronAPI.setMcpCapabilityEnabled({ id: itemId(selected.item), enabled }), enabled ? 'Capability enabled.' : 'Capability disabled.')) {
            selected = { item: findCapability(itemId(selected.item), false), available: false };
            renderDialog();
        }
    });
    testButton?.addEventListener('click', async () => {
        if (!selected || selected.available || !window.electronAPI?.testMcpCapability) return;
        if (await run(() => window.electronAPI.testMcpCapability(itemId(selected.item)), 'Safe read-only test completed.')) {
            selected = { item: findCapability(itemId(selected.item), false), available: false };
            renderDialog();
        }
    });
    revokeButton?.addEventListener('click', async () => {
        if (!selected || selected.available || !window.electronAPI?.revokeMcpCapability) return;
        if (await run(() => window.electronAPI.revokeMcpCapability(itemId(selected.item)), 'Capability revoked.')) {
            selected = { item: findCapability(itemId(selected.item), false), available: false };
            renderDialog();
        }
    });
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selected || selected.available || !window.electronAPI?.configureMcpCapability) return;
        if (await run(() => window.electronAPI.configureMcpCapability({ id: itemId(selected.item), endpoint: text(endpoint?.value) }), 'Configuration saved.')) {
            selected = { item: findCapability(itemId(selected.item), false), available: false };
            renderDialog();
        }
    });

    async function refresh() {
        if (!window.electronAPI?.getMcpRegistry) return;
        setStatus('Skills are loading.');
        try {
            const response = await window.electronAPI.getMcpRegistry();
            if (updateFromResponse(response, 'Skills and MCP registry ready.')) return;
            render();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Skills could not be loaded.', true);
        }
    }

    render();
    return { refresh };
}
