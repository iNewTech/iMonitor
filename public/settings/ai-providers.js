import { escapeHtml } from '../connection/shared.js';
import {
    getAiProviderOption,
    getProviderCatalog,
    getProviderModels,
    getProviderModelSourceHint
} from '../monitor/ibmeyeai/model-source.js';

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

function buildProviderCopy(provider) {
    if (!provider) {
        return '';
    }

    return `
        <div class="settings-provider-copy-card">
            <p class="control-label mb-2">${escapeHtml(provider.label)}</p>
            <p class="stat-note mb-2">${escapeHtml(provider.helper)}</p>
            <ul class="settings-provider-steps mb-0">
                ${provider.setupSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
            </ul>
        </div>
    `;
}

function buildProviderSwitcher(catalog, activeProviderId) {
    return catalog.map((provider) => {
        const isActive = provider.id === activeProviderId;
        return `
            <button
                type="button"
                class="settings-provider-tab${isActive ? ' is-active' : ''}"
                data-provider-id="${escapeHtml(provider.id)}"
                role="tab"
                aria-selected="${isActive ? 'true' : 'false'}"
            >
                <span class="settings-provider-tab-symbol" aria-hidden="true">${escapeHtml(provider.symbol || '•')}</span>
                <span>${escapeHtml(provider.label)}</span>
            </button>
        `;
    }).join('');
}

function buildProviderSummary(provider) {
    if (!provider) {
        return '';
    }

    return `
        <div class="settings-provider-summary-card">
            <p class="settings-provider-summary-title">${escapeHtml(provider.setupTitle)}</p>
            <p class="settings-provider-summary-copy">${escapeHtml(provider.docsLabel)}</p>
            <div class="settings-provider-summary-meta">
                <span class="settings-provider-chip">${escapeHtml(provider.authLabel)}</span>
                <span class="settings-provider-chip">${escapeHtml(provider.endpointLabel)}</span>
            </div>
        </div>
    `;
}

/**
 * Initializes the AI provider settings form.
 */
export function initAiProvidersSettings(dependencies) {
    const {
        root
    } = dependencies;

    const form = root.querySelector('#settings-ai-form');
    const enabledInput = root.querySelector('#settings-ai-enabled');
    const providerInput = root.querySelector('#settings-ai-provider');
    const providerSwitcher = root.querySelector('#settings-ai-provider-switcher');
    const modelInput = root.querySelector('#settings-ai-model');
    const modelLabel = root.querySelector('#settings-ai-model-label');
    const endpointInput = root.querySelector('#settings-ai-endpoint');
    const endpointLabel = root.querySelector('#settings-ai-endpoint-label');
    const apiKeyInput = root.querySelector('#settings-ai-api-key');
    const apiKeyLabel = root.querySelector('#settings-ai-api-key-label');
    const temperatureInput = root.querySelector('#settings-ai-temperature');
    const historyLimitInput = root.querySelector('#settings-ai-history-limit');
    const replyStyleInput = root.querySelector('#settings-ai-reply-style');
    const sourceHint = root.querySelector('#settings-ai-source-hint');
    const providerCopy = root.querySelector('#settings-ai-provider-copy');
    const providerSummary = root.querySelector('#settings-ai-provider-summary');
    const status = root.querySelector('#settings-ai-status');
    const summaryStatus = root.querySelector('#settings-ai-summary-status');
    const refreshButton = root.querySelector('#ai-settings-refresh');

    let snapshot = {
        providerCatalog: [],
        settings: null,
        availability: null
    };

    function setStatus(message, isError = false) {
        if (!status) {
            return;
        }

        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function render() {
        const catalog = getProviderCatalog(snapshot);
        const activeProviderId = snapshot.settings?.provider || 'ollama';
        const activeProvider = getAiProviderOption(snapshot, activeProviderId);
        const selectedModel = snapshot.settings?.model || snapshot.availability?.selectedModel || '';

        if (providerInput) {
            providerInput.value = activeProviderId;
        }
        if (providerSwitcher) {
            providerSwitcher.innerHTML = buildProviderSwitcher(catalog, activeProviderId);
        }

        if (modelInput) {
            modelInput.innerHTML = buildModelOptions(activeProviderId, snapshot, selectedModel);
            modelInput.value = selectedModel;
        }
        if (modelLabel) {
            modelLabel.textContent = activeProvider?.modelLabel || 'Model';
        }

        if (enabledInput) {
            enabledInput.checked = Boolean(snapshot.settings?.enabled);
        }
        if (endpointInput) {
            endpointInput.value = snapshot.settings?.endpoint || activeProvider?.defaultEndpoint || '';
        }
        if (endpointLabel) {
            endpointLabel.textContent = activeProvider?.endpointLabel || 'Endpoint';
        }
        if (apiKeyInput) {
            apiKeyInput.value = snapshot.settings?.apiKey || '';
            apiKeyInput.placeholder = activeProvider?.requiresApiKey
                ? activeProvider.apiKeyLabel
                : 'Not required for local providers';
            apiKeyInput.disabled = !activeProvider?.requiresApiKey;
        }
        if (apiKeyLabel) {
            apiKeyLabel.textContent = activeProvider?.apiKeyLabel || 'API key';
        }
        if (temperatureInput) {
            temperatureInput.value = String(snapshot.settings?.temperature ?? 0.2);
        }
        if (historyLimitInput) {
            historyLimitInput.value = String(snapshot.settings?.historyLimit ?? 12);
        }
        if (replyStyleInput) {
            replyStyleInput.value = snapshot.settings?.replyStyle || '';
        }
        if (sourceHint) {
            sourceHint.textContent = getProviderModelSourceHint(snapshot, activeProviderId);
        }
        if (providerCopy) {
            providerCopy.innerHTML = buildProviderCopy(activeProvider);
        }
        if (providerSummary) {
            providerSummary.innerHTML = buildProviderSummary(activeProvider);
        }
        if (summaryStatus) {
            summaryStatus.textContent = snapshot.settings?.enabled
                ? `${activeProvider?.label || 'AI'} · ${selectedModel || 'provider default'}`
                : 'Disabled';
        }
    }

    async function refresh() {
        setStatus('Loading AI provider settings...');

        try {
            const [providerCatalog, settings, availability] = await Promise.all([
                window.electronAPI.getAiProviderCatalog(),
                window.electronAPI.getAiSettings(),
                window.electronAPI.getAiAvailability()
            ]);
            snapshot = {
                providerCatalog: Array.isArray(providerCatalog) ? providerCatalog : [],
                settings,
                availability
            };
            render();
            setStatus(availability?.message || 'AI settings loaded.');
        } catch (error) {
            setStatus(
                error instanceof Error ? error.message : 'Unable to load AI settings.',
                true
            );
        }
    }

    function selectProvider(provider) {
        const providerOption = getAiProviderOption(snapshot, provider);
        if (!providerOption) {
            return;
        }

        snapshot.settings = {
            ...snapshot.settings,
            provider,
            endpoint: providerOption.defaultEndpoint,
            model: ''
        };
        render();
    }

    providerSwitcher?.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const tab = target.closest('[data-provider-id]');
        if (!(tab instanceof HTMLElement)) {
            return;
        }

        selectProvider(tab.dataset.providerId || 'ollama');
    });

    refreshButton?.addEventListener('click', () => {
        void refresh();
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving AI settings...');

        try {
            await window.electronAPI.saveAiSettings({
                enabled: Boolean(enabledInput?.checked),
                provider: providerInput?.value || 'ollama',
                endpoint: endpointInput?.value || '',
                apiKey: apiKeyInput?.value || '',
                model: modelInput?.value || '',
                temperature: Number.parseFloat(temperatureInput?.value || '0.2'),
                historyLimit: Number.parseInt(historyLimitInput?.value || '12', 10),
                replyStyle: replyStyleInput?.value || ''
            });
            await refresh();
            setStatus('AI settings saved.');
        } catch (error) {
            setStatus(
                error instanceof Error ? error.message : 'Unable to save AI settings.',
                true
            );
        }
    });

    return {
        refresh
    };
}
