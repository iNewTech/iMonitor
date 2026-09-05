import { describe, expect, it } from 'vitest';
import { classifyAnalysisFile, classifyDependencyCategory, normalizeObjectAnalysisSettings, parseObjectAnalysisLibraryList } from './model';

describe('object analysis scope settings', () => {
    it('parses a simple comma-separated library list', () => {
        expect(parseObjectAnalysisLibraryList(' orderlib, COMMONLIB, orderlib ')).toEqual([
            'ORDERLIB', 'COMMONLIB'
        ]);
    });

    it('keeps the source and local directory in the normalized settings', () => {
        expect(normalizeObjectAnalysisSettings({
            source: 'ibmi',
            localDirectory: '/tmp/source-tree',
            libraries: ['app01']
        })).toEqual(expect.objectContaining({
            source: 'ibmi',
            localDirectory: '/tmp/source-tree',
            libraries: ['APP01']
        }));
    });

    it('keeps the ordered object scope separate from the source library', () => {
        expect(normalizeObjectAnalysisSettings({
            source: 'ibmi',
            libraryList: ['commonlib', 'app01'],
            sourceLibrary: 'app01'
        })).toEqual(expect.objectContaining({
            libraryList: ['COMMONLIB', 'APP01'],
            libraries: ['COMMONLIB', 'APP01'],
            sourceLibrary: 'APP01'
        }));
    });

    it('groups dependencies into operator-friendly categories', () => {
        expect(classifyDependencyCategory('*PGM')).toBe('Programs');
        expect(classifyDependencyCategory('*SRVPGM')).toBe('Service programs');
        expect(classifyDependencyCategory('*FILE')).toBe('Files');
        expect(classifyDependencyCategory('*DTAQ')).toBe('Data queues');
        expect(classifyDependencyCategory('*ENVVAR')).toBe('Environment variables');
    });

    it('recognizes IBM i source types from common member extensions', () => {
        expect(classifyAnalysisFile('MYPGM.rpgle')).toEqual(expect.objectContaining({ kind: 'source', language: 'RPGLE', analyzable: true }));
        expect(classifyAnalysisFile('MYFILE.dds')).toEqual(expect.objectContaining({ kind: 'database', language: 'DDS', analyzable: true }));
        expect(classifyAnalysisFile('MYDISPLAY.dspf')).toEqual(expect.objectContaining({ kind: 'database', language: 'DSPF', analyzable: true }));
        expect(classifyAnalysisFile('MYDATA.sql')).toEqual(expect.objectContaining({ kind: 'database', language: 'SQL', analyzable: true }));
    });
});
