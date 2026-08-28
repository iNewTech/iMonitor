/**
 * Initializes the monitor AI assistant panel.
 */
export function initAiAssistant(dependencies) {
    const {
        root,
        getSelectedJobName
    } = dependencies;

    if (!root) {
        return {
            refresh: async () => {}
        };
    }

    const transcript = root.querySelector('#ai-chat-transcript');
    const status = root.querySelector('#ai-assistant-status');
    const availabilityBadge = root.querySelector('#ai-availability-badge');
    const modelBadge = root.querySelector('#ai-model-badge');
    const form = root.querySelector('#ai-assistant-form');
    const input = root.querySelector('#ai-assistant-input');
    const submitButton = root.querySelector('#ai-assistant-submit');
    const refreshButton = root.querySelector('#ai-assistant-refresh');
    const promptButtons = Array.from(root.querySelectorAll('.ai-prompt-chip'));
    const settingsForm = root.querySelector('#ai-settings-form');
    const enabledInput = root.querySelector('#ai-enabled');
    const endpointInput = root.querySelector('#ai-endpoint');
    const modelInput = root.querySelector('#ai-model');
    const temperatureInput = root.querySelector('#ai-temperature');
    const replyStyleInput = root.querySelector('#ai-reply-style');

    let settings = null;
    let availability = null;
    let conversation = [];
    let pendingReply = false;

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

    function setStatus(message, isError = false) {
        if (!status) {
            return;
        }

        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function setBusy(busy) {
        pendingReply = busy;

        if (submitButton) {
            submitButton.disabled = busy;
            submitButton.innerHTML = busy
                ? '<i class="bi bi-hourglass-split me-2"></i>Analyzing'
                : '<i class="bi bi-stars me-2"></i>Analyze';
        }

        if (refreshButton) {
            refreshButton.disabled = busy;
        }

        if (input) {
            input.disabled = busy;
        }

        renderTranscript();
    }

    function renderInlineMarkdown(value) {
        return value
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(])\*([^*\n][^*\n]*?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    }

    function renderMarkdown(value) {
        const escaped = escapeHtml(value).replace(/\r\n/g, '\n');
        const blocks = [];
        const lines = escaped.split('\n');
        let listItems = [];
        let paragraphLines = [];

        function flushList() {
            if (!listItems.length) {
                return;
            }

            blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
            listItems = [];
        }

        function flushParagraph() {
            if (!paragraphLines.length) {
                return;
            }

            blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('<br>'))}</p>`);
            paragraphLines = [];
        }

        for (const line of lines) {
            const trimmedLine = line.trim();
            const listMatch = trimmedLine.match(/^[-*]\s+(.+)$/);

            if (!trimmedLine) {
                flushParagraph();
                flushList();
                continue;
            }

            if (listMatch) {
                flushParagraph();
                listItems.push(listMatch[1]);
                continue;
            }

            flushList();
            paragraphLines.push(trimmedLine);
        }

        flushParagraph();
        flushList();

        return blocks.join('') || '<p></p>';
    }

    function renderTranscript() {
        if (!transcript) {
            return;
        }

        if (!conversation.length) {
            transcript.innerHTML = `
                <div class="activity-log-empty">
                    <i class="bi bi-robot"></i>
                    <span>Ask IBMEye AI about alerts, waits, SQL, or the selected job.</span>
                </div>
            `;
            return;
        }

        const transcriptMarkup = conversation.map((message) => `
            <div class="ai-chat-row is-${escapeHtml(message.role)}">
                <article class="ai-chat-message is-${escapeHtml(message.role)}">
                    <div class="ai-chat-message-header">
                        <span class="ai-chat-author">${escapeHtml(message.role === 'assistant' ? 'IBMEye AI' : 'You')}</span>
                    </div>
                    <div class="ai-chat-message-copy">${renderMarkdown(message.content)}</div>
                </article>
            </div>
        `).join('');

        const pendingMarkup = pendingReply ? `
            <div class="ai-chat-row is-assistant">
                <article class="ai-chat-message is-assistant is-pending">
                    <div class="ai-chat-message-header">
                        <span class="ai-chat-author">IBMEye AI</span>
                    </div>
                    <div class="ai-chat-typing" aria-live="polite" aria-label="IBMEye AI is replying">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </article>
            </div>
        ` : '';

        transcript.innerHTML = `${transcriptMarkup}${pendingMarkup}`;

        transcript.scrollTop = transcript.scrollHeight;
    }

    function renderAvailability() {
        if (availabilityBadge) {
            availabilityBadge.textContent = availability?.healthy ? 'Ollama ready' : 'Ollama unavailable';
        }

        if (modelBadge) {
            modelBadge.textContent = availability?.selectedModel || 'No model';
        }
    }

    function syncModelOptions() {
        if (!modelInput) {
            return;
        }

        const selectedValue = settings?.model || availability?.selectedModel || '';
        const options = ['<option value="">Auto-select first installed model</option>'];
        for (const model of availability?.availableModels || []) {
            options.push(`<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`);
        }
        modelInput.innerHTML = options.join('');
        modelInput.value = selectedValue;
    }

    function applySettings() {
        if (enabledInput) {
            enabledInput.checked = Boolean(settings?.enabled);
        }
        if (endpointInput) {
            endpointInput.value = settings?.endpoint || 'http://127.0.0.1:11434';
        }
        if (temperatureInput) {
            temperatureInput.value = String(settings?.temperature ?? 0.2);
        }
        if (replyStyleInput) {
            replyStyleInput.value = settings?.replyStyle || '';
        }
        syncModelOptions();
    }

    async function refresh() {
        try {
            const [nextSettings, nextAvailability] = await Promise.all([
                window.electronAPI.getAiSettings(),
                window.electronAPI.getAiAvailability()
            ]);
            settings = nextSettings;
            availability = nextAvailability;
            applySettings();
            renderAvailability();
            setStatus(nextAvailability.message, !nextAvailability.healthy);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Unable to load AI settings: ${message}`, true);
        }
    }

    async function submitPrompt(message) {
        if (!message.trim()) {
            setStatus('Enter a question for the AI analyst.');
            return;
        }

        conversation.push({
            role: 'user',
            content: message.trim()
        });
        conversation = conversation.slice(-12);
        renderTranscript();
        if (input) {
            input.value = '';
        }
        setBusy(true);
        setStatus('Analyzing the current iMonitor context...');

        try {
            const result = await window.electronAPI.askAiAssistant({
                message,
                selectedJobName: getSelectedJobName?.() || undefined,
                conversation
            });

            if (!result?.success || !result.reply) {
                availability = result?.availability || availability;
                renderAvailability();
                setStatus(result?.error || 'AI analysis failed.', true);
                return;
            }

            availability = result.availability || availability;
            conversation.push({
                role: 'assistant',
                content: result.reply
            });
            conversation = conversation.slice(-12);
            renderTranscript();
            renderAvailability();
            setStatus('AI analysis updated from the latest monitor data.');
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            setStatus(`AI analysis failed: ${messageText}`, true);
        } finally {
            setBusy(false);
        }
    }

    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        void submitPrompt(input?.value || '');
    });

    input?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }

        event.preventDefault();
        void submitPrompt(input.value || '');
    });

    refreshButton?.addEventListener('click', () => {
        void refresh();
    });

    promptButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const prompt = button.dataset.aiPrompt || '';
            if (input) {
                input.value = prompt;
                input.focus();
            }
            void submitPrompt(prompt);
        });
    });

    settingsForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('Saving AI settings...');

        try {
            settings = await window.electronAPI.saveAiSettings({
                enabled: Boolean(enabledInput?.checked),
                endpoint: endpointInput?.value || '',
                model: modelInput?.value || '',
                temperature: Number.parseFloat(temperatureInput?.value || '0.2'),
                replyStyle: replyStyleInput?.value || ''
            });
            await refresh();
            setStatus('AI settings saved.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(`Unable to save AI settings: ${message}`, true);
        }
    });

    void refresh();

    return {
        refresh
    };
}
