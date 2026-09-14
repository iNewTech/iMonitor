import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

async function launchStorageTestApp() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-storage-paths-e2e-'));
    const userData = path.join(root, 'override');
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd()), `--user-data-dir=${path.join(root, 'fallback')}`],
        env: { ...process.env, IBM_EYE_STORE_DIR: '', IBM_EYE_USER_DATA_DIR: userData }
    });
    return { root, userData, electronApp };
}

async function quitTestApp(electronApp: ElectronApplication) {
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        electronApp.process().once('exit', (code, signal) => resolve({ code, signal }));
    });
    const closed = electronApp.waitForEvent('close', { timeout: 8_000 });
    await electronApp.evaluate(({ app }) => {
        // A repeated explicit quit must not bypass the pending flush or start another one.
        setImmediate(() => { app.quit(); app.quit(); });
    });
    const [exit] = await Promise.all([exited, closed]);
    expect(exit).toEqual({ code: 0, signal: null });
}

test('keeps knowledge and telemetry under the isolated user-data override', async () => {
    // The helper supplies a path that does not exist; main must create it before setPath.
    const { root, userData, electronApp } = await launchStorageTestApp();

    try {
        expect(await electronApp.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
        const page = await electronApp.firstWindow();
        await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
        await page.locator('#connect').click();
        await expect(page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();

        const added = await page.evaluate(() => window.electronAPI.addKnowledgeSource({
            sourceName: 'Isolated storage check', sourceType: 'runbook', fileName: 'storage-check.md',
            content: 'Verify the isolated storage fixture before releasing the job.'
        }));
        expect(added.success).toBe(true);
        // Health waits behind the ingestion audit, so these checks do not rely on shutdown flushing.
        const health = await page.evaluate(() => window.electronAPI.getAiabObservability());
        expect(health.success).toBe(true);
        expect(health.snapshot?.state).not.toBe('degraded');
        expect(health.knowledge?.local).toMatchObject({ recordCount: 1 });

        const knowledge = JSON.parse(await fs.readFile(path.join(userData, 'imonitor-knowledge', 'knowledge-store.json'), 'utf8'));
        expect(knowledge.records).toEqual([expect.objectContaining({ content: expect.stringContaining('isolated storage fixture') })]);
        const telemetry = JSON.parse(await fs.readFile(path.join(userData, 'imonitor-observability', 'observability.json'), 'utf8'));
        expect(telemetry.state.events).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'ingestion:knowledge-source', outcome: 'success' })
        ]));
        // With no separate store override, this also verifies store creation uses the early path.
        expect(JSON.parse(await fs.readFile(path.join(userData, 'connections-dev.json'), 'utf8')).connections).not.toHaveLength(0);

        const files = await fs.readdir(root, { recursive: true });
        for (const relativePath of ['imonitor-knowledge/knowledge-store.json', 'imonitor-observability/observability.json', 'connections-dev.json']) {
            expect(files.filter((file) => path.basename(file) === path.basename(relativePath))).toEqual([
                path.relative(root, path.join(userData, relativePath))
            ]);
        }
    } finally {
        await electronApp.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

for (const scenario of [
    { mode: 'defer-until-quit', title: 'drains queued scoped telemetry before exiting on explicit quit' },
    { mode: 'fail', title: 'exits normally when queued telemetry writes fail' },
    { mode: 'stall', title: 'bounds explicit quit when telemetry storage never completes' }
] as const) {
    test(scenario.title, async () => {
        const { root, userData, electronApp } = await launchStorageTestApp();
        let exited = false;
        let stderr = '';
        electronApp.process().stderr?.on('data', (data) => { stderr += data.toString(); });
        try {
            const page = await electronApp.firstWindow();
            await page.locator('#connect').click();
            await expect(page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
            expect((await page.evaluate(() => window.electronAPI.getAiabObservability())).success).toBe(true);

            await electronApp.evaluate(({ app }, mode) => {
                const fileSystem = process.getBuiltinModule('fs').promises;
                const originalWrite = fileSystem.writeFile;
                const state = { writes: 0 };
                (globalThis as any).__shutdownStorageTest = state;
                let release: () => void = () => {};
                const quitStarted = new Promise<void>((resolve) => { release = resolve; });
                app.once('before-quit', () => setTimeout(release, 75));
                fileSystem.writeFile = async (...args: Parameters<typeof originalWrite>) => {
                    if (String(args[0]).replace(/\\/g, '/').includes('/imonitor-observability/')) {
                        state.writes++;
                        if (mode === 'fail') throw new Error('Simulated telemetry write failure');
                        if (mode === 'stall') await new Promise<void>(() => {});
                        // No audit can reach disk before quit; the real runtime queue must drain it.
                        await quitStarted;
                    }
                    return originalWrite(...args);
                };
            }, scenario.mode);

            const changes = await page.evaluate(async () => [
                await window.electronAPI.setMcpCapabilityEnabled({ id: 'ibmi-monitoring', enabled: false }),
                await window.electronAPI.setMcpCapabilityEnabled({ id: 'ibmi-monitoring', enabled: true })
            ]);
            expect(changes.every((change) => change.success)).toBe(true);
            await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__shutdownStorageTest.writes)).toBeGreaterThan(0);
            await quitTestApp(electronApp);
            exited = true;

            if (scenario.mode === 'defer-until-quit') {
                const telemetry = JSON.parse(await fs.readFile(path.join(userData, 'imonitor-observability', 'observability.json'), 'utf8'));
                for (const change of ['disabled', 'enabled']) {
                    expect(telemetry.state.events).toEqual(expect.arrayContaining([expect.objectContaining({
                        name: `mcp:Skill or MCP connection ${change}.`, outcome: 'success',
                        scope: { customerScope: 'local', systemScope: 'demo-connection', operatorId: 'GajenderT' }
                    })]));
                }
            } else if (scenario.mode === 'stall') {
                expect(stderr.match(/Timed out waiting for telemetry storage during shutdown/g)).toHaveLength(1);
            }
        } finally {
            if (!exited && electronApp.process().exitCode === null) await electronApp.close();
            await fs.rm(root, { recursive: true, force: true });
        }
    });
}

test('shows a focused connection workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-connection-e2e-'));
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: path.join(root, 'home'),
            IBM_EYE_STORE_DIR: path.join(root, 'store'),
            IBM_EYE_USER_DATA_DIR: path.join(root, 'user-data')
        }
    });

    try {
        const page = await electronApp.firstWindow();
        await expect(page.getByRole('heading', { name: 'Connect to IBM i', exact: true })).toBeVisible();
        await expect(page.locator('.brand-panel')).toHaveCount(0);
        await expect(page.locator('#connect')).toHaveText(/Connect & Monitor/);
        await expect(page.locator('#save-connection')).toHaveText(/Save Profile/);
        await expect(page.locator('#launch-demo')).toHaveCount(0);
        await expect(page.locator('#theme-menu > summary')).toHaveAttribute('title', 'Change theme');

        await page.locator('#plan-panel > summary').click();
        await expect(page.locator('.plan-panel-body')).toBeVisible();
        await expect(page.locator('.plan-panel-body')).toHaveCSS('position', 'absolute');
    } finally {
        await electronApp.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('collapses connection controls cleanly on a narrow window', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-connection-responsive-e2e-'));
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: path.join(root, 'home'),
            IBM_EYE_STORE_DIR: path.join(root, 'store'),
            IBM_EYE_USER_DATA_DIR: path.join(root, 'user-data')
        }
    });

    try {
        const page = await electronApp.firstWindow();
        await page.setViewportSize({ width: 560, height: 820 });
        await expect(page.getByRole('heading', { name: 'Connect to IBM i', exact: true })).toBeVisible();

        await page.locator('#edit-connection').click();
        const layout = await page.evaluate(() => {
            const formShell = document.querySelector('.connection-form-shell');
            const savedSelector = document.querySelector('.saved-profile-selector');
            const documentWidth = document.documentElement.scrollWidth;
            return {
                formColumns: getComputedStyle(formShell).gridTemplateColumns.trim().split(/\s+/).length,
                savedSelectorDisplay: getComputedStyle(savedSelector).display,
                documentWidth,
                viewportWidth: window.innerWidth,
                actionRight: document.querySelector('.primary-actions')?.getBoundingClientRect().right || 0
            };
        });

        expect(layout.formColumns).toBe(1);
        expect(layout.savedSelectorDisplay).toBe('grid');
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
        expect(layout.actionRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    } finally {
        await electronApp.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
