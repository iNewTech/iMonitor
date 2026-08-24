import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const releaseDirectory = path.join(projectRoot, 'release');
const installDirectory = path.join(projectRoot, 'install');
const installerExtensions = new Set(['.dmg', '.exe']);

async function ensureDirectory(directoryPath) {
    await fs.mkdir(directoryPath, { recursive: true });
}

async function clearCollectedInstallers(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
        if (!entry.isFile()) {
            return;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!installerExtensions.has(extension)) {
            return;
        }

        await fs.unlink(path.join(directoryPath, entry.name));
    }));
}

async function collectInstallers() {
    await ensureDirectory(installDirectory);
    await clearCollectedInstallers(installDirectory);

    const releaseEntries = await fs.readdir(releaseDirectory, { withFileTypes: true });
    const installerFiles = releaseEntries
        .filter((entry) => entry.isFile() && installerExtensions.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    if (!installerFiles.length) {
        console.log('No installer files found in release/.');
        return;
    }

    await Promise.all(installerFiles.map(async (fileName) => {
        const sourcePath = path.join(releaseDirectory, fileName);
        const targetPath = path.join(installDirectory, fileName);
        await fs.copyFile(sourcePath, targetPath);
    }));

    console.log(`Collected ${installerFiles.length} installer file(s) into install/:`);
    installerFiles.forEach((fileName) => {
        console.log(`- install/${fileName}`);
    });
}

collectInstallers().catch((error) => {
    console.error('Unable to collect installer files.', error);
    process.exitCode = 1;
});
