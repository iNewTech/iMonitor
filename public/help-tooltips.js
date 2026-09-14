// All authored help lives here. Selectors also cover controls rendered after page load.
// Use `unavailable` for a useful next step; live disabled reasons take precedence.
export const HELP = {
    // Connect and shared navigation.
    '#connect': 'Connect with the selected profile and open live job monitoring.',
    '#saved-connections': 'Choose a saved system profile. Edit it to change connection details.',
    '#save-connection': 'Save these connection details locally for your next session.',
    '#edit-connection': 'Edit the selected profile without changing its saved identity.',
    '#add-connection': 'Enter connection details for another IBM i system.',
    '#delete-connection': 'Remove this saved profile from this machine. This does not delete anything on IBM i.',
    '#port': 'Enter the Mapepire service port for this system. The default is 8076.',
    '#retry-profiles': 'Try loading saved profiles again while keeping your current input.',
    '[data-app-destination="knowledge"]': 'Browse and search scoped operational knowledge, or add a source for review.',
    '[data-app-destination="settings"]': 'Manage providers, alerts, integrations, support access, and local data.',
    '#knowledge-analyze, #open-object-analysis': 'Browse program sources, inspect dependencies, and prepare a compile plan without running it.',
    '#support-send-diagnostics': 'Prepare diagnostics and open a mail draft. Review the report before sharing it with support.',
    '#support-contact-only': 'Open the support contact flow without attaching diagnostics.',

    // Daily ActionBoard, job states, and queues.
    '#superpanel-focus-next, #focus-next-alert': { text: 'Open the highest-priority incident job so you can review its evidence and act.', unavailable: 'No eligible incident is ready to focus, or job data is still loading.' },
    '#jobs-search-input': 'Find a job by name, user, subsystem, status, or function.',
    '#jobs-status-filter': 'Show jobs matching a technical state or an active issue. A running job can still need attention.',
    '#jobs-mine-filter': 'Show incident jobs assigned to the current operator.',
    '#jobs-subsystem-filter': 'Limit the jobs list to one IBM i subsystem.',
    '#refresh-interval, #custom-refresh-seconds': 'Choose how often iMonitor reads job data. Custom intervals are entered in seconds.',
    '#start-monitoring': 'Resume polling for fresh job data at the selected interval.',
    '#stop-monitoring': 'Pause this monitoring loop. This does not stop jobs on IBM i.',
    '.board-filter-menu > summary': 'Adjust polling, subsystem filtering, and row spacing.',
    '#board-workspace-menu > summary': 'Open occasional tools, incident history, and support outcomes.',
    '#board-history-panel > summary': 'Expand or collapse recent job volume, peak job CPU, and wait-state trends.',
    '#cpu-history-title, .board-system-strip [title], #task-cpu': 'CPU usage for a job. Peak job CPU is the highest active-job value, not total system CPU.',
    '#wait-history-title': 'Track message waits (MSGW) and lock waits (LCKW) across recent polls.',
    '.job-condition[data-state="MSGW"], #settings-alert-message-wait, #watch-message-wait': 'MSGW means a job is waiting for a message reply. Read the inquiry before choosing a response.',
    '.job-condition[data-state="LCKW"], #settings-alert-lock-wait, #watch-lock-wait': 'LCKW means a job is waiting for a lock. Inspect the lock owner and shared resource first.',
    '.job-condition[data-state="DLYW"], #settings-alert-delay-wait, #watch-delay-wait': 'DLYW means a timed delay. Check whether this wait is expected for the job.',
    '.job-condition[data-state="DEQW"], #settings-alert-dequeue-wait, #watch-dequeue-wait': 'DEQW means a job is waiting for a dequeue operation. The wait may be normal for its workload.',
    '.job-condition': 'The current job state and linked issue appear here. Open the job to inspect evidence, ownership, and actions.',
    '.job-owner-chip': 'This operator has claimed the incident. Open the task to review progress or arrange a handoff.',
    '#open-support-outcomes': 'Review scoped incident and recovery measurements, with sample sizes and unknown outcomes.',
    '#support-metrics-export': 'Save the current support-outcomes report as JSON for review.',
    '#board-companion-toggle': 'Show or hide the floating IBMEye helper. The main AI input remains available below the jobs list.',
    '#board-collector-status, [data-open-collector]': 'Manage read-only collection that can continue after the dashboard window closes.',
    '.job-queues-panel > summary, #job-queues-search': 'Inspect queued work and search waiting jobs before choosing a queue or job action.',
    '#job-queues-refresh': 'Read current job queues and waiting work again.',
    '[data-action-kind="holdQueue"]': 'Hold the queue to prevent queued work from starting. Review the impact before confirming.',
    '[data-action-kind="releaseQueue"]': 'Release the queue so eligible waiting jobs can start after confirmation.',
    '[data-action-kind="holdQueuedJob"]': 'Hold this queued job so it cannot start until released.',
    '[data-action-kind="releaseQueuedJob"]': 'Release this held queued job so it can become eligible to run.',

    // Job task, operator actions, handoff, and reviewed knowledge.
    '#task-refresh': 'Refresh this job and its incident evidence without opening another task window.',
    '#task-tab-history': 'Review incident changes, ownership, notes, and recorded actions for this job.',
    '.task-alert-action[data-action="acknowledge"], [data-alert-action="acknowledge"]': 'Record that you have seen this incident. Acknowledging does not claim or resolve it.',
    '.task-alert-action[data-action="claim"], [data-alert-action="claim"]': 'Assign this incident to you. A linked ticket is created when the integration is configured.',
    '.task-alert-action[data-action="release"], [data-alert-action="release"]': 'Remove your claim so another operator can pick up the incident. The issue stays visible.',
    '.task-alert-action[data-action="workDone"], [data-alert-action="workDone"]': 'Record your work as complete. The incident stays active until monitoring confirms recovery.',
    '[data-action-kind="holdJob"]': 'Request a hold for this job. Review the effect and confirm before the command runs.',
    '[data-action-kind="releaseJob"]': 'Request release of this held job, then verify its state on the next poll.',
    '[data-action-kind="endJob"]': 'Request that this job end. This can interrupt business work and requires confirmation.',
    '[data-action-kind="replyMessage"]': 'Reply to the current job inquiry after checking its message, queue, and reply options.',
    '[data-action-kind="inspectLocks"], #task-load-graph': 'Read observed resource relationships and lock owners to investigate what is blocking this job.',
    '#task-load-log, #load-job-log': 'Read the selected job log on demand to inspect recent messages and errors.',
    '#task-load-messages, #load-job-messages': 'Read the current inquiry and message context before preparing a reply.',
    '#task-runbook-title': { text: 'Follow a reviewed procedure one checkpoint at a time. Each step records its evidence and outcome.', info: 'About guided recovery' },
    '#task-runbook-start': 'Start a recorded runbook for this incident. Commands remain subject to approval and verification.',
    '#task-runbook-step': { text: 'Run the current checkpoint and record its result. Review any command confirmation before continuing.', unavailable: 'Start an available runbook first, or wait for the current checkpoint to finish.' },
    '#task-request-handoff': 'Send the incident and investigation summary to the named operator. Ownership changes when they accept.',
    '#task-accept-handoff': { text: 'Accept the handoff addressed to you and become the incident owner.', unavailable: 'Only the addressed operator can accept a pending handoff.' },
    '#task-handoff-recipient': 'Enter the operator who should take over. They must be eligible for this system and accept the handoff.',
    '#task-memory-title': { text: 'Turn a verified resolution into reusable knowledge. Drafts need review before other investigations can reuse them.', info: 'About resolution memory' },
    '#task-memory-save': { text: 'Save the verified outcome as a draft procedure for review.', unavailable: 'Monitoring must confirm recovery before a resolution draft can be saved.' },
    '[data-memory-action="approve"]': 'Approve this reviewed procedure so matching investigations can reuse it.',
    '[data-memory-action="revise"], #task-memory-revise-save': 'Create a revised draft. Changes must be approved before the new version can be reused.',
    '[data-memory-action="reject"]': 'Reject this draft so it cannot be used as approved guidance.',
    '[data-memory-action="retire"]': 'Retire this approved procedure when it is no longer suitable for reuse.',
    '#task-problem-track': 'Track this incident as a candidate recurring problem for L3 investigation.',
    '#task-problem-confirm': 'Record the reviewed root cause, workaround, and linked problem ticket.',
    '#task-problem-resolve': 'Record that the underlying problem fix has been verified.',
    '#task-replay-run': 'Practice with the selected training scenario. Replay does not run commands against IBM i.',
    '.task-mcp-action-button': 'Preview this tool’s effect, risk, scope, and evidence before approving execution.',
    '#task-mcp-action-run': { text: 'Approve the displayed action for this job. Recovery is checked separately after execution.', unavailable: 'Create a current action preview before approving. Editing its input requires a new preview.' },

    // AI help stays within its selected system or job context.
    '#ai-model-menu > summary, #ai-provider-quick, #ai-model-quick, #ibmeyeai-widget-provider, #ibmeyeai-widget-model': 'Choose a configured provider and an available model. Set up missing providers in Settings.',
    '#board-ai-scope': 'Choose whether the next AI question uses the connected system or the selected job as its context.',
    '.ai-attach-menu > summary': 'Choose a suggested analysis prompt to add to your question.',
    '#ai-assistant-submit, #ibmeyeai-widget-submit': { text: 'Ask AI using the current context. Review its evidence and suggestions before taking an action.', unavailable: 'Configure an available AI model and enter a question, or wait for the current response.' },
    '#task-ai-summary, [data-ai-action="explain"]': 'Ask AI to explain this job’s issue using its captured evidence and matching knowledge.',
    '#task-ai-resolve, [data-ai-action="resolve"]': 'Ask for job-specific checks and resolution guidance. AI does not execute the suggested commands.',
    '#open-ai-settings, #ai-settings-refresh': 'Configure the AI provider or refresh the list of models available to this app.',

    // Settings, integrations, and local storage.
    '[data-settings-page="monitoring"]': 'Choose alert delivery channels, watched conditions, and recovery thresholds.',
    '[data-settings-page="ai"]': 'Configure AI models and the knowledge index used for grounded assistance.',
    '[data-settings-page="integrations"]': 'Install and configure connections for notifications and incident tracking.',
    '[data-settings-page="access"]': 'Manage scoped support access, permissions, and expiry for other operators.',
    '[data-settings-page="storage"]': 'Review collection, retention, knowledge health, and confirmed purge controls.',
    '#settings-skills-title': { text: 'Enable approved skills and MCP connections that provide scoped context or controlled tools.', info: 'About skills and MCP' },
    '#settings-storage-title': { text: 'Check local data usage and health. Retention and confirmed purges help you keep the evidence you need.', info: 'About storage' },
    '#settings-aiab-observability > summary': 'Inspect knowledge, model, and MCP readiness along with local telemetry health.',
    '#settings-support-access-title': { text: 'Grant named operators only the systems, permissions, and time window they need.', info: 'About support access' },
    '#settings-alert-cpu-threshold, #high-cpu-threshold': 'Set the job CPU percentage that triggers a high-CPU alert.',
    '#settings-alert-cpu-recovery-polls, #high-cpu-recovery-polls': 'Require this many healthy polls before a watched condition is treated as recovered.',
    '#settings-collector-enabled': 'Keep read-only monitoring active in the background for the chosen saved profile.',
    '#settings-collector-startup': 'Start the configured collector quietly when you sign in to the operating system.',
    '#settings-collector-retention, #settings-aiab-retention': 'Set how many days of stored history to retain. Review the displayed scope before purging.',
    '#settings-collector-storage': 'Set the local collection storage limit. Old records are removed when the limit is reached.',
    '#settings-collector-purge': 'Delete the collected records shown by this control after confirmation. This cannot be undone.',
    '#settings-aiab-save-retention': 'Save the retention period used for AI and ActionBoard telemetry.',
    '#settings-aiab-reindex, #knowledge-reindex, #knowledge-detail-reindex': 'Rebuild the current system’s knowledge index from its stored records.',
    '#settings-aiab-export': 'Choose where to save scoped knowledge and redacted telemetry reports. Review files before sharing.',
    '#settings-aiab-purge': 'Delete scoped knowledge and telemetry older than the entered retention period, after confirmation.',
    '#settings-ai-temperature': 'Control response variation. Lower values favor more consistent replies.',
    '#settings-ai-history-limit': 'Choose how much recent conversation is included with an AI request.',
    '#settings-knowledge-index-manage': 'Manage the local search index and inspect available index-provider options.',
    '#settings-knowledge-index-test': 'Check the selected index provider without changing your stored knowledge.',
    '#settings-mcp-install': 'Install this approved capability. Configure and check it before enabling it.',
    '#settings-mcp-test': 'Check whether the installed capability is configured and ready.',
    '#settings-mcp-toggle': 'Enable or disable this capability for permitted requests in its declared scope.',
    '#settings-mcp-read': 'Preview the selected resource or prompt using read-only access.',
    '#settings-mcp-revoke': 'Revoke this capability so it can no longer service requests.',
    '#settings-mcp-read-job': 'Limit this preview to one qualified IBM i job. Leave empty only for a permitted system-wide read.',
    '#settings-slack-test, #settings-sms-test, #send-test-email': 'Send a real test notification through this configured integration.',
    '#settings-jira-test': 'Test the configured Jira integration. Review its setup and delivery result.',
    '#settings-clickup-handoff-status': 'Enter the ClickUp status to use when an incident is handed off.',
    '#settings-clickup-active-status': 'Enter the ClickUp status to use when the new operator accepts work.',
    '#settings-business-service-deadline': 'Set the response deadline in minutes for jobs matching this business-service rule.',

    // Knowledge and program analysis.
    '#knowledge-library-title': { text: 'Browse sources stored for this system. Review freshness and approval before relying on their guidance.', info: 'About the knowledge library' },
    '#knowledge-add, #knowledge-empty-add': 'Add a supported text document or paste operational knowledge for this system.',
    '#knowledge-review-filter': 'Show sources that need human review before they are trusted for reuse.',
    '#knowledge-add-submit': 'Store this source in the current system’s knowledge library and prepare it for search.',
    '#knowledge-detail-delete': 'Delete this source and its indexed records after confirmation.',
    '#knowledge-source-type': 'Choose what this source represents so retrieval can interpret its context.',
    '#run-object-analysis, [data-analysis-action]': 'Analyze the selected program’s source and available dependency evidence.',
    '#load-object-source, #load-object-source-result': 'Load the selected source for inspection before analyzing or changing it.',
    '#analysis-choose-directory': 'Choose a local directory containing exported IBM i sources.',
    '#analysis-load-source-library': 'Read source members from the specified library on the connected IBM i system.',
    '.analysis-scope > summary': 'Choose where source is read from and the library order used to resolve object references.',
    '#analysis-load-libraries': 'Apply the draft library search order for this session without rewriting the saved setup.',
    '#analysis-save-libraries': 'Save the current library search order permanently in the source setup.',
    '#analysis-depth': 'Limit how many dependency levels the analysis follows.',
    '#analysis-max-nodes': 'Limit the number of objects scanned to keep large dependency graphs manageable.',
    '#generate-compile-plan, #generate-compile-plan-result': { text: 'Generate dependency-ordered build JSON and CL commands from the current analysis. Nothing is compiled automatically.', unavailable: 'Analyze a source first so a compile plan can use the current dependency result.' },
    '#approve-object-analysis': 'Approve and save this report with its source mapping. Later AI additions require review again.',
    '#analyze-business-logic': 'Ask AI to explain the analyzed business flow using source and dependency evidence.',
    '#download-analysis-report': 'Save the current analysis report for review or sharing.',
    '#analysis-compile-section > summary': 'Inspect compile order and generated CL. Review unresolved dependencies and build settings before running commands yourself.'
};

/** One delegated controller and one tooltip per document; pages only load this module. */
export function initHelpTooltips(doc = document) {
    if (doc.getElementById('imonitor-context-tooltip')) return;
    const entries = Object.entries(HELP).map(([selector, value]) => ({ selector, ...(typeof value === 'string' ? { text: value } : value) }));
    const selectors = entries.map((entry) => entry.selector).join(',');
    const icons = new WeakMap();
    const tip = doc.createElement('div');
    tip.id = 'imonitor-context-tooltip';
    tip.className = 'context-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('popover', 'manual');
    tip.hidden = true;
    doc.body.append(tip);
    let active = null;
    let showTimer;
    let hideTimer;
    let savedTitle = null;
    let pointerFocus = false;
    let dismissing = false;
    let pinned = null;
    let dismissed = null;

    function find(target) {
        const element = target instanceof Element ? target.closest(`${selectors},.context-help-icon`) : null;
        const entry = element && (icons.get(element) || entries.find((item) => element.matches(item.selector)));
        return entry ? { element, entry } : null;
    }

    function decorate(root) {
        const elements = root instanceof Element && root.matches(selectors) ? [root] : [];
        elements.push(...root.querySelectorAll(selectors));
        for (const element of elements) {
            // Keep live job-cell markup unchanged so ordinary polls can reuse it.
            if (element.matches('button,input,select,textarea')) element.classList.add('context-help-target');
            const entry = entries.find((item) => element.matches(item.selector));
            if (!entry?.info || element.nextElementSibling?.classList.contains('context-help-icon')) continue;
            const icon = doc.createElement('button');
            icon.type = 'button';
            icon.className = 'context-help-icon';
            icon.setAttribute('aria-label', entry.info);
            icon.textContent = 'ⓘ';
            icons.set(icon, entry);
            element.classList.add('context-help-heading');
            element.after(icon);
        }
    }

    function helpText() {
        const { element, entry } = active;
        if (element.matches(':disabled,[aria-disabled="true"]')) {
            const reason = element.getAttribute('title') || savedTitle;
            if (reason && reason !== element.textContent.trim() && reason !== element.getAttribute('aria-label')) return reason.slice(0, 400);
            return entry.unavailable || `${entry.text} Wait for current work to finish, or check the required setup and permissions.`;
        }
        return entry.text;
    }

    function position() {
        if (!active || tip.hidden) return;
        const rect = active.element.getBoundingClientRect();
        if (!active.element.isConnected || !active.element.getClientRects().length || rect.bottom <= 0 || rect.top >= innerHeight) return hide();
        const box = tip.getBoundingClientRect();
        const left = Math.max(12, Math.min(rect.left + (rect.width - box.width) / 2, innerWidth - box.width - 12));
        const top = rect.top >= box.height + 20 ? rect.top - box.height - 8 : rect.bottom + 8;
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(8, Math.min(top, innerHeight - box.height - 8))}px`;
    }

    function hide(suppress = false) {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        if (active) {
            if (suppress) dismissed = active.element;
            const element = active.element;
            const descriptions = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tip.id);
            if (descriptions.length) element.setAttribute('aria-describedby', descriptions.join(' '));
            else element.removeAttribute('aria-describedby');
            if (savedTitle !== null && !element.hasAttribute('title')) element.setAttribute('title', savedTitle);
        }
        if (tip.matches(':popover-open')) tip.hidePopover();
        tip.hidden = true;
        active = null;
        pinned = null;
        savedTitle = null;
    }

    function show(binding) {
        if (dismissed === binding.element) return;
        if (active?.element === binding.element && !tip.hidden) return;
        hide();
        if (!binding.element.isConnected || !binding.element.getClientRects().length) return;
        active = binding;
        savedTitle = binding.element.getAttribute('title');
        tip.textContent = helpText();
        binding.element.removeAttribute('title');
        const describedBy = binding.element.getAttribute('aria-describedby');
        binding.element.setAttribute('aria-describedby', [describedBy, tip.id].filter(Boolean).join(' '));
        // A tooltip in a modal belongs to that modal, including its accessibility tree.
        (binding.element.closest('dialog[open]') || doc.body).append(tip);
        tip.hidden = false;
        if (typeof tip.showPopover === 'function') tip.showPopover();
        position();
    }

    doc.addEventListener('pointerover', (event) => {
        if (event.pointerType === 'touch') return;
        if (tip.contains(event.target)) { clearTimeout(hideTimer); return; }
        const binding = find(event.target);
        if (!binding || binding.element.contains(event.relatedTarget)) return;
        hide();
        showTimer = setTimeout(() => { if (binding.element.matches(':hover')) show(binding); }, 350);
    });
    doc.addEventListener('pointerout', (event) => {
        const binding = find(event.target);
        if (binding?.element.contains(event.relatedTarget) || tip.contains(event.relatedTarget)) return;
        if (!binding && !tip.contains(event.target)) return;
        dismissed = null;
        clearTimeout(showTimer);
        hideTimer = setTimeout(() => hide(), 90);
    });
    doc.addEventListener('focusin', (event) => {
        const binding = find(event.target);
        if (!binding) return hide();
        if (!pointerFocus && !dismissing) show(binding);
    });
    doc.addEventListener('focusout', (event) => {
        // Clicking an already-hovered helper should not close and reopen it.
        if (active?.element.contains(event.relatedTarget)) return;
        dismissed = null;
        hide();
    });
    doc.addEventListener('pointerdown', (event) => {
        pointerFocus = true;
        const binding = find(event.target);
        // Pointer help should preserve the current editing focus and scroll position.
        // Keyboard users still reach info buttons normally with Tab.
        if (binding && icons.has(binding.element)) event.preventDefault();
    }, true);
    doc.addEventListener('click', (event) => {
        pointerFocus = false;
        const binding = find(event.target);
        if (binding && icons.has(binding.element)) {
            event.preventDefault();
            event.stopPropagation();
            if (pinned === binding.element) return hide(true);
            dismissed = null;
            show(binding);
            pinned = binding.element;
        } else hide(true);
    }, true);
    doc.addEventListener('keydown', (event) => {
        pointerFocus = false;
        if (event.key === 'Escape' && active) {
            dismissing = true;
            setTimeout(() => { dismissing = false; }, 0);
            // Preserve the existing one-key dismissal of compact disclosure menus.
            const menu = active.element.closest('.board-menu,.board-model-menu,.ai-attach-menu,.hero-theme-menu,.theme-menu,.plan-panel,.support-menu');
            if (!menu || active.element.closest('dialog[open]')) {
                event.preventDefault();
                event.stopPropagation();
            }
            hide(true);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) hide();
    }, true);
    // Scrolling an anchor into view can happen during the hover delay.
    // Dismiss a visible tooltip without cancelling a still-valid pending hover.
    doc.addEventListener('scroll', () => { if (active) hide(); }, true);
    doc.addEventListener('toggle', () => { if (active && !active.element.getClientRects().length) hide(); }, true);
    window.addEventListener('resize', position);
    window.addEventListener('blur', () => hide());

    const observer = new MutationObserver((changes) => {
        for (const change of changes) {
            for (const node of change.addedNodes) if (node instanceof Element && node !== tip) decorate(node);
        }
        if (!active) return;
        if (!active.element.isConnected) return hide();
        const title = active.element.getAttribute('title');
        if (title !== null) { savedTitle = title; active.element.removeAttribute('title'); }
        active = find(active.element) || active;
        const text = helpText();
        if (tip.textContent !== text) { tip.textContent = text; position(); }
    });
    decorate(doc);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'title', 'data-state'] });
    window.addEventListener('beforeunload', () => { hide(); observer.disconnect(); }, { once: true });
}

if (typeof document !== 'undefined') initHelpTooltips();
