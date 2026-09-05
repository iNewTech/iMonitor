import { loadIBMEyeAiPreferences, saveIBMEyeAiPreferences } from './prefs.js';
import {
    buildIncidentSummaryPrompt,
    buildSelectedJobHealthPrompt,
    buildShiftHandoffPrompt,
    buildSqlActivityPrompt
} from './action-prompts.js';
import {
    getAiProviderOption,
    getProviderCatalog,
    getProviderModels,
    getProviderModelSourceHint
} from './model-source.js';
import { buildAiTranscriptMarkup } from './render.js';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
        {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;'
        }[char]
    ));
}

function buildModelOptions(providerId, snapshot, selectedModel) {
    const models = getProviderModels(snapshot, providerId);
    const options = ['<option value="">Auto-select provider default</option>'];

    for (const model of models) {
        options.push(`<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`);
    }

    if (selectedModel && !models.includes(selectedModel)) {
        options.push(`<option value="${escapeHtml(selectedModel)}">${escapeHtml(selectedModel)}</option>`);
    }

    return options.join('');
}

function buildProviderSwitcherMarkupFromCatalog(catalog, activeProviderId) {
    return catalog.map((provider) => `
        <button
            type="button"
            class="ai-provider-switch ${provider.id === activeProviderId ? 'is-active' : ''}"
            data-provider-switch="${provider.id}"
            aria-pressed="${provider.id === activeProviderId}"
        >
            <span class="ai-provider-switch-symbol" aria-hidden="true">${escapeHtml(provider.symbol)}</span>
            <span class="ai-provider-switch-label">${escapeHtml(provider.label)}</span>
        </button>
    `).join('');
}

function buildProviderPanelMarkup(provider, snapshot) {
    const selectedModel = snapshot.settings?.model || snapshot.availability?.selectedModel || '';
    const endpoint = snapshot.settings?.provider === provider.id
        ? snapshot.settings?.endpoint || provider.defaultEndpoint
        : provider.defaultEndpoint;
    const apiKey = snapshot.settings?.provider === provider.id
        ? snapshot.settings?.apiKey || ''
        : '';
    const helperSteps = provider.setupSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');

    return `
        <section class="ai-provider-card" data-provider-card="${escapeHtml(provider.id)}">
            <header class="ai-provider-card-header">
                <div class="ai-provider-card-title-row">
                    <span class="ai-provider-card-symbol" aria-hidden="true">${escapeHtml(provider.symbol)}</span>
                    <div>
                        <h3 class="ai-provider-card-title">${escapeHtml(provider.label)}</h3>
                        <p class="stat-note mb-0">${escapeHtml(provider.setupTitle)}</p>
                    </div>
                </div>
                <div class="ai-provider-card-meta">
                    <span class="table-caption">${escapeHtml(provider.authLabel)}</span>
                    <span class="table-caption">${escapeHtml(provider.docsLabel)}</span>
                </div>
            </header>

            <div class="ai-provider-card-grid">
                <article class="ai-provider-note-card">
                    <p class="control-label mb-2">Setup use</p>
                    <p class="stat-note mb-0">${escapeHtml(provider.helper)}</p>
                </article>
                <article class="ai-provider-note-card">
                    <p class="control-label mb-2">How IBMEye uses it</p>
                    <ul class="ai-provider-steps mb-0">${helperSteps}</ul>
                </article>
            </div>

            <div class="control-select">
                <label for="ai-provider-endpoint" class="control-label">${escapeHtml(provider.endpointLabel)}</label>
                <input
                    type="text"
                    id="ai-provider-endpoint"
                    class="form-control"
                    value="${escapeHtml(endpoint)}"
                    autocomplete="off"
                >
            </div>

            ${provider.requiresApiKey ? `
                <div class="control-select">
                    <label for="ai-provider-api-key" class="control-label">${escapeHtml(provider.apiKeyLabel)}</label>
                    <input
                        type="password"
                        id="ai-provider-api-key"
                        class="form-control"
                        value="${escapeHtml(apiKey)}"
                        autocomplete="off"
                    >
                </div>
            ` : ''}

            <div class="control-select">
                <label for="ai-provider-model" class="control-label">${escapeHtml(provider.modelLabel)}</label>
                <select id="ai-provider-model" class="form-select">
                    ${buildModelOptions(provider.id, snapshot, selectedModel)}
                </select>
            </div>

        </section>
    `;
}

export function initIBMEyeAiPanel(dependencies) {
    const {
        root,
        aiState
    } = dependencies;

    const transcriptShell = root.querySelector('#ai-chat-shell');
    const transcript = root.querySelector('#ai-chat-transcript');
    const status = root.querySelector('#ai-assistant-status');
    const availabilityBadge = root.querySelector('#ai-availability-badge');
    const modelBadge = root.querySelector('#ai-model-badge');
    const providerQuickInput = root.querySelector('#ai-provider-quick');
    const modelQuickInput = root.querySelector('#ai-model-quick');
    const modelSourceHint = root.querySelector('#ai-provider-model-source');
    const form = root.querySelector('#ai-assistant-form');
    const input = root.querySelector('#ai-assistant-input');
    const promptButtons = Array.from(root.querySelectorAll('.ai-prompt-chip'));
    const settingsForm = root.querySelector('#ai-settings-form');
    const enabledInput = root.querySelector('#ai-enabled');
    const providerSwitcher = root.querySelector('#ai-provider-switcher');
    const providerPanel = root.querySelector('#ai-provider-panel');
    const temperatureInput = root.querySelector('#ai-temperature');
    const replyStyleInput = root.querySelector('#ai-reply-style');

    if (!transcript || !status || !input) {
        return {
            destroy() {}
        };
    }

    let preferences = loadIBMEyeAiPreferences();

    if (transcriptShell) {
        transcriptShell.style.height = `${preferences.transcriptHeight}px`;
    }

    function getActiveProviderId(snapshot) {
        return snapshot.settings?.provider || 'ollama';
    }

    function setBusy(busy) {
        input.disabled = busy;
        promptButtons.forEach((button) => {
            button.disabled = busy;
        });
        if (providerQuickInput) {
            providerQuickInput.disabled = busy;
        }
        if (modelQuickInput) {
            modelQuickInput.disabled = busy;
        }
    }

    function submitAssistantPrompt(message) {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            input.focus();
            return;
        }

        if (aiState.getSnapshot().pendingReply) {
            return;
        }

        input.value = '';
        void aiState.submitPrompt(normalizedMessage);
    }

    function syncTopToolbar(snapshot) {
        if (!providerQuickInput || !modelQuickInput) {
            return;
        }

        const activeProviderId = getActiveProviderId(snapshot);
        const catalog = getProviderCatalog(snapshot);
        providerQuickInput.innerHTML = catalog.map((provider) => (
            `<option value="${provider.id}">${provider.label}</option>`
        )).join('');
        providerQuickInput.value = activeProviderId;

        const selectedModel = snapshot.settings?.model || snapshot.availability?.selectedModel || '';
        modelQuickInput.innerHTML = buildModelOptions(activeProviderId, snapshot, selectedModel);
        modelQuickInput.value = selectedModel;

        if (modelSourceHint) {
            modelSourceHint.textContent = getProviderModelSourceHint(snapshot, activeProviderId);
        }
    }

    function renderSettingsWorkspace(snapshot) {
        if (!providerPanel) {
            return;
        }

        const activeProviderId = getActiveProviderId(snapshot);
        const catalog = getProviderCatalog(snapshot);
        const provider = getAiProviderOption(snapshot, activeProviderId);
        if (!provider) {
            return;
        }

        if (providerSwitcher) {
            providerSwitcher.innerHTML = buildProviderSwitcherMarkupFromCatalog(catalog, activeProviderId);
        }

        providerPanel.innerHTML = buildProviderPanelMarkup(provider, snapshot);

        const providerModelInput = providerPanel.querySelector('#ai-provider-model');
        if (providerModelInput) {
            providerModelInput.value = snapshot.settings?.model || snapshot.availability?.selectedModel || '';
        }
    }

    function render(snapshot) {
        transcript.innerHTML = buildAiTranscriptMarkup(
            snapshot.conversation,
            snapshot.pendingReply,
            snapshot.availability?.selectedModel || ''
        );
        transcript.scrollTop = transcript.scrollHeight;

        setBusy(snapshot.pendingReply);
        status.textContent = snapshot.statusMessage;
        status.style.color = snapshot.statusIsError ? 'var(--danger)' : 'var(--muted)';

        if (availabilityBadge) {
            availabilityBadge.textContent = snapshot.availability?.healthy
                ? `${snapshot.availability.providerLabel} ready`
                : `${snapshot.availability?.providerLabel || 'Provider'} unavailable`;
        }

        if (modelBadge) {
            modelBadge.textContent = snapshot.availability?.selectedModel || 'No model';
        }

        if (enabledInput) {
            enabledInput.checked = Boolean(snapshot.settings?.enabled);
        }
        if (temperatureInput) {
            temperatureInput.value = String(snapshot.settings?.temperature ?? 0.2);
        }
        if (replyStyleInput) {
            replyStyleInput.value = snapshot.settings?.replyStyle || '';
        }

        syncTopToolbar(snapshot);
        renderSettingsWorkspace(snapshot);
    }

    const unsubscribe = aiState.subscribe(render);

    const resizeObserver = transcriptShell
        ? new ResizeObserver((entries) => {
            const nextEntry = entries[0];
            if (!nextEntry) {
                return;
            }

            preferences = saveIBMEyeAiPreferences({
                ...preferences,
                transcriptHeight: nextEntry.contentRect.height
            });
        })
        : null;

    resizeObserver?.observe(transcriptShell);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitAssistantPrompt(input.value || '');
    });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }

        event.preventDefault();
        submitAssistantPrompt(input.value || '');
    });

    promptButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const promptType = button.dataset.aiPromptType || '';
            const fallbackPrompt = button.dataset.aiPrompt || '';

            const prompt = promptType === 'incident-summary'
                ? buildIncidentSummaryPrompt()
                : promptType === 'shift-handoff'
                    ? buildShiftHandoffPrompt()
                    : promptType === 'sql-activity'
                        ? buildSqlActivityPrompt()
                        : promptType === 'job-health'
                            ? buildSelectedJobHealthPrompt(dependencies.getSelectedJobName?.())
                            : fallbackPrompt;

            submitAssistantPrompt(prompt);
        });
    });

    providerQuickInput?.addEventListener('change', () => {
        const provider = providerQuickInput.value;
        const providerOption = getAiProviderOption(aiState.getSnapshot(), provider);
        if (!providerOption) {
            return;
        }
        void aiState.saveSettings({
            provider,
            endpoint: providerOption.defaultEndpoint,
            model: ''
        });
    });

    modelQuickInput?.addEventListener('change', () => {
        void aiState.saveSettings({
            model: modelQuickInput.value || ''
        });
    });

    providerSwitcher?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-provider-switch]');
        if (!button) {
            return;
        }

        const provider = button.getAttribute('data-provider-switch') || 'ollama';
        const providerOption = getAiProviderOption(aiState.getSnapshot(), provider);
        if (!providerOption) {
            return;
        }
        void aiState.saveSettings({
            provider,
            endpoint: providerOption.defaultEndpoint,
            model: ''
        });
    });

    settingsForm?.addEventListener('submit', (event) => {
        event.preventDefault();

        const provider = providerQuickInput?.value || 'ollama';
        const endpointInput = providerPanel.querySelector('#ai-provider-endpoint');
        const apiKeyInput = providerPanel.querySelector('#ai-provider-api-key');
        const modelInput = providerPanel.querySelector('#ai-provider-model');
        const providerOption = getAiProviderOption(aiState.getSnapshot(), provider);

        void aiState.saveSettings({
            enabled: Boolean(enabledInput?.checked),
            provider,
            endpoint: endpointInput?.value || providerOption?.defaultEndpoint || '',
            apiKey: apiKeyInput?.value || '',
            model: modelInput?.value || '',
            temperature: Number.parseFloat(temperatureInput?.value || '0.2'),
            replyStyle: replyStyleInput?.value || ''
        });
    });

    return {
        destroy() {
            unsubscribe();
            resizeObserver?.disconnect();
        }
    };
}
