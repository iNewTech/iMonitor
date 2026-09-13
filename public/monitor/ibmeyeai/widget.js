import { loadIBMEyeAiPreferences, saveIBMEyeAiPreferences } from './prefs.js';
import {
    canUseProvider,
    getAiProviderOption,
    getProviderCatalog,
    getProviderModels,
    getProviderModelSourceHint
} from './model-source.js';
import { buildAiTranscriptMarkup } from './render.js';

function setElementText(element, value) {
    if (element) {
        element.textContent = value;
    }
}

/**
 * Initializes the floating IBMEye AI launcher and popout chat.
 */
export function initIBMEyeAiWidget(dependencies) {
    const {
        root,
        aiState
    } = dependencies;

    const widget = root.querySelector('#ibmeyeai-widget');
    const launcher = root.querySelector('#ibmeyeai-launcher');
    const launcherArt = root.querySelector('#ibmeyeai-launcher-art');
    const popout = root.querySelector('#ibmeyeai-popout');
    const closeButton = root.querySelector('#ibmeyeai-widget-close');
    const providerInput = root.querySelector('#ibmeyeai-widget-provider');
    const modelInput = root.querySelector('#ibmeyeai-widget-model');
    const modelSource = root.querySelector('#ibmeyeai-widget-model-source');
    const transcript = root.querySelector('#ibmeyeai-widget-transcript');
    const status = root.querySelector('#ibmeyeai-widget-status');
    const form = root.querySelector('#ibmeyeai-widget-form');
    const input = root.querySelector('#ibmeyeai-widget-input');
    const submitButton = root.querySelector('#ibmeyeai-widget-submit');

    if (!widget || !launcher || !popout || !providerInput || !modelInput || !transcript || !status || !form || !input || !submitButton) {
        return {
            destroy() {}
        };
    }

    let preferences = loadIBMEyeAiPreferences();

    function applyOpenState() {
        widget.dataset.open = String(preferences.widgetOpen);
        launcher.setAttribute('aria-expanded', String(preferences.widgetOpen));
        popout.setAttribute('aria-hidden', String(!preferences.widgetOpen));
        if (launcherArt) {
            launcherArt.src = preferences.widgetOpen
                ? 'assets/ibmeyeai-eye-open.svg'
                : 'assets/ibmeyeai-eye-closed.svg';
        }
    }

    function applySize() {
        popout.style.width = `${preferences.widgetWidth}px`;
        popout.style.height = `${preferences.widgetHeight}px`;
    }

    function setBusy(busy) {
        input.disabled = busy;
        submitButton.disabled = busy;
        submitButton.innerHTML = busy
            ? '<i class="bi bi-hourglass-split"></i>'
            : '<i class="bi bi-send-fill"></i>';
    }

    function render(snapshot) {
        const providerMarkup = getProviderCatalog(snapshot).map((provider) => (
            `<option value="${provider.id}" ${canUseProvider(snapshot, provider.id) ? '' : 'disabled'}>${provider.symbol} ${provider.label}</option>`
        )).join('');
        providerInput.innerHTML = providerMarkup;
        providerInput.value = snapshot.settings?.provider || 'ollama';

        const activeProvider = snapshot.settings?.provider || 'ollama';
        const selectedModel = snapshot.settings?.model || snapshot.availability?.selectedModel || '';
        const modelNames = getProviderModels(snapshot, activeProvider);
        modelInput.innerHTML = modelNames.length
            ? [
                '<option value="">Auto-select provider default</option>',
                ...modelNames.map((model) => `<option value="${model}">${model}</option>`)
            ].join('')
            : '<option value="" selected disabled>Set up a model first</option>';
        modelInput.value = selectedModel;
        modelInput.disabled = snapshot.pendingReply || !canUseProvider(snapshot, activeProvider);
        providerInput.disabled = snapshot.pendingReply;
        setElementText(modelSource, getProviderModelSourceHint(snapshot, activeProvider));

        transcript.innerHTML = buildAiTranscriptMarkup(
            snapshot.conversation,
            snapshot.pendingReply,
            snapshot.availability?.selectedModel || ''
        );
        transcript.scrollTop = transcript.scrollHeight;
        setBusy(snapshot.pendingReply);
        submitButton.disabled = snapshot.pendingReply || !canUseProvider(snapshot, activeProvider);
        const modelLabel = snapshot.availability?.selectedModel || 'provider model';
        const statusText = snapshot.pendingReply
            ? `IBMEye AI: ${modelLabel} replying...`
            : snapshot.availability?.healthy
                ? 'Enter sends. Shift + Enter adds a new line.'
                : snapshot.statusMessage;
        setElementText(status, statusText);
        status.style.color = snapshot.statusIsError ? 'var(--danger)' : 'var(--muted)';
    }

    function persist(nextPreferences) {
        preferences = saveIBMEyeAiPreferences({
            ...preferences,
            ...nextPreferences
        });
        applyOpenState();
        applySize();
    }

    function toggle(forceOpen) {
        persist({
            widgetOpen: typeof forceOpen === 'boolean' ? forceOpen : !preferences.widgetOpen
        });

        if (preferences.widgetOpen) {
            window.requestAnimationFrame(() => {
                input.focus();
            });
        }
    }

    function open() {
        widget.hidden = false;
        toggle(true);
    }

    function submitCurrentPrompt() {
        const snapshot = aiState.getSnapshot();
        if (!canUseProvider(snapshot, snapshot.settings?.provider)) return;
        const message = input.value || '';
        if (aiState.getSnapshot().pendingReply) {
            return;
        }
        input.value = '';
        void aiState.submitPrompt(message);
    }

    const unsubscribe = aiState.subscribe(render);
    const resizeObserver = new ResizeObserver((entries) => {
        const nextEntry = entries[0];
        if (!nextEntry) {
            return;
        }

        // CSS dimensions include padding and borders. Persist the observed
        // border box without applying it again inside the resize callback.
        const box = nextEntry.borderBoxSize[0];
        if (!box || box.inlineSize <= 0 || box.blockSize <= 0) return;
        const width = Math.round(box.inlineSize);
        const height = Math.round(box.blockSize);
        if (width === preferences.widgetWidth && height === preferences.widgetHeight) return;
        preferences = saveIBMEyeAiPreferences({
            ...preferences,
            widgetWidth: width,
            widgetHeight: height
        });
    });

    applyOpenState();
    applySize();
    resizeObserver.observe(popout);

    launcher.addEventListener('click', () => {
        toggle();
    });

    closeButton?.addEventListener('click', () => {
        toggle(false);
    });

    providerInput.addEventListener('change', () => {
        const provider = providerInput.value;
        const providerOption = getAiProviderOption(aiState.getSnapshot(), provider);
        if (!providerOption || !canUseProvider(aiState.getSnapshot(), provider)) {
            return;
        }
        void aiState.saveSettings({
            provider,
            endpoint: providerOption.defaultEndpoint,
            model: ''
        });
    });

    modelInput.addEventListener('change', () => {
        const snapshot = aiState.getSnapshot();
        if (!canUseProvider(snapshot, snapshot.settings?.provider) || (modelInput.value && !getProviderModels(snapshot, snapshot.settings?.provider).includes(modelInput.value))) return;
        void aiState.saveSettings({
            model: modelInput.value || ''
        });
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitCurrentPrompt();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }

        event.preventDefault();
        submitCurrentPrompt();
    });

    return {
        open,
        destroy() {
            unsubscribe();
            resizeObserver.disconnect();
        }
    };
}
