import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

async function launchTestApp(): Promise<{
    electronApp: ElectronApplication;
    page: Page;
    cleanup: () => Promise<void>;
}> {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ibmeye-jobs-filter-e2e-'));
    const homeDirectory = path.join(sandboxRoot, 'home');
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(homeDirectory, { recursive: true }),
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: homeDirectory,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory
        }
    });

    return {
        electronApp,
        page: await electronApp.firstWindow(),
        cleanup: async () => {
            await electronApp.close();
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        }
    };
}

async function openDemoMonitor(page: Page) {
    await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
    await page.locator('#connect').click();
    await expect(page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
    const jobsSummary = page.locator('.table-shell > summary');
    await expect(jobsSummary).toBeVisible();
    await jobsSummary.click({ force: true });
}

test('filters and searches the active jobs table in demo mode', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        await expect(app.page.getByTestId('jobs-visible-count')).toContainText('Showing');
        await app.page.getByTestId('jobs-subsystem-filter').selectOption('QBATCH');
        await expect(app.page.locator('#system-stats tbody tr')).toHaveCount(3);
        await expect(app.page.locator('#system-stats tbody tr').first()).toContainText('QBATCH/');
        await expect(app.page.locator('#system-stats tbody tr').nth(1)).toContainText('QBATCH/');
        await expect(app.page.locator('#system-stats tbody tr').nth(2)).toContainText('QBATCH/');
        await expect(app.page.getByTestId('jobs-visible-count')).toContainText('Showing 3 of');

        await app.page.getByTestId('jobs-filter-waiting').click();
        await expect(app.page.locator('#system-stats tbody tr')).toHaveCount(1);
        await expect(app.page.locator('#system-stats tbody tr')).toContainText('LCKW');
        await expect(app.page.getByTestId('jobs-visible-count')).toContainText('Showing 1 of');

        await app.page.getByTestId('jobs-subsystem-filter').selectOption('ALL');
        await app.page.getByTestId('jobs-filter-running').click();
        const runningRows = app.page.locator('#system-stats tbody tr.job-row');
        await expect(runningRows).not.toHaveCount(0);
        const runningStatuses = await runningRows.locator('.badge').allTextContents();
        expect(runningStatuses.every((status) => status.trim() === 'RUN')).toBe(true);

        await app.page.getByTestId('jobs-search-input').fill('interct');
        await expect(app.page.locator('#system-stats tbody tr')).toHaveCount(1);
        await expect(app.page.locator('#system-stats tbody tr')).toContainText('QINTER/INTERACT');

        await app.page.getByTestId('jobs-filter-all').click();
        await expect(app.page.locator('#system-stats tbody tr')).toHaveCount(1);
        await expect(app.page.locator('#system-stats tbody tr')).toContainText('QINTER/INTERACT');

        await app.page.getByTestId('jobs-search-input').fill('zzznomatch');
        await expect(app.page.locator('#system-stats tbody tr')).toContainText('No jobs match');
    } finally {
        await app.cleanup();
    }
});

test('shows all compact activity history views with live metrics', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        const overview = app.page.locator('.activity-overview');
        await expect(overview).toBeVisible();
        await expect(app.page.locator('#total-jobs')).toBeVisible();
        await expect(app.page.locator('#peak-cpu')).toBeVisible();
        await expect(app.page.locator('#running-jobs')).toBeVisible();
        await expect(app.page.locator('#waiting-jobs')).toBeVisible();

        await expect(app.page.locator('[data-history-view="jobs"]')).toBeVisible();
        await expect(app.page.locator('[data-history-view="cpu"]')).toBeVisible();
        await expect(app.page.locator('[data-history-view="waits"]')).toBeVisible();
        await expect(app.page.locator('#total-jobs')).toBeVisible();
    } finally {
        await app.cleanup();
    }
});

test('keeps the inner work surfaces compact and free of duplicate history controls', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        await expect(app.page.getByTestId('activity-overview')).toBeVisible();
        await expect(app.page.locator('#jobs-history-chart')).toHaveCount(1);
        await expect(app.page.locator('#cpu-history-chart')).toHaveCount(1);
        await expect(app.page.locator('#wait-history-chart')).toHaveCount(1);

        const jobsTableHeader = app.page.locator('#system-stats thead th').first();
        await expect(jobsTableHeader).toHaveCSS('position', 'sticky');

        await app.page.locator('.alerts-panel > summary').click();
        await expect(app.page.locator('.alert-queue-context')).toContainText('New incidents stay here');
        await expect(app.page.locator('.alert-search-control')).toBeVisible();
        await expect(app.page.getByText('QSYSOPR messages', { exact: true })).toHaveCount(0);
    } finally {
        await app.cleanup();
    }
});
