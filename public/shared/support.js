function setSupportStatus(statusElement, message, isError = false) {
    if (!statusElement) {
        return;
    }

    statusElement.hidden = !message;
    statusElement.textContent = message;
    statusElement.classList.toggle('is-error', Boolean(message) && isError);
}

/**
 * Initializes the shared support footer controls.
 */
export async function initSupportPanel(options) {
    const {
        versionLabel,
        contactButton,
        diagnosticsButton,
        statusElement,
        menuElement
    } = options;

    const appInfo = await window.electronAPI.getAppInfo();
    if (versionLabel) {
        versionLabel.textContent = `${appInfo.appName} v${appInfo.appVersion}`;
    }

    async function runSupportAction(button, action, workingMessage, getSuccessMessage) {
        const allButtons = [contactButton, diagnosticsButton].filter(Boolean);
        allButtons.forEach((currentButton) => {
            currentButton.disabled = true;
        });
        setSupportStatus(statusElement, workingMessage, false);

        try {
            const result = await action();
            if (!result?.success) {
                setSupportStatus(statusElement, result?.error || 'Unable to complete the support action.', true);
                return;
            }

            if (menuElement) {
                menuElement.open = false;
            }
            setSupportStatus(statusElement, getSuccessMessage(result), false);
        } catch (error) {
            setSupportStatus(
                statusElement,
                error instanceof Error ? error.message : 'Unable to complete the support action.',
                true
            );
        } finally {
            allButtons.forEach((currentButton) => {
                currentButton.disabled = false;
            });
        }
    }

    contactButton?.addEventListener('click', () => {
        void runSupportAction(
            contactButton,
            () => window.electronAPI.contactSupport(),
            'Opening your mail app...',
            () => `Opened your mail app for ${appInfo.supportEmail}.`
        );
    });

    diagnosticsButton?.addEventListener('click', () => {
        void runSupportAction(
            diagnosticsButton,
            () => window.electronAPI.sendSupportDiagnostics(),
            "Preparing today's diagnostics...",
            (result) => (
                result.filePath
                    ? `Diagnostics ready. Attach ${result.filePath} if your mail app did not add it automatically.`
                    : 'Diagnostics prepared and mail draft opened.'
            )
        );
    });
}
