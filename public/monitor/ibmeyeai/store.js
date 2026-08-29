export function createIBMEyeAiState(dependencies) {
    const {
        getSelectedJobName
    } = dependencies;

    let settings = null;
    let availability = null;
    let providerCatalog = [];
    let conversation = [];
    let pendingReply = false;
    let statusMessage = 'Local Ollama analysis is preparing.';
    let statusIsError = false;

    const listeners = new Set();

    function emit() {
        const snapshot = {
            settings,
            availability,
            providerCatalog: providerCatalog.slice(),
            conversation: conversation.slice(),
            pendingReply,
            statusMessage,
            statusIsError
        };

        listeners.forEach((listener) => listener(snapshot));
    }

    function subscribe(listener) {
        listeners.add(listener);
        listener({
            settings,
            availability,
            providerCatalog: providerCatalog.slice(),
            conversation: conversation.slice(),
            pendingReply,
            statusMessage,
            statusIsError
        });

        return () => {
            listeners.delete(listener);
        };
    }

    function getSnapshot() {
        return {
            settings,
            availability,
            providerCatalog: providerCatalog.slice(),
            conversation: conversation.slice(),
            pendingReply,
            statusMessage,
            statusIsError
        };
    }

    function setStatus(message, isError = false) {
        statusMessage = message;
        statusIsError = isError;
        emit();
    }

    function setBusy(busy) {
        pendingReply = busy;
        emit();
    }

    async function refresh() {
        try {
            const [nextProviderCatalog, nextSettings, nextAvailability] = await Promise.all([
                window.electronAPI.getAiProviderCatalog(),
                window.electronAPI.getAiSettings(),
                window.electronAPI.getAiAvailability()
            ]);
            providerCatalog = Array.isArray(nextProviderCatalog) ? nextProviderCatalog : [];
            settings = nextSettings;
            availability = nextAvailability;
            statusMessage = nextAvailability.message;
            statusIsError = !nextAvailability.healthy;
            emit();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Unable to load AI settings: ${message}`, true);
        }
    }

    async function submitPrompt(message) {
        const trimmedMessage = String(message || '').trim();
        if (!trimmedMessage) {
            setStatus('Enter a question for IBMEye AI.');
            return false;
        }

        conversation = conversation.concat({
            role: 'user',
            content: trimmedMessage
        }).slice(-12);
        emit();
        setBusy(true);
        setStatus('IBMEye AI is analyzing the current iMonitor context...');

        try {
            const result = await window.electronAPI.askAiAssistant({
                message: trimmedMessage,
                selectedJobName: getSelectedJobName?.() || undefined,
                conversation
            });

            if (!result?.success || !result.reply) {
                availability = result?.availability || availability;
                pendingReply = false;
                emit();
                setStatus(result?.error || 'AI analysis failed.', true);
                return false;
            }

            availability = result.availability || availability;
            conversation = conversation.concat({
                role: 'assistant',
                content: result.reply
            }).slice(-12);
            pendingReply = false;
            statusMessage = 'IBMEye AI updated the analysis from the latest monitor data.';
            statusIsError = false;
            emit();
            return true;
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            pendingReply = false;
            emit();
            setStatus(`AI analysis failed: ${messageText}`, true);
            return false;
        }
    }

    async function saveSettings(nextSettings) {
        setStatus('Saving AI settings...');

        try {
            settings = await window.electronAPI.saveAiSettings(nextSettings);
            await refresh();
            setStatus('AI settings saved.');
            return settings;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Unable to save AI settings: ${message}`, true);
            return null;
        }
    }

    return {
        getSnapshot,
        subscribe,
        refresh,
        submitPrompt,
        saveSettings
    };
}
