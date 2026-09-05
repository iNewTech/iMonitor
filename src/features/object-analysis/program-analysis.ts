import type {
    AnalysisConfidence,
    BusinessLogicCategory,
    BusinessLogicFinding,
    ConversionPlanItem,
    ObjectAnalysisResult,
    ProgramFlowKind,
    ProgramFlowStep
} from './model';
import { parseRpgSource, type SourceReference } from './rpg-parser';

function compactSource(value: string) {
    return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function targetLabel(reference: SourceReference, result?: ObjectAnalysisResult) {
    const resolved = result?.nodes.find((node) => (
        node.name === reference.targetName
        && (!reference.targetLibrary || node.library === reference.targetLibrary)
        && (node.type === reference.targetType
            || (reference.targetType === '*SRVPGM' && ['*SRVPGM', '*MODULE'].includes(node.type)))
    ));
    const library = reference.targetLibrary || resolved?.library;
    return `${library ? `${library}/` : ''}${reference.targetName}`;
}

function referenceFlowKind(reference: SourceReference): ProgramFlowKind {
    if (reference.relationship === 'submits') return 'batch-submit';
    if (reference.targetType === '*PGM') return 'program-call';
    if (reference.targetType === '*SRVPGM' || reference.targetType === '*MODULE') return 'service-call';
    if (reference.targetType === '*FILE') return reference.relationship === 'writes' ? 'data-write' : 'data-read';
    if (['*DTAQ', '*DTAARA', '*ENVVAR', '*JOBQ', '*SBS'].includes(reference.targetType)) return 'runtime-resource';
    return 'service-call';
}

function referenceTitle(reference: SourceReference, result: ObjectAnalysisResult) {
    switch (referenceFlowKind(reference)) {
        case 'batch-submit': return `Submit ${targetLabel(reference, result)}`;
        case 'program-call': return `Call ${targetLabel(reference, result)}`;
        case 'service-call': return `Use ${targetLabel(reference, result)}`;
        case 'data-write': return `Write ${targetLabel(reference, result)}`;
        case 'data-read': return `Read ${targetLabel(reference, result)}`;
        case 'runtime-resource': return `Use ${reference.targetType} ${targetLabel(reference, result)}`;
        default: return `Reference ${targetLabel(reference, result)}`;
    }
}

function createFlowSteps(sourceText: string, result: ObjectAnalysisResult, rootLabel: string): ProgramFlowStep[] {
    const lines = sourceText.split(/\r?\n/);
    const parsed = parseRpgSource(sourceText);
    const rawSteps: Omit<ProgramFlowStep, 'id' | 'sequence'>[] = [{
        kind: 'entry',
        title: `Enter ${rootLabel}`,
        detail: 'Program execution starts.',
        line: 1
    }];

    parsed.references.forEach((reference) => {
        rawSteps.push({
            kind: referenceFlowKind(reference),
            title: referenceTitle(reference, result),
            detail: reference.detail,
            line: reference.line,
            sourceText: compactSource(lines[reference.line - 1] || ''),
            target: targetLabel(reference, result)
        });
    });

    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();
        const lineNumber = index + 1;
        if (!line || line.startsWith('//') || line.startsWith('*')) return;
        if (/^(IF|ELSEIF|WHEN)\b/i.test(line)) {
            rawSteps.push({
                kind: 'condition',
                title: /^WHEN\b/i.test(line) ? 'Evaluate branch' : 'Evaluate condition',
                detail: compactSource(line.replace(/;$/, '')),
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        if (/^(DCL-PROC|BEGSR)\b/i.test(line)) {
            rawSteps.push({
                kind: 'procedure',
                title: 'Enter procedure or subroutine',
                detail: compactSource(line.replace(/;$/, '')),
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        if (/^(DOU|DOW|FOR)\b/i.test(line)) {
            rawSteps.push({
                kind: 'loop',
                title: 'Repeat processing',
                detail: compactSource(line.replace(/;$/, '')),
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        const screenMatch = line.match(/\b(EXFMT|READC|WRITE)\s+([A-Z0-9_$#@]+)/i);
        if (screenMatch && screenMatch[1].toUpperCase() === 'EXFMT') {
            rawSteps.push({
                kind: 'screen-io',
                title: `Display and read ${screenMatch[2].toUpperCase()}`,
                detail: 'Interactive screen exchange waits for operator input.',
                line: lineNumber,
                sourceText: compactSource(line),
                target: screenMatch[2].toUpperCase()
            });
        }
        if (/\b(MONITOR|ON-ERROR)\b/i.test(line)) {
            rawSteps.push({
                kind: 'error-path',
                title: /ON-ERROR/i.test(line) ? 'Handle error' : 'Begin protected operation',
                detail: compactSource(line.replace(/;$/, '')),
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        if (/\b(COMMIT|ROLLBACK|STRCMTCTL|ENDCMTCTL)\b/i.test(line)) {
            const operation = line.match(/\b(COMMIT|ROLLBACK|STRCMTCTL|ENDCMTCTL)\b/i)?.[1]?.toUpperCase() || 'TRANSACTION';
            rawSteps.push({
                kind: 'transaction',
                title: operation,
                detail: 'Transaction boundary affects data consistency and recovery behavior.',
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        if (/^(RETURN|\*INLR\s*=\s*\*ON)\b/i.test(line)) {
            rawSteps.push({
                kind: 'exit',
                title: 'Exit program path',
                detail: 'Execution can return from the program at this point.',
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
    });

    const unique = new Map<string, Omit<ProgramFlowStep, 'id' | 'sequence'>>();
    rawSteps.forEach((step) => {
        const key = `${step.line || 0}|${step.kind}|${step.title}`;
        if (!unique.has(key)) unique.set(key, step);
    });
    return Array.from(unique.values())
        .sort((left, right) => (left.line || 0) - (right.line || 0))
        .slice(0, 160)
        .map((step, index) => ({ ...step, id: `flow-${index + 1}`, sequence: index + 1 }));
}

function addFinding(
    findings: BusinessLogicFinding[],
    input: Omit<BusinessLogicFinding, 'id'>
) {
    const key = `${input.line || 0}|${input.category}|${input.title}|${input.detail}`;
    if (findings.some((item) => `${item.line || 0}|${item.category}|${item.title}|${item.detail}` === key)) return;
    findings.push({ ...input, id: `rule-${findings.length + 1}` });
}

function createBusinessLogic(result: ObjectAnalysisResult, sourceText: string) {
    const findings: BusinessLogicFinding[] = [];
    const lines = sourceText.split(/\r?\n/);
    const confidence: AnalysisConfidence = result.source === 'live' ? 'confirmed' : 'likely';

    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();
        const lineNumber = index + 1;
        if (!line || line.startsWith('*')) return;
        if (/^\/\//.test(line)) {
            const comment = compactSource(line.replace(/^\/\/\s*/, ''));
            if (comment) addFinding(findings, {
                category: 'data-rule',
                title: 'Documented business intent',
                detail: comment,
                confidence: 'possible',
                evidence: 'source',
                line: lineNumber,
                sourceText: compactSource(line)
            });
            return;
        }
        if (/^(IF|ELSEIF)\b/i.test(line)) {
            const validation = /%FOUND|%EOF|=\s*\*BLANKS|=\s*0|<>|>=|<=/i.test(line);
            addFinding(findings, {
                category: validation ? 'validation' : 'decision',
                title: validation ? 'Validate program state' : 'Business decision',
                detail: compactSource(line.replace(/;$/, '')),
                confidence,
                evidence: 'source',
                line: lineNumber,
                sourceText: compactSource(line)
            });
        }
        if (/^(DCL-PI|DCL-PR|PARM)\b/i.test(line)) addFinding(findings, {
            category: 'input-output',
            title: 'Program interface contract',
            detail: compactSource(line),
            confidence,
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
        if (/\b(MONITOR|ON-ERROR)\b/i.test(line)) addFinding(findings, {
            category: 'error-handling',
            title: 'Error handling path',
            detail: compactSource(line),
            confidence,
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
        if (/\b(COMMIT|ROLLBACK|STRCMTCTL|ENDCMTCTL)\b/i.test(line)) addFinding(findings, {
            category: 'transaction',
            title: 'Transaction rule',
            detail: compactSource(line),
            confidence,
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
        if (/\b(EVAL|%DEC|%INT|%REM|%DIFF|%DAYS|%MONTHS)\b|\w+\s*=\s*[^=].*[+*/-]|\bRETURN\b\s+.+[+*/-]/i.test(line)) addFinding(findings, {
            category: 'calculation',
            title: 'Calculation or transformation',
            detail: compactSource(line),
            confidence: 'possible',
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
        if (/\b(QCMDEXC|SBMJOB|DTAQ|DTAARA|ENVVAR|CALLP|EXTPROC)\b/i.test(line)) addFinding(findings, {
            category: /\b(QCMDEXC|SBMJOB)\b/i.test(line) ? 'batch-flow' : 'integration',
            title: 'External runtime interaction',
            detail: compactSource(line),
            confidence,
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
        if (/\bEXFMT\s+[A-Z0-9_$#@]+/i.test(line)) addFinding(findings, {
            category: 'screen-behavior',
            title: 'Interactive screen exchange',
            detail: compactSource(line),
            confidence,
            evidence: 'source',
            line: lineNumber,
            sourceText: compactSource(line)
        });
    });

    const rootEdges = result.edges.filter((edge) => edge.from === result.root.id);
    rootEdges.filter((edge) => edge.relationship === 'reads' || edge.relationship === 'writes').forEach((edge) => {
        const target = result.nodes.find((node) => node.id === edge.to);
        if (!target) return;
        addFinding(findings, {
            category: 'data-rule',
            title: edge.relationship === 'writes' ? `Changes ${target.name}` : `Reads ${target.name}`,
            detail: `${target.library}/${target.name} is part of the program's data contract.`,
            confidence: edge.confidence,
            evidence: edge.evidence === 'compiled' ? 'compiled' : edge.evidence === 'runtime' ? 'runtime' : 'source',
            line: edge.line
        });
    });

    const dataObjects = new Set(rootEdges.filter((edge) => {
        const target = result.nodes.find((node) => node.id === edge.to);
        return target?.type === '*FILE';
    }).map((edge) => edge.to)).size;
    const integrationTypes = new Set(['*PGM', '*SRVPGM', '*MODULE', '*DTAQ', '*DTAARA', '*ENVVAR', '*JOBD', '*JOBQ', '*SBS', '*CMD']);
    const calls = rootEdges.filter((edge) => integrationTypes.has(
        result.nodes.find((node) => node.id === edge.to)?.type || '*UNKNOWN'
    )).length;
    const summary = `${result.root.library}/${result.root.name} contains ${findings.length} detected business or runtime rule${findings.length === 1 ? '' : 's'}, accesses ${dataObjects} data object${dataObjects === 1 ? '' : 's'}, and has ${calls} call or integration relationship${calls === 1 ? '' : 's'}.`;
    return { summary, findings: findings.slice(0, 160) };
}

function createConversionPlan(result: ObjectAnalysisResult, flow: ProgramFlowStep[]): ConversionPlanItem[] {
    const plan: Array<Omit<ConversionPlanItem, 'id' | 'order'>> = [];
    const add = (item: Omit<ConversionPlanItem, 'id' | 'order'>) => plan.push(item);
    add({
        phase: 'Discover',
        priority: result.unresolvedReferences.length ? 'critical' : 'high',
        title: 'Confirm the dependency boundary',
        action: result.unresolvedReferences.length
            ? `Resolve ${result.unresolvedReferences.length} missing object reference${result.unresolvedReferences.length === 1 ? '' : 's'} before conversion.`
            : 'Freeze the confirmed program, file, service-program, and runtime-resource inventory.',
        reason: 'Conversion scope and build order depend on a complete dependency path.',
        status: result.unresolvedReferences.length ? 'required' : 'review'
    });
    if (result.edges.some((edge) => result.nodes.find((node) => node.id === edge.to)?.type === '*FILE')) add({
        phase: 'Design', priority: 'high', title: 'Map the data contract',
        action: 'Document record formats, keys, SQL statements, read/write intent, locking, and null/default behavior for every file.',
        reason: 'Database semantics are commonly hidden in RPG record-level access and DDS metadata.', status: 'required'
    });
    if (flow.some((step) => step.kind === 'transaction')) add({
        phase: 'Design', priority: 'critical', title: 'Preserve transaction boundaries',
        action: 'Map commitment control, commit, rollback, and failure paths to one target transaction strategy.',
        reason: 'Changing transaction boundaries can produce partial updates or duplicate work.', status: 'required'
    });
    if (flow.some((step) => ['program-call', 'service-call', 'batch-submit', 'runtime-resource'].includes(step.kind))) add({
        phase: 'Design', priority: 'high', title: 'Define external contracts',
        action: 'Specify program parameters, service procedures, submitted jobs, queues, data areas, and environment values as explicit interfaces.',
        reason: 'IBM i runtime behavior must be represented in the target architecture.', status: 'required'
    });
    if (flow.some((step) => step.kind === 'screen-io')) add({
        phase: 'Design', priority: 'high', title: 'Redesign interactive screen behavior',
        action: 'Map display formats, indicators, validation, function keys, and workstation-state transitions to explicit UI and API contracts.',
        reason: '5250 screen flow combines presentation, validation, and program state that must be separated carefully.', status: 'required'
    });
    add({
        phase: 'Build', priority: 'high', title: 'Implement behavior in dependency order',
        action: 'Build stable data and integration adapters first, then translate the program flow and business rules.',
        reason: 'The program cannot be verified until its downstream contracts are available.', status: 'required'
    });
    add({
        phase: 'Verify', priority: 'critical', title: 'Create equivalence tests',
        action: 'Turn every validation, decision, calculation, data update, transaction, and error path in this report into a test case.',
        reason: 'Behavioral equivalence is the acceptance criterion for modernization.', status: 'required'
    });
    add({
        phase: 'Cutover', priority: 'medium', title: 'Plan coexistence and rollback',
        action: 'Define data synchronization, job scheduling, monitoring, deployment order, and rollback checkpoints.',
        reason: 'IBM i and the target service may need to coexist during staged migration.', status: 'review'
    });
    return plan.map((item, index) => ({ ...item, id: `plan-${index + 1}`, order: index + 1 }));
}

/** Adds deterministic, source-backed business logic, flow, and conversion planning to one analysis result. */
export function buildDetailedProgramAnalysis(result: ObjectAnalysisResult, sourceText: string): ObjectAnalysisResult {
    const rootLabel = `${result.root.library}/${result.root.name}`;
    const programFlow = createFlowSteps(sourceText, result, rootLabel);
    return {
        ...result,
        businessLogic: createBusinessLogic(result, sourceText),
        programFlow,
        conversionPlan: createConversionPlan(result, programFlow)
    };
}
