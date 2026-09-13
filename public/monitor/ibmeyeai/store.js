export function createIBMEyeAiState(dependencies) {
    const {
        getSelectedJobName
    } = dependencies;

    let settings = null;
    let availability = null;
    let providerCatalog = [];
    let conversation = [];
    let pendingReply = false;
    let activeRequestId = 0;
    let statusMessage = 'Local Ollama analysis is preparing.';
    let statusIsError = false;
    let responseError = '';

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
            if (!pendingReply && !responseError) {
                statusMessage = nextAvailability.message;
                statusIsError = !nextAvailability.healthy;
            }
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

        // Keep the assistant single-flight. A second prompt used to mutate the
        // shared conversation while the first provider request was still open,
        // which made the first answer appear to be missing or attached to the
        // wrong question.
        if (pendingReply) {
            setStatus('Please wait for the current IBMEye AI answer to finish.');
            return false;
        }

        responseError = '';
        const selectedJobName = getSelectedJobName?.() || undefined;
        conversation = conversation.concat({
            role: 'user',
            content: trimmedMessage
        }).slice(-12);
        emit();
        const requestId = ++activeRequestId;
        setBusy(true);
        setStatus('IBMEye AI is analyzing the current iMonitor context...');

        try {
            const result = await window.electronAPI.askAiAssistant({
                message: trimmedMessage,
                selectedJobName,
                scope: selectedJobName ? 'job' : 'monitor',
                conversation
            });

            if (!result?.success || !result.reply) {
                availability = result?.availability || availability;
                if (requestId === activeRequestId) {
                    pendingReply = false;
                }
                responseError = result?.error || 'AI analysis failed.';
                setStatus(responseError, true);
                return false;
            }

            availability = result.availability || availability;
            conversation = conversation.concat({
                role: 'assistant',
                content: result.reply
            }).slice(-12);
            if (requestId === activeRequestId) {
                pendingReply = false;
            }
            statusMessage = 'IBMEye AI updated the analysis from the latest monitor data.';
            statusIsError = false;
            emit();
            return true;
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            if (requestId === activeRequestId) {
                pendingReply = false;
            }
            responseError = `AI analysis failed: ${messageText}`;
            setStatus(responseError, true);
            return false;
        }
    }

    async function saveSettings(nextSettings) {
        responseError = '';
        setStatus('Saving AI settings...');

        try {
            settings = await window.electronAPI.saveAiSettings(nextSettings);
            await refresh();
            if (availability?.healthy) setStatus('AI settings saved.');
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
