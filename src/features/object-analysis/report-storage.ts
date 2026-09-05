import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
    formatObjectAnalysisReport,
    type ObjectAnalysisReportArtifact,
    type ObjectAnalysisResult
} from './model';

interface ProgramReportMapEntry {
    key: string;
    library: string;
    sourceFile: string;
    member: string;
    sourcePath: string;
    reportJson: string;
    reportMarkdown: string;
    sourceHash: string;
    generatedAt: string;
    approvedAt: string;
    approvedBy: string;
}

interface ProgramReportMap {
    schema: 'imonitor-program-analysis-map';
    version: 1;
    updatedAt: string;
    programs: Record<string, ProgramReportMapEntry>;
}

function safeName(value: string, fallback: string) {
    const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_$#@.-]+/g, '_');
    return normalized || fallback;
}

function getSourceLocation(result: ObjectAnalysisResult) {
    const parts = String(result.root.sourcePath || '').split('/').filter(Boolean);
    const fileName = parts[parts.length - 1] || result.root.name;
    return {
        library: safeName(result.root.library, 'UNKNOWNLIB'),
        sourceFile: safeName(parts[parts.length - 2] || 'SOURCE', 'SOURCE'),
        member: safeName(fileName.replace(/\.[^.]+$/, '') || result.root.name, 'UNKNOWN')
    };
}

function newProgramMap(): ProgramReportMap {
    return {
        schema: 'imonitor-program-analysis-map',
        version: 1,
        updatedAt: new Date().toISOString(),
        programs: {}
    };
}

async function readProgramMap(mapFile: string) {
    try {
        const parsed = JSON.parse(await readFile(mapFile, 'utf8')) as Partial<ProgramReportMap>;
        if (parsed.schema === 'imonitor-program-analysis-map' && parsed.programs && typeof parsed.programs === 'object') {
            return { ...newProgramMap(), ...parsed, programs: parsed.programs } as ProgramReportMap;
        }
    } catch {
        // A missing or invalid old map must not prevent the current report from being saved.
    }
    return newProgramMap();
}

/** Saves one complete analysis beside the selected source tree and updates the source-to-report map. */
export async function persistObjectAnalysisReport(
    rootDirectory: string,
    result: ObjectAnalysisResult,
    sourceText: string,
    mode: ObjectAnalysisReportArtifact['mode'] = 'source-directory'
): Promise<ObjectAnalysisReportArtifact> {
    const location = getSourceLocation(result);
    const key = `${location.library}/${location.sourceFile}/${location.member}`;
    const sourceHash = createHash('sha256').update(sourceText, 'utf8').digest('hex');
    const reportRoot = path.join(rootDirectory, 'imonitor-analysis', 'reports');
    const programDirectory = path.join(reportRoot, location.library);
    const jsonFile = path.join(programDirectory, `${location.member}.analysis.json`);
    const markdownFile = path.join(programDirectory, `${location.member}.analysis.md`);
    const mapFile = path.join(reportRoot, 'program-map.json');
    const relativeJson = path.relative(rootDirectory, jsonFile);
    const relativeMarkdown = path.relative(rootDirectory, markdownFile);
    const relativeMap = path.relative(rootDirectory, mapFile);

    const artifact: ObjectAnalysisReportArtifact = {
        key,
        mode,
        relativePath: relativeJson,
        markdownPath: relativeMarkdown,
        mapPath: relativeMap,
        sourceHash,
        message: mode === 'source-directory'
            ? `Report mapped to ${key} and saved with the source directory.`
            : `Report mapped to ${key} and saved in local app storage.`
    };

    try {
        await mkdir(programDirectory, { recursive: true });
        result.reportArtifact = artifact;
        await writeFile(jsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        await writeFile(markdownFile, `${formatObjectAnalysisReport(result)}\n`, 'utf8');

        const reportMap = await readProgramMap(mapFile);
        reportMap.updatedAt = result.generatedAt;
        reportMap.programs[key] = {
            key,
            library: location.library,
            sourceFile: location.sourceFile,
            member: location.member,
            sourcePath: result.root.sourcePath || '',
            reportJson: relativeJson,
            reportMarkdown: relativeMarkdown,
            sourceHash,
            generatedAt: result.generatedAt,
            approvedAt: result.approval?.approvedAt || result.generatedAt,
            approvedBy: result.approval?.approvedBy || 'operator'
        };
        await writeFile(mapFile, `${JSON.stringify(reportMap, null, 2)}\n`, 'utf8');
        return artifact;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The analysis report could not be stored.';
        const failed: ObjectAnalysisReportArtifact = {
            key,
            mode: 'error',
            sourceHash,
            message: 'Analysis completed, but its mapped report could not be saved automatically.',
            error: message
        };
        result.reportArtifact = failed;
        return failed;
    }
}
