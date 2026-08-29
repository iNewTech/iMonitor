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
        destroy() {
            panel.destroy();
            widget.destroy();
        }
    };
}
