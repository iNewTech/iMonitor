import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    KNOWLEDGE_GOLDEN_CASES,
    runKnowledgeRegressionSuite,
    serializeKnowledgeRegressionReport
} = require('../dist/features/knowledge/knowledge-regression.js');

const backend = process.env.IMONITOR_KNOWLEDGE_BACKEND || 'local';
const provider = process.env.IMONITOR_KNOWLEDGE_PROVIDER || 'deterministic-fixture';
const output = process.env.IMONITOR_KNOWLEDGE_REGRESSION_OUTPUT
    || path.join(process.cwd(), 'test-results', 'knowledge-regression', `${backend}-${provider}.json`);
const report = await runKnowledgeRegressionSuite(KNOWLEDGE_GOLDEN_CASES, { backend, provider });

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serializeKnowledgeRegressionReport(report), 'utf8');
console.log(`Knowledge regression: ${report.totals.passed}/${report.totals.cases} cases passed. Artifact: ${output}`);
if (!report.passed) process.exitCode = 1;
