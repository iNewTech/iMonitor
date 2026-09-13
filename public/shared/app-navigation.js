/** The same three destinations on each main screen; navigation never disconnects monitoring. */
export async function initAppNavigation({ canLeave = () => true } = {}) {
    const nav = document.querySelector('[data-app-nav]');
    if (!nav) return;
    const current = nav.dataset.appNav;
    nav.classList.add('app-navigation');
    const destinations = [['board', 'ActionBoard'], ['knowledge', 'Knowledge'], ['settings', 'Settings']];
    nav.innerHTML = destinations.map(([id, label]) => `<button type="button" data-app-destination="${id}" ${id === 'settings' && current === 'board' ? 'id="open-settings"' : ''} ${current === id ? 'aria-current="page"' : ''}>${label}</button>`).join('');
    const status = document.createElement('p');
    status.className = 'navigation-error'; status.setAttribute('role', 'alert'); status.hidden = true;
    nav.parentElement.after(status);
    nav.addEventListener('click', async event => {
        const button = event.target.closest('[data-app-destination]');
        if (!button || button.getAttribute('aria-current')) return;
        if (!canLeave()) {
            status.textContent = 'Save or cancel your profile changes before switching workspaces.';
            status.hidden = false; return;
        }
        if (document.getElementById('ai-assistant-input')?.disabled) {
            status.textContent = 'Wait for the AI reply before switching workspaces.';
            status.hidden = false; return;
        }
        button.disabled = true; status.hidden = true;
        try {
            const destination = button.dataset.appDestination;
            if (destination === 'board') {
                const state = await window.electronAPI.getConnectionState();
                await (state.isConnected ? window.electronAPI.navigateToMonitor() : window.electronAPI.navigateToConnection());
            } else if (destination === 'knowledge') await window.electronAPI.navigateToKnowledge();
            else await window.electronAPI.navigateToSettings();
        } catch {
            status.textContent = 'Unable to open that workspace. Try again.'; status.hidden = false;
        } finally { button.disabled = false; }
    });
    // Disclosure menus share predictable outside-click and keyboard dismissal.
    const menus = '.theme-menu, .plan-panel, .support-menu';
    document.addEventListener('click', event => {
        document.querySelectorAll(menus).forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const menu = event.target.closest(menus);
        if (menu?.open) { menu.open = false; menu.querySelector('summary')?.focus(); }
    });
}
