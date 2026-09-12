/** Owns analysis requests. A late response must never replace another source's report. */
export function createAnalysisActions({ elements, view, getSelection, getResult, setResult, isScopeDirty, setStatus }) {
    let revision = 0;
    let busy = false;
    const buttons = [elements.loadSource, elements.loadSourceResult, elements.run, elements.compile,
        elements.compileResult, elements.approve, elements.aiButton, elements.download].filter(Boolean);
    const labels = new Map(buttons.map((button) => [button, button.innerHTML]));

    function sync() {
        const selected = Boolean(getSelection());
        const result = getResult();
        const blocked = busy || isScopeDirty();
        const approved = result?.approval?.status === 'approved' && result?.reportArtifact
            && result.reportArtifact.mode !== 'error';
        for (const button of buttons) {
            button.disabled = blocked || !selected;
            if ([elements.compile, elements.compileResult, elements.aiButton, elements.approve].includes(button)) {
                button.disabled ||= !result;
            }
        }
        if (elements.approve) elements.approve.disabled ||= Boolean(approved);
        if (elements.download) elements.download.disabled ||= !approved;
    }

    function invalidate() {
        revision += 1;
        busy = false;
        for (const button of buttons) {
            button.innerHTML = labels.get(button);
            button.removeAttribute('aria-busy');
        }
        sync();
    }

    async function run(button, message, request, apply) {
        if (busy || !getSelection()) return;
        if (isScopeDirty()) {
            setStatus('Apply the library list before continuing.', 'error');
            return;
        }
        const version = ++revision;
        const file = { ...getSelection() };
        const result = getResult();
        busy = true;
        sync();
        button?.setAttribute('aria-busy', 'true');
        setStatus(message);
        try {
            const response = await request(file, result);
            if (version !== revision) return;
            if (!response?.success) throw new Error(response?.error || 'The request could not be completed.');
            apply(response, file, result);
        } catch (error) {
            if (version === revision) setStatus(error?.message || String(error), 'error');
        } finally {
            if (version === revision) {
                busy = false;
                button?.removeAttribute('aria-busy');
                sync();
            }
        }
    }

    function loadSource() {
        return run(elements.loadSource, 'Loading source…',
            (file) => window.electronAPI.loadObjectAnalysisSource(file),
            (response, file) => {
                if (typeof response.content !== 'string') throw new Error('No source text was returned.');
                elements.sourcePreviewTitle.textContent = file.name;
                elements.sourcePreviewMeta.textContent = `${file.library} · ${file.relativePath} · ${response.lineCount || response.content.split(/\r?\n/).length} lines`;
                elements.sourcePreviewCode.textContent = response.content;
                elements.sourcePreview.hidden = false;
                elements.sourcePreview.scrollIntoView({ block: 'nearest' });
                setStatus(`${file.name} loaded.`, 'success');
            });
    }

    function analyze() {
        return run(elements.run, 'Tracing source and dependencies…',
            (file) => window.electronAPI.analyzeObject(file),
            (response) => {
                if (!response.result) throw new Error('No analysis result was returned.');
                setResult(response.result);
                view.renderResult(response.result);
                setStatus('Analysis complete. Review the findings before approving the report.', 'success');
            });
    }

    function compile() {
        if (!getResult()) return;
        return run(elements.compile, 'Preparing compile order and CL commands…',
            (file, result) => window.electronAPI.generateObjectAnalysisCompilePlan(file, result),
            (response) => {
                if (!response.result?.compilePlan) throw new Error('No compile plan was returned.');
                setResult(response.result);
                view.renderCompilePlan(response.result);
                elements.compileSection.open = true;
                elements.compileSection.scrollIntoView({ block: 'nearest' });
                setStatus('Compile plan saved. Review the commands and manual steps; nothing has been executed.', 'success');
            });
    }

    function approve() {
        if (!getResult() || getResult().approval?.status === 'approved') return;
        return run(elements.approve, 'Saving and mapping the approved report…',
            (file, result) => window.electronAPI.approveObjectAnalysis(file, result),
            (response) => {
                if (!response.result) throw new Error('The approved report was not returned.');
                setResult(response.result);
                view.renderReportStorage(response.result);
                setStatus(`Approved report mapped to ${response.result.reportArtifact?.key || response.artifact?.key}.`, 'success');
            });
    }

    function askAi() {
        if (!getResult()) return;
        return run(elements.aiButton, 'Reading source and dependency evidence with IBMEye AI…',
            (file, result) => window.electronAPI.analyzeObjectWithAi(file, result),
            (response, _file, previous) => {
                if (!response.reply) throw new Error('IBMEye AI returned no report.');
                const result = response.result || { ...previous };
                result.aiReport = result.aiReport || {
                    content: response.reply,
                    providerLabel: response.availability?.providerLabel || 'IBMEye AI',
                    model: response.availability?.selectedModel || 'configured model',
                    generatedAt: new Date().toISOString()
                };
                // The AI addition changes the report; its previously saved approval does not cover it.
                result.approval = { status: 'draft' };
                delete result.reportArtifact;
                setResult(result);
                view.renderAiReport(result.aiReport);
                view.renderReportStorage(result);
                elements.aiSection.scrollIntoView({ block: 'nearest' });
                setStatus('AI report added. Review and approve the updated report to save it.', 'success');
            });
    }

    async function copy(element, label) {
        if (!element?.textContent) return;
        try {
            await navigator.clipboard.writeText(element.textContent);
            setStatus(`${label} copied.`, 'success');
        } catch (error) {
            setStatus(error?.message || 'Copy failed.', 'error');
        }
    }

    [elements.loadSource, elements.loadSourceResult].forEach((button) => button?.addEventListener('click', loadSource));
    [elements.compile, elements.compileResult].forEach((button) => button?.addEventListener('click', compile));
    elements.run?.addEventListener('click', analyze);
    elements.approve?.addEventListener('click', approve);
    elements.aiButton?.addEventListener('click', askAi);
    elements.hideSource?.addEventListener('click', () => { elements.sourcePreview.hidden = true; });
    elements.copySource?.addEventListener('click', () => void copy(elements.sourcePreviewCode, 'Source'));
    elements.copyCompileCl?.addEventListener('click', () => void copy(elements.compileCl, 'CL commands'));
    elements.download?.addEventListener('click', () => {
        if (!getResult()) return;
        void run(elements.download, 'Saving report…',
            (_file, result) => window.electronAPI.saveObjectAnalysisReport(result),
            (response) => setStatus(`Report saved to ${response.filePath}.`, 'success'));
    });
    return { analyze, invalidate, sync };
}
