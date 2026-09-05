import type { ObjectAnalysisResult } from './model';

const MAX_SOURCE_LENGTH = 50000;
const MAX_RELATIONSHIPS = 120;

function compact(value: unknown, limit = 240) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Builds the bounded, source-first context sent to the configured AI provider. */
export function buildObjectAnalysisAiContext(result: ObjectAnalysisResult, sourceText: string) {
    const nodes = new Map(result.nodes.map((node) => [node.id, node]));
    const relationships = result.edges.slice(0, MAX_RELATIONSHIPS).map((edge) => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        return `${from?.library}/${from?.name} ${edge.relationship} ${to?.library}/${to?.name} type=${to?.type} evidence=${edge.evidence} confidence=${edge.confidence}${edge.detail ? ` detail=${compact(edge.detail)}` : ''}`;
    });

    return [
        'OBJECT ANALYSIS INPUT',
        'The source text and system evidence below are the only facts available for this report.',
        'System evidence is authoritative for discovered IBM i object relationships. Source text explains intent and business behavior.',
        'Do not invent tables, programs, fields, steps, or business rules. Mark any interpretation as inferred and call out missing evidence.',
        '',
        `Root: ${result.root.library}/${result.root.name} ${result.root.type}`,
        `Analysis source: ${result.source === 'live' ? 'connected IBM i' : 'local source fixture'}`,
        `Library list order: ${result.scope.libraries.join(', ') || 'none'}`,
        `Readiness: ${result.readiness.label} (${result.readiness.score}/100)`,
        '',
        'SYSTEM EVIDENCE:',
        ...(result.systemEvidence?.commands.length
            ? result.systemEvidence.commands.map((command) => `${command.name}: ${command.status}; rows=${command.rowCount}; ${command.detail || command.command}`)
            : ['No IBM i command evidence was collected. Treat relationships as source/catalog evidence only.']),
        ...(result.systemEvidence?.notes || []),
        '',
        'DISCOVERED RELATIONSHIPS:',
        ...(relationships.length ? relationships : ['None']),
        '',
        'SOURCE SIGNALS:',
        ...(result.sourceSignals.length ? result.sourceSignals : ['None']),
        '',
        'DETERMINISTIC BUSINESS LOGIC FINDINGS:',
        ...(result.businessLogic?.findings.length
            ? result.businessLogic.findings.map((finding) => `${finding.category}: ${finding.title}; ${compact(finding.detail)}; evidence=${finding.evidence}; confidence=${finding.confidence}${finding.line ? `; line=${finding.line}` : ''}`)
            : ['None detected']),
        '',
        'PROGRAM FLOW:',
        ...(result.programFlow?.length
            ? result.programFlow.map((step) => `${step.sequence}. ${step.kind}: ${step.title}; ${compact(step.detail)}${step.line ? `; line=${step.line}` : ''}`)
            : ['No ordered flow detected']),
        '',
        'CONVERSION PLAN:',
        ...(result.conversionPlan?.length
            ? result.conversionPlan.map((item) => `${item.order}. ${item.phase} [${item.priority}]: ${item.title}; ${compact(item.action)}`)
            : ['No deterministic plan available']),
        '',
        'SOURCE TEXT:',
        sourceText.slice(0, MAX_SOURCE_LENGTH),
        sourceText.length > MAX_SOURCE_LENGTH ? '\n[Source text truncated by iMonitor.]' : ''
    ].join('\n');
}

export function buildObjectAnalysisAiQuestion(result: ObjectAnalysisResult) {
    return [
        `Prepare a business-logic and modernization report for ${result.root.library}/${result.root.name}.`,
        'Use the deterministic findings as evidence and refine them into Markdown sections: Business purpose, business rules, execution flow, inputs and outputs, dependency impact, operational contracts, conversion plan, test scenarios, risks, and unknowns.',
        'Group dependency impact into programs, service programs, files/tables, data queues/data areas/environment, and other objects.',
        'Explain the dependency tree from the selected root using the supplied evidence. Keep the report useful to an operator and developer, and never claim that you executed an action.'
    ].join(' ');
}
