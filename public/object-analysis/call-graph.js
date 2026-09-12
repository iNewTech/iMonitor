import { escapeHtml } from '../connection/shared.js';

const kinds = { '*PGM': 'program', '*SRVPGM': 'service', '*MODULE': 'module' };

/** Keep caller/callee identity from the evidence. Source order never implies a call chain. */
export function buildCallGraphModel(result) {
    const objects = new Map(result.nodes.map((node) => [node.id, node]));
    objects.set(result.root.id, result.root);
    const links = [];
    const seen = new Set();
    for (const edge of result.edges) {
        const from = objects.get(edge.from);
        const to = objects.get(edge.to);
        if (!['calls', 'binds'].includes(edge.relationship) || !from || !to) continue;
        if (!kinds[from.type] || !(kinds[to.type] || (to.type === '*UNKNOWN' && edge.relationship === 'calls'))) continue;
        const key = `${edge.from}|${edge.to}|${edge.relationship}|${edge.line || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ ...edge, label: edge.relationship });
    }

    const depths = new Map([[result.root.id, 0]]);
    const queue = [result.root.id];
    for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index];
        for (const edge of links.filter((link) => link.from === id)) {
            if (depths.has(edge.to)) continue;
            depths.set(edge.to, depths.get(id) + 1);
            queue.push(edge.to);
        }
    }
    const reachableLinks = links.filter((edge) => depths.has(edge.from) && depths.has(edge.to));
    return {
        nodes: Array.from(depths, ([id, depth]) => {
            const node = objects.get(id);
            return { id, depth, label: `${node.library}/${node.name}`, meta: node.type,
                kind: node.status === 'unresolved' ? 'unresolved' : kinds[node.type] || 'unresolved' };
        }),
        links: reachableLinks
    };
}

export function renderCallGraph(container, counter, result) {
    if (!container) return;
    const graph = buildCallGraphModel(result);
    if (counter) counter.textContent = `${graph.links.length} call / binding references`;
    if (!graph.links.length) {
        container.innerHTML = '<p class="analysis-table-empty">No program, service-program, or module call references were found in this scan. Procedure declarations alone do not establish a call path.</p>';
        return;
    }

    const columns = new Map();
    graph.nodes.forEach((node) => {
        const column = columns.get(node.depth) || [];
        column.push(node);
        columns.set(node.depth, column);
    });
    const rowHeight = 104;
    const nodeWidth = 224;
    const nodeHeight = 66;
    const columnWidth = 304;
    const height = Math.max(...Array.from(columns.values(), (nodes) => nodes.length)) * rowHeight + 48;
    const width = columns.size * columnWidth;
    const positions = new Map();
    columns.forEach((nodes, depth) => nodes.forEach((node, row) => {
        positions.set(node.id, { x: 20 + depth * columnWidth,
            y: 28 + (height - 48 - nodes.length * rowHeight) / 2 + row * rowHeight });
    }));
    const paths = graph.links.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        const x1 = from.x + nodeWidth;
        const y1 = from.y + nodeHeight / 2;
        const y2 = to.y + nodeHeight / 2;
        const bend = Math.max(32, (to.x - x1) / 2);
        const path = to.x > from.x
            ? `M${x1},${y1} C${x1 + bend},${y1} ${to.x - bend},${y2} ${to.x - 5},${y2}`
            : `M${x1},${y1} C${x1 + 28},${y1} ${x1 + 28},${from.y - 16} ${x1},${from.y - 16} L${to.x + nodeWidth / 2},${from.y - 16} L${to.x + nodeWidth / 2},${to.y - 5}`;
        return `<path class="analysis-call-edge" d="${path}" marker-end="url(#analysis-call-arrow)"><title>${escapeHtml(`${objectsLabel(edge.from)} → ${objectsLabel(edge.to)} · ${edge.relationship} · ${edge.evidence} · ${edge.confidence}`)}</title></path>`;
    }).join('');

    function objectsLabel(id) {
        return graph.nodes.find((node) => node.id === id)?.label || id;
    }

    const cards = graph.nodes.map((node) => {
        const { x, y } = positions.get(node.id);
        return `<g class="analysis-call-card" data-kind="${node.kind}" transform="translate(${x},${y})">
            <title>${escapeHtml(`${node.label} ${node.meta}`)}</title>
            <rect width="${nodeWidth}" height="${nodeHeight}" rx="10"/>
            <text class="analysis-call-card-kind" x="14" y="23">${escapeHtml(node.meta)}</text>
            <text class="analysis-call-card-title" x="14" y="46">${escapeHtml(node.label.length > 26 ? node.label.slice(0, 25) + '…' : node.label)}</text>
        </g>`;
    }).join('');
    const links = graph.links.map((edge) => `<li><strong>${escapeHtml(objectsLabel(edge.from))}</strong>
        <span>${escapeHtml(edge.label)} →</span><strong>${escapeHtml(objectsLabel(edge.to))}</strong>
        <small>${escapeHtml(edge.evidence)} · ${escapeHtml(edge.confidence)}${edge.line ? ` · line ${edge.line}` : ''}</small></li>`).join('');

    container.innerHTML = `<p class="analysis-graph-note">Static call and binding references from the analysis. Arrows show the recorded caller and target; they do not prove runtime execution. Procedure-level links appear only when supported by evidence.</p>
        <div class="analysis-call-canvas" tabindex="0" role="region" aria-label="Scrollable call graph">
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Call references for ${escapeHtml(result.root.name)}">
                <defs><marker id="analysis-call-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--muted)"/></marker></defs>
                ${paths}${cards}
            </svg>
        </div>
        <details class="analysis-call-graph-links"><summary>Exact references and evidence</summary><ul>${links}</ul></details>`;
}
