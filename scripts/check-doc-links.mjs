import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const markdownFiles = [
    path.join(root, 'README.md'),
    path.join(root, 'CHANGELOG.md'),
    ...fs.readdirSync(path.join(root, 'docs'), { recursive: true })
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => path.join(root, 'docs', entry))
];
const missing = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(linkPattern)) {
        const rawTarget = match[1].trim();
        const target = rawTarget.startsWith('<') ? rawTarget.slice(1, rawTarget.indexOf('>')) : rawTarget.split(/\s+/)[0];
        if (!target || target.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
        const fileTarget = decodeURIComponent(target.split('#', 1)[0]);
        if (!fileTarget) continue;
        const resolved = path.resolve(path.dirname(file), fileTarget);
        if (!fs.existsSync(resolved)) missing.push(`${path.relative(root, file)} → ${target}`);
    }
}

if (missing.length) {
    console.error(`Documentation link check failed (${missing.length} missing target${missing.length === 1 ? '' : 's'}):`);
    for (const entry of missing) console.error(`- ${entry}`);
    process.exitCode = 1;
} else {
    console.log(`Documentation link check passed (${markdownFiles.length} Markdown files).`);
}
