import type { AnalysisRelationship, AnalysisObjectType } from './model';

export interface SourceReference {
    targetName: string;
    targetLibrary?: string;
    targetType: AnalysisObjectType;
    relationship: AnalysisRelationship;
    confidence: 'confirmed' | 'likely' | 'possible';
    line: number;
    detail: string;
}

export interface SourceAnalysis {
    references: SourceReference[];
    signals: string[];
}

function cleanTarget(value: string) {
    return value
        .replace(/[(),'";]/g, '')
        .trim()
        .toUpperCase();
}

function parseQualifiedTarget(value: string) {
    const target = cleanTarget(value);
    const parts = target.split('/').filter(Boolean);
    if (parts.length >= 2) {
        return { targetLibrary: parts[0], targetName: parts[parts.length - 1] };
    }
    const dotted = target.split('.').filter(Boolean);
    if (dotted.length >= 2) {
        return { targetLibrary: dotted[dotted.length - 2], targetName: dotted[dotted.length - 1] };
    }
    return { targetName: target };
}

function addReference(
    references: SourceReference[],
    line: number,
    rawTarget: string,
    targetType: AnalysisObjectType,
    relationship: AnalysisRelationship,
    confidence: SourceReference['confidence'],
    detail: string
) {
    const parsed = parseQualifiedTarget(rawTarget);
    if (!parsed.targetName || parsed.targetName.length < 2) {
        return;
    }

    references.push({
        ...parsed,
        targetType,
        relationship,
        confidence,
        line,
        detail
    });
}

export function parseRpgSource(source: string): SourceAnalysis {
    const references: SourceReference[] = [];
    const signals = new Set<string>();
    const lines = source.split(/\r?\n/);
    let inSqlStatement = false;

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('//') || line.startsWith('*')) {
            return;
        }

        if (/\bEXEC\s+SQL\b/i.test(line)) inSqlStatement = true;

        const copyMatch = line.match(/^\/(?:COPY|INCLUDE)\s+(.+?)(?:\s|$)/i);
        if (copyMatch) {
            addReference(references, lineNumber, copyMatch[1], '*COPY', 'includes', 'confirmed', 'Source include directive');
            signals.add('Source includes copy/include members.');
        }

        const externalProgramMatch = line.match(/\bEXTPGM\s*\(\s*['"]?([^'"\s)]+)|\bCALL\s+(?:PGM\s*\(\s*)?['"]?([^'"\s)]+)/i);
        if (externalProgramMatch) {
            addReference(
                references,
                lineNumber,
                externalProgramMatch[1] || externalProgramMatch[2],
                '*PGM',
                'calls',
                externalProgramMatch[1] ? 'confirmed' : 'possible',
                'External program call'
            );
        }

        const externalProcedureMatch = line.match(/\bEXTPROC\s*\(\s*['"]?([^'"\s)]+)/i);
        if (externalProcedureMatch) {
            addReference(references, lineNumber, externalProcedureMatch[1], '*SRVPGM', 'uses', 'possible', 'External procedure reference');
            signals.add('External procedures or service-program APIs are referenced.');
        }

        const fileDeclarationMatch = line.match(/^DCL-F\s+([A-Z0-9_$#@]+)/i);
        if (fileDeclarationMatch) {
            addReference(references, lineNumber, fileDeclarationMatch[1], '*FILE', 'uses', 'confirmed', 'RPG file declaration');
            signals.add('RPG file declarations were found.');
        }

        const externalFileMatch = line.match(/\bEXT(?:FILE|NAME)\s*\(\s*['"]?([^'"\s)]+)/i);
        if (externalFileMatch) {
            addReference(references, lineNumber, externalFileMatch[1], '*FILE', 'uses', 'confirmed', 'External file declaration');
            signals.add('External database/file definitions are used.');
        }

        const keyedDatabaseMatch = line.match(/\b(?:CHAIN|SETLL|READE)\s+['"]?[A-Z0-9_$#./]+\s+['"]?([A-Z0-9_$#./]+)/i);
        const directDatabaseMatch = line.match(/\b(?:READ|READC|WRITE|UPDATE|DELETE)\s+['"]?([A-Z0-9_$#./]+)/i);
        const databaseMatch = keyedDatabaseMatch || directDatabaseMatch;
        if (databaseMatch) {
            addReference(references, lineNumber, databaseMatch[1], '*FILE', 'reads', 'likely', 'Record-level database operation');
            if (/\b(?:WRITE|UPDATE|DELETE)\b/i.test(line)) {
                references[references.length - 1].relationship = 'writes';
            }
            signals.add('Record-level database operations were found.');
        }

        const sqlMatch = inSqlStatement
            ? line.match(/\b(?:FROM|JOIN|UPDATE|DELETE\s+FROM|INSERT\s+INTO|MERGE\s+INTO)\s+([A-Z0-9_$#./]+)/i)
            : null;
        if (sqlMatch) {
            const writesData = /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|MERGE\s+INTO)\b/i.test(line);
            addReference(references, lineNumber, sqlMatch[1], '*FILE', writesData ? 'writes' : 'reads', 'likely', 'Embedded SQL reference');
            signals.add('Embedded SQL was found.');
        }

        const submitMatch = line.match(/\bSBMJOB\b.*?\bPGM\s*\(\s*['"]?([^'"\s)]+)/i);
        if (submitMatch) {
            addReference(references, lineNumber, submitMatch[1], '*PGM', 'submits', 'confirmed', 'Submitted batch job program');
            signals.add('The program submits work to a batch job.');
        }

        const dataQueueMatch = line.match(/\b(?:DTAQ|DATA_QUEUE)\s*\(\s*['"]?([^'"\s)]+)/i);
        if (dataQueueMatch) {
            addReference(references, lineNumber, dataQueueMatch[1], '*DTAQ', 'references', 'confirmed', 'Data queue reference');
            signals.add('Data queues are used.');
        }

        const dataAreaMatch = line.match(/\b(?:DTAARA|DATA_AREA)\s*\(\s*['"]?([^'"\s)]+)/i);
        if (dataAreaMatch) {
            addReference(references, lineNumber, dataAreaMatch[1], '*DTAARA', 'references', 'confirmed', 'Data area reference');
            signals.add('Data areas are used.');
        }

        const environmentMatch = line.match(/\b(?:ENVVAR|GETENV|SETENV)\s*\(\s*['"]?([^'"\s)]+)/i);
        if (environmentMatch) {
            addReference(references, lineNumber, environmentMatch[1], '*ENVVAR', 'references', 'confirmed', 'Environment variable reference');
            signals.add('Environment variables are used.');
        }

        if (/\b(?:QCMDEXC|CALLP\s+QCMDEXC)\b/i.test(line)) {
            signals.add('Dynamic CL command execution was found.');
            const submittedProgramMatch = line.match(/\bPGM\s*\(\s*['"]?([^'"\s)]+)/i);
            if (submittedProgramMatch) {
                addReference(references, lineNumber, submittedProgramMatch[1], '*PGM', 'submits', 'likely', 'Program submitted through a dynamic CL command');
            }
        }
        if (/\b(?:COMMIT|ROLLBACK|STRCMTCTL|ENDCMTCTL)\b/i.test(line)) {
            signals.add('Commitment control or transaction boundaries were found.');
        }
        if (/\bCALLP\b/i.test(line) && !/\b(?:QCMDEXC)\b/i.test(line)) {
            signals.add('Procedure calls were found and may resolve through service programs.');
        }
        if (inSqlStatement && /;\s*$/.test(line)) inSqlStatement = false;
    });

    return {
        references,
        signals: Array.from(signals)
    };
}
