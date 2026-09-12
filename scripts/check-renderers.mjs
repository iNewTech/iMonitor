import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { SourceTextModule } from 'node:vm';

// Parse browser modules without executing them or contacting external services.
const root = fileURLToPath(new URL('../public/', import.meta.url));
let checked = 0;
let failed = 0;
async function checkDirectory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await checkDirectory(file);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            try {
                const module = new SourceTextModule(await readFile(file, 'utf8'), { identifier: file });
                for (const specifier of module.dependencySpecifiers) {
                    if (specifier.startsWith('.')) await access(fileURLToPath(new URL(specifier, pathToFileURL(file))));
                }
                checked += 1;
            } catch (error) {
                console.error(`${path.relative(root, file)}: ${error.message}`);
                failed += 1;
            }
        }
    }
}
await checkDirectory(root);
console.log(`Renderer check: ${checked} modules passed${failed ? `, ${failed} failed` : ''}.`);
process.exitCode = failed ? 1 : 0;
