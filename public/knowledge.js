import { initAppNavigation } from './shared/app-navigation.js';
import { applyTheme } from './connection/shared.js';
void initAppNavigation();
const status = document.getElementById('knowledge-scope');
Promise.all([window.electronAPI.getConnectionState(), window.electronAPI.getThemeSettings()]).then(([state, theme]) => {
    applyTheme(theme.themeId);
    status.textContent = state.isConnected ? state.currentConnection?.name || state.currentConnection?.host || 'Connected system' : 'No active connection · local code analysis is available';
}).catch(() => { status.textContent = 'System status unavailable. Retry from ActionBoard.'; });
document.getElementById('knowledge-analyze').addEventListener('click', () => {
    window.electronAPI.navigateToObjectAnalysis().catch(() => { status.textContent = 'Unable to open code analysis. Try again.'; });
});
