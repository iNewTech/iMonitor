import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { classifyAnalysisFile, type AnalysisFileNode, type AnalysisFileKind } from './model';

export interface LocalSourceLibrary {
    name: string;
    path: string;
    relativePath: string;
}

// Reports and compile scripts are outputs even when their extension is source-like.
function isExcludedLocalEntry(name: string) {
    return name.startsWith('.') || name.toLowerCase() === 'imonitor-analysis';
}

async function sourceEntries(directory: string) {
    return (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => !isExcludedLocalEntry(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
}

/** Discover physical paths independently of the ordered object lookup list. */
export async function discoverLocalLibraries(rootPath: string): Promise<LocalSourceLibrary[]> {
    const entries = await sourceEntries(rootPath);
    const wrapper = ['userlib', 'user-libraries'].map((name) => entries.find((entry) => (
        entry.isDirectory() && entry.name.toLowerCase() === name
    ))).find(Boolean);
    const libraryRoot = wrapper ? path.join(rootPath, wrapper.name) : rootPath;
    const children = wrapper ? await sourceEntries(libraryRoot) : entries;
    const directories = children.filter((entry) => entry.isDirectory());
    const hasMembers = (items: typeof entries) => items.some((entry) => (
        entry.isFile() && classifyAnalysisFile(entry.name).analyzable
    ));
    const hasCatalog = (items: typeof entries) => items.some((entry) => (
        entry.isFile() && entry.name.toLowerCase() === 'objects.json'
    ));

    // Direct members/catalogs identify a selected library. Otherwise distinguish
    // LIB/SRCPF/member from SRCPF/member by inspecting actual member depth.
    let selectedLibrary = !wrapper && (hasCatalog(entries) || hasMembers(entries));
    if (!wrapper && !selectedLibrary && !['userlib', 'user-libraries'].includes(path.basename(rootPath).toLowerCase())) {
        const childEntries = await Promise.all(directories.map((entry) => sourceEntries(path.join(rootPath, entry.name))));
        const nestedLibraries = childEntries.some(hasCatalog) || (await Promise.all(childEntries.map(async (items, index) => (
            (await Promise.all(items.filter((entry) => entry.isDirectory()).map((entry) => (
                sourceEntries(path.join(rootPath, directories[index].name, entry.name))
            )))).some(hasMembers)
        )))).some(Boolean);
        selectedLibrary = !nestedLibraries && childEntries.some(hasMembers);
    }
    if (selectedLibrary) {
        return [{ name: path.basename(rootPath).toUpperCase(), path: rootPath, relativePath: '' }];
    }
    return directories.map((entry) => ({
        name: entry.name.toUpperCase(),
        path: path.join(libraryRoot, entry.name),
        relativePath: wrapper ? `${wrapper.name}/${entry.name}` : entry.name
    }));
}

/** Match only known members, retaining disk casing and never resolving arbitrary paths. */
export function selectLocalSource(files: SourceFile[], library: LocalSourceLibrary, requestedPath: string) {
    const relativePath = requestedPath.split(path.sep).join('/');
    const prefixes = [library.relativePath, library.name].filter(Boolean);
    const candidates = [relativePath, ...prefixes.flatMap((prefix) => (
        relativePath.slice(0, prefix.length + 1).toUpperCase() === `${prefix}/`.toUpperCase()
            ? [relativePath.slice(prefix.length + 1)] : []
    ))];
    for (const candidate of candidates) {
        const exact = files.find((file) => file.library === library.name && file.relativePath === candidate);
        if (exact) return exact;
        const matches = files.filter((file) => file.library === library.name && file.relativePath.toUpperCase() === candidate.toUpperCase());
        if (matches.length === 1) return matches[0];
    }
    return undefined;
}

export interface SourceFile {
    library: string;
    name: string;
    relativePath: string;
    kind: AnalysisFileKind;
    language?: string;
    content: string;
}

export async function walkDirectory(
    directoryPath: string,
    relativePath: string,
    library?: string
): Promise<AnalysisFileNode[]> {
    const entries = await sourceEntries(directoryPath);
    const sortedEntries = entries.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
            return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
    });
    const nodes: AnalysisFileNode[] = [];

    for (const entry of sortedEntries) {
        if (isExcludedLocalEntry(entry.name)) {
            continue;
        }

        const childRelativePath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
        const childPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            nodes.push({
                id: `directory:${childRelativePath}`,
                name: entry.name,
                relativePath: childRelativePath,
                kind: 'directory',
                library,
                children: await walkDirectory(childPath, childRelativePath, library)
            });
            continue;
        }

        if (!entry.isFile()) continue;
        const fileKind = classifyAnalysisFile(entry.name);
        nodes.push({
            id: `file:${childRelativePath}`,
            name: entry.name,
            relativePath: childRelativePath,
            kind: fileKind.kind,
            library,
            language: fileKind.language,
            analyzable: fileKind.analyzable
        });
    }

    return nodes;
}

export async function collectSourceFiles(directoryPath: string, library: string, relativePath = ''): Promise<SourceFile[]> {
    const entries = await sourceEntries(directoryPath);
    const files: SourceFile[] = [];

    for (const entry of entries) {
        if (isExcludedLocalEntry(entry.name)) {
            continue;
        }

        const childPath = path.join(directoryPath, entry.name);
        const childRelativePath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;
        if (entry.isDirectory()) {
            files.push(...await collectSourceFiles(childPath, library, childRelativePath));
            continue;
        }

        if (!entry.isFile()) continue;
        const fileKind = classifyAnalysisFile(entry.name);
        if (!fileKind.analyzable || fileKind.kind === 'metadata') {
            continue;
        }

        files.push({
            library,
            name: entry.name,
            relativePath: childRelativePath,
            kind: fileKind.kind,
            language: fileKind.language,
            content: await readFile(childPath, 'utf8')
        });
    }

    return files;
}
