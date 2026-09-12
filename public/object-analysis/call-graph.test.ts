import { describe, expect, it } from 'vitest';
// Renderer modules run as browser ES modules.
// @ts-ignore No generated declarations for renderer JavaScript.
import { buildCallGraphModel } from './call-graph.js';

const node = (id: string, type = '*PGM') => ({ id, name: id, library: 'TESTLIB', type, status: 'known' });
const edge = (from: string, to: string, relationship = 'calls') => ({ from, to, relationship, evidence: 'source', confidence: 'likely' });

describe('call graph evidence', () => {
    it('keeps sibling calls as siblings and excludes files, queues, and declarations', () => {
        const root = node('MAIN');
        const graph = buildCallGraphModel({ root, nodes: [root, node('B'), node('C'), node('DATA', '*FILE'), node('QUEUE', '*JOBQ')],
            edges: [edge('MAIN', 'B'), edge('MAIN', 'C'), edge('MAIN', 'DATA', 'reads'), edge('MAIN', 'QUEUE', 'submits')],
            programFlow: [{ kind: 'procedure', title: 'Unused procedure' }, { kind: 'program-call', target: 'B' }, { kind: 'program-call', target: 'C' }] });
        expect(graph.links.map((link: any) => `${link.from}->${link.to}`)).toEqual(['MAIN->B', 'MAIN->C']);
        expect(graph.nodes.map((item: any) => [item.id, item.depth])).toEqual([['MAIN', 0], ['B', 1], ['C', 1]]);
    });

    it('handles deeper binding paths and cycles without inventing a second entry', () => {
        const root = node('MAIN');
        const graph = buildCallGraphModel({ root, nodes: [root, node('B'), node('SERVICE', '*SRVPGM'), node('MODULE', '*MODULE'), node('OTHER')],
            edges: [edge('MAIN', 'B'), edge('B', 'SERVICE', 'binds'), edge('SERVICE', 'MODULE', 'binds'), edge('MODULE', 'MAIN'), edge('OTHER', 'B')] });
        expect(graph.nodes.find((item: any) => item.id === 'MODULE').depth).toBe(3);
        expect(graph.nodes.some((item: any) => item.id === 'OTHER')).toBe(false);
        expect(graph.links).toHaveLength(4);
    });
});
