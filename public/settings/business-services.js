const ALERT_KINDS = new Set(['highCpu', 'messageWait', 'lockWait', 'delayWait', 'dequeueWait', 'pollFailure']);

/** Manages customer-owned business service mappings without exposing store details to the page. */
export function initBusinessServiceSettings({ root }) {
    const form = root.querySelector('#settings-business-service-form');
    const status = root.querySelector('#settings-business-service-status');
    const summary = root.querySelector('#settings-business-services-summary');
    const list = root.querySelector('#settings-business-service-list');
    let settings = { mappings: [] };

    const field = (id) => root.querySelector(`#${id}`);
    const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    };

    function render() {
        if (summary) summary.textContent = settings.mappings.length ? `${settings.mappings.length} mapping${settings.mappings.length === 1 ? '' : 's'}` : 'No mappings';
        if (!list) return;
        list.replaceChildren();
        if (!settings.mappings.length) {
            const empty = document.createElement('p');
            empty.className = 'stat-note mb-0';
            empty.textContent = 'No business mapping configured. Technical impact will remain explicitly unknown.';
            list.append(empty);
            return;
        }
        settings.mappings.forEach((mapping) => {
            const card = document.createElement('article');
            card.className = 'business-service-mapping-item';
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = mapping.serviceName;
            const detail = document.createElement('small');
            detail.textContent = `${mapping.owner} · ${mapping.systemIds.join(', ') || 'all systems'} · ${mapping.jobPattern || mapping.resourcePattern || mapping.queuePattern || mapping.subsystemPattern || 'no resource match'}`;
            copy.append(title, detail);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-outline-danger btn-sm';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => removeMapping(mapping.id));
            card.append(copy, remove);
            list.append(card);
        });
    }

    async function refresh() {
        setStatus('Loading business mappings...');
        try {
            settings = await window.electronAPI.getBusinessServiceSettings();
            render();
            setStatus('Business mappings are ready.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to load business mappings.', true);
        }
    }

    async function save() {
        try {
            settings = await window.electronAPI.saveBusinessServiceSettings(settings);
            render();
            setStatus('Business service mapping saved.');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save business mapping.', true);
        }
    }

    async function removeMapping(id) {
        settings = { mappings: settings.mappings.filter((mapping) => mapping.id !== id) };
        await save();
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const serviceName = field('settings-business-service-name')?.value.trim();
        const owner = field('settings-business-service-owner')?.value.trim();
        const patterns = [
            field('settings-business-service-job')?.value.trim(),
            field('settings-business-service-resource')?.value.trim(),
            field('settings-business-service-queue')?.value.trim(),
            field('settings-business-service-subsystem')?.value.trim()
        ];
        if (!serviceName || !owner || !patterns.some(Boolean)) {
            setStatus('Add a service, owner, and at least one matching pattern.', true);
            return;
        }
        const deadline = Number(field('settings-business-service-deadline')?.value);
        const timezone = field('settings-business-service-timezone')?.value.trim();
        const days = parseList(field('settings-business-service-days')?.value);
        const startMinute = parseTime(field('settings-business-service-start')?.value);
        const endMinute = parseTime(field('settings-business-service-end')?.value);
        const alertKinds = String(field('settings-business-service-alert-kinds')?.value || '')
            .split(',').map((kind) => kind.trim()).filter((kind) => ALERT_KINDS.has(kind));
        settings = { mappings: [...settings.mappings, {
            id: `mapping-${Date.now()}`,
            serviceName,
            owner,
            systemIds: parseStrings(field('settings-business-service-systems')?.value),
            alertKinds,
            jobPattern: patterns[0],
            resourcePattern: patterns[1],
            queuePattern: patterns[2],
            subsystemPattern: patterns[3],
            priority: 0,
            deadlineMinutes: Number.isFinite(deadline) && deadline >= 1 ? deadline : undefined,
            expectedSchedule: timezone && days.length ? { timezone, days, startMinute, endMinute } : undefined
        }] };
        await save();
        form.reset();
        field('settings-business-service-start').value = '09:00';
        field('settings-business-service-end').value = '18:00';
    });

    render();
    return { refresh };
}

function parseStrings(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseList(value) {
    return Array.from(new Set(parseStrings(value).map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))).sort((a, b) => a - b);
}

function parseTime(value) {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? Math.max(0, Math.min(1439, hours * 60 + minutes)) : 0;
}
