import { initIBMEyeAiPanel } from './ibmeyeai/panel.js';
import { createIBMEyeAiState } from './ibmeyeai/store.js';
import { initIBMEyeAiWidget } from './ibmeyeai/widget.js';

/**
 * Initializes the monitor AI assistant experiences.
 */
export function initAiAssistant(dependencies) {
    const {
        root,
        getSelectedJobName
    } = dependencies;

    if (!root) {
        return {
            refresh: async () => {},
            submitPrompt: async () => false,
            destroy() {}
        };
    }

    const aiState = createIBMEyeAiState({
        getSelectedJobName
    });

    const panel = initIBMEyeAiPanel({
        root,
        aiState
    });

    const widget = initIBMEyeAiWidget({
        root,
        aiState
    });

    void aiState.refresh();

    return {
        refresh: aiState.refresh,
        submitPrompt: aiState.submitPrompt,
        openWidget: widget.open,
        destroy() {
            panel.destroy();
            widget.destroy();
        }
    };
}
