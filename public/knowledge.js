import { applyTheme, escapeHtml } from './connection/shared.js';
import { initAppNavigation } from './shared/app-navigation.js';

const SUPPORTED_FILE = /\.(txt|md|markdown|json|cl|clle|rpg|rpgle|sql|csv)$/i;
const REVIEW_STATUSES = new Set(['observed', 'draft', 'stale', 'unknown']);
const state = { records: [], shown: [], selected: null, query: '', reviewOnly: false };

const byId = (id) => document.getElementById(id);
const setStatus = (id, message = '', tone = '') => {
    const node = byId(id);
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
};
const sourceName = (record) => String(record?.title || record?.sourceRef?.id || 'Knowledge source').split(' · ')[0];
const sourceKey = (record) => String(record?.sourceRef?.id || record?.id || '');
const formatDate = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const label = (value) => String(value || '').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

function grouped(records) {
    const groups = new Map();
    records.forEach((record) => {
        const key = sourceKey(record);
        if (!key || record.status === 'retired') return;
        const current = groups.get(key) || { record, count: 0, records: [] };
        current.count += 1;
        current.records.push(record);
        if (new Date(record.observedAt) > new Date(current.record.observedAt)) current.record = record;
        groups.set(key, current);
    });
    return [...groups.values()].sort((left, right) => String(right.record.observedAt).localeCompare(String(left.record.observedAt)));
}

function renderStats(stats, sourceCount) {
    byId('knowledge-source-count').textContent = String(sourceCount);
    byId('knowledge-record-count').textContent = String(stats?.recordCount ?? state.records.length);
    byId('knowledge-index-state').textContent = label(stats?.state || 'unknown');
    byId('knowledge-last-updated').textContent = formatDate(stats?.newestObservedAt);
}

function renderList() {
    const rows = grouped(state.shown);
    byId('knowledge-result-count').textContent = `${rows.length} source${rows.length === 1 ? '' : 's'}`;
    byId('knowledge-list').innerHTML = rows.map(({ record, count }) => `
        <button class="knowledge-row" type="button" data-record-id="${escapeHtml(record.id)}">
            <span class="knowledge-row-icon"><i class="bi bi-journal-text" aria-hidden="true"></i></span>
            <span class="knowledge-row-main"><strong>${escapeHtml(sourceName(record))}</strong><small>${escapeHtml(label(record.sourceType))} · ${count} chunk${count === 1 ? '' : 's'} · ${escapeHtml(record.sourceRef?.kind || 'source')}</small></span>
            <span class="knowledge-row-status ${REVIEW_STATUSES.has(record.status) ? 'is-review' : ''}">${escapeHtml(label(record.status))}</span>
            <span class="knowledge-row-date">${escapeHtml(formatDate(record.observedAt))}<i class="bi bi-chevron-right" aria-hidden="true"></i></span>
        </button>`).join('');
    const empty = byId('knowledge-empty');
    empty.hidden = rows.length > 0;
    if (rows.length === 0) {
        byId('knowledge-empty-title').textContent = state.query || state.reviewOnly ? 'No matching sources' : 'Your library is empty';
        byId('knowledge-empty-copy').textContent = state.query || state.reviewOnly ? 'Try another search or clear the filter.' : 'Add a runbook, incident note, or approved document to give IBMEye useful local context.';
    }
    document.querySelectorAll('.knowledge-row').forEach((row) => row.addEventListener('click', () => openDetail(row.dataset.recordId)));
}

function applyFilters() {
    const query = state.query.toLocaleLowerCase();
    state.shown = state.records.filter((record) => {
        if (record.status === 'retired') return false;
        if (state.reviewOnly && !REVIEW_STATUSES.has(record.status)) return false;
        if (!query) return true;
        return [record.title, record.content, record.sourceType, record.sourceRef?.id].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
    });
    renderList();
}

async function loadLibrary() {
    setStatus('knowledge-status', 'Loading knowledge…');
    const response = await window.electronAPI.getKnowledgeLibrary();
    if (!response.success) throw new Error(response.error || 'Knowledge library is unavailable.');
    state.records = response.records || [];
    renderStats(response.stats, grouped(state.records).length);
    applyFilters();
    setStatus('knowledge-status', state.records.length ? '' : 'Add the first source to begin.');
}

async function loadSearch() {
    if (!state.query) return loadLibrary();
    setStatus('knowledge-status', 'Searching…');
    const response = await window.electronAPI.searchKnowledge(state.query, 100);
    if (!response.success) throw new Error(response.error || 'Knowledge search is unavailable.');
    state.shown = response.records || [];
    if (state.reviewOnly) state.shown = state.shown.filter((record) => REVIEW_STATUSES.has(record.status));
    renderList();
    setStatus('knowledge-status', '');
}

async function refresh() {
    try {
        await loadLibrary();
        if (state.query) await loadSearch();
    } catch (error) {
        setStatus('knowledge-status', error instanceof Error ? error.message : 'Knowledge library is unavailable.', 'error');
        renderList();
    }
}

async function openDetail(recordId) {
    setStatus('knowledge-status', 'Loading source…');
    try {
        const response = await window.electronAPI.getKnowledgeRecord(recordId);
        if (!response.success || !response.record) throw new Error(response.error || 'The source is no longer available.');
        state.selected = response.record;
        byId('knowledge-detail-title').textContent = sourceName(response.record);
        byId('knowledge-detail-meta').innerHTML = `<span>${escapeHtml(label(response.record.sourceType))}</span><span>${escapeHtml(label(response.record.status))}</span><span>${escapeHtml(response.record.customerScope)} · ${escapeHtml(response.record.systemScope)}</span><span>Updated ${escapeHtml(formatDate(response.record.observedAt))}</span>`;
        byId('knowledge-detail-text').textContent = response.record.content || '';
        byId('knowledge-detail-history-list').innerHTML = (response.history || []).sort((left, right) => String(right.observedAt).localeCompare(String(left.observedAt))).map((item) => `<div><strong>${escapeHtml(label(item.status))}</strong><span>${escapeHtml(formatDate(item.observedAt))} · ${escapeHtml(item.id)}</span></div>`).join('') || '<p>No previous versions.</p>';
        setStatus('knowledge-detail-status', '');
        byId('knowledge-detail-dialog').showModal();
    } catch (error) {
        setStatus('knowledge-status', error instanceof Error ? error.message : 'Unable to open source.', 'error');
    }
}

async function addSource(event) {
    event.preventDefault();
    const sourceNameValue = byId('knowledge-source-name').value.trim();
    const content = byId('knowledge-content').value;
    if (!sourceNameValue || !content.trim()) {
        setStatus('knowledge-add-status', 'Source name and content are required.', 'error');
        return;
    }
    const button = byId('knowledge-add-submit');
    button.disabled = true;
    setStatus('knowledge-add-status', 'Saving and preparing the index…');
    const response = await window.electronAPI.addKnowledgeSource({ sourceName: sourceNameValue, sourceType: byId('knowledge-source-type').value, fileName: byId('knowledge-file').files?.[0]?.name, content });
    button.disabled = false;
    if (!response.success) {
        setStatus('knowledge-add-status', response.error || 'Unable to save source. Try again.', 'error');
        return;
    }
    byId('knowledge-add-dialog').close();
    byId('knowledge-add-form').reset();
    setStatus('knowledge-status', 'Source saved.');
    await refresh();
}

async function deleteSelected() {
    if (!state.selected) return;
    const response = await window.electronAPI.deleteKnowledgeRecord(state.selected.id);
    if (!response.success) {
        setStatus('knowledge-detail-status', response.error || 'Unable to delete source.', 'error');
        return;
    }
    byId('knowledge-detail-dialog').close();
    state.selected = null;
    await refresh();
}

async function reindex() {
    setStatus('knowledge-status', 'Refreshing index…');
    const response = await window.electronAPI.reindexKnowledge();
    if (!response.success) {
        setStatus('knowledge-status', response.error || 'Unable to refresh index.', 'error');
        return;
    }
    await refresh();
    setStatus('knowledge-status', 'Index refreshed.');
}

byId('knowledge-search').addEventListener('input', () => {
    state.query = byId('knowledge-search').value.trim();
    window.clearTimeout(window.__knowledgeSearchTimer);
    window.__knowledgeSearchTimer = window.setTimeout(() => { void (state.query ? loadSearch() : refresh()); }, 180);
});
byId('knowledge-review-filter').addEventListener('change', () => { state.reviewOnly = byId('knowledge-review-filter').checked; state.query ? void loadSearch() : applyFilters(); });
byId('knowledge-add-form').addEventListener('submit', addSource);
byId('knowledge-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!SUPPORTED_FILE.test(file.name)) { setStatus('knowledge-add-status', 'This file type is not supported yet.', 'error'); event.target.value = ''; return; }
    if (file.size > 200000) { setStatus('knowledge-add-status', 'Choose a file smaller than 200 KB.', 'error'); event.target.value = ''; return; }
    byId('knowledge-source-name').value ||= file.name.replace(/\.[^.]+$/, '');
    byId('knowledge-content').value = await file.text();
    setStatus('knowledge-add-status', 'File loaded. Review it and save when ready.');
});
byId('knowledge-add').addEventListener('click', () => byId('knowledge-add-dialog').showModal());
byId('knowledge-empty-add').addEventListener('click', () => byId('knowledge-add-dialog').showModal());
byId('knowledge-analyze').addEventListener('click', () => window.electronAPI.navigateToObjectAnalysis().catch(() => setStatus('knowledge-status', 'Unable to open code analysis.', 'error')));
byId('knowledge-reindex').addEventListener('click', () => void reindex());
byId('knowledge-detail-reindex').addEventListener('click', () => void reindex());
byId('knowledge-detail-delete').addEventListener('click', () => void deleteSelected());
document.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => byId(button.dataset.dialogClose).close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

void initAppNavigation();
Promise.all([window.electronAPI.getConnectionState(), window.electronAPI.getThemeSettings()]).then(async ([connection, theme]) => {
    applyTheme(theme.themeId);
    byId('knowledge-scope').textContent = connection.isConnected ? connection.currentConnection?.name || connection.currentConnection?.host || 'Connected system' : 'Disconnected · reconnect to continue';
    await refresh();
}).catch((error) => setStatus('knowledge-status', error instanceof Error ? error.message : 'System status unavailable.', 'error'));
