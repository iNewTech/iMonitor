import { escapeHtml } from './shared.js';

export function showAlert(connectionForm, message, variant = 'danger', detail = '') {
    const existingAlert = document.querySelector('.alert');
    if (existingAlert) {
        existingAlert.remove();
    }

    const detailMarkup = detail
        ? `
            <details class="alert-technical mt-3">
                <summary>Show technical details</summary>
                <pre>${escapeHtml(detail)}</pre>
            </details>
        `
        : '';

    const alert = document.createElement('div');
    alert.className = `alert alert-${variant} alert-dismissible fade show mt-3`;
    alert.role = 'alert';
    alert.innerHTML = `
        <div class="alert-message">${escapeHtml(message)}</div>
        ${detailMarkup}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    connectionForm.insertAdjacentElement('afterbegin', alert);
}

export function setConnectionAction(connectionActionBar, connectionActionMessage, connectionActionDetail, message, detail = '', isVisible = true) {
    if (!connectionActionBar || !connectionActionMessage || !connectionActionDetail) {
        return;
    }

    connectionActionBar.hidden = !isVisible;
    connectionActionMessage.textContent = message;
    connectionActionDetail.textContent = detail;
}
