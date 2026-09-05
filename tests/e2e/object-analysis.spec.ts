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
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-object-analysis-e2e-'));
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

test('opens demo object analysis and traces an RPGLE source', async () => {
    const app = await launchTestApp();

    try {
        await expect(app.page.locator('#open-object-analysis')).toHaveCount(0);
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await expect(app.page.locator('#open-object-analysis')).toBeVisible();
        await app.page.locator('#open-object-analysis').click();
        await expect(app.page.getByRole('heading', { name: 'Object analysis', exact: true })).toBeVisible();
        await expect(app.page.locator('[data-analysis-source="local"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.page.locator('#analysis-library-input')).toHaveValue('ORDERLIB, COMMONLIB, INVENTORY');
        await expect(app.page.locator('#analysis-scope-badge')).toHaveText('3 libraries active');
        await expect(app.page.locator('#analysis-library-source-status')).toContainText('setup.json');
        await expect(app.page.locator('#analysis-library-source-status')).toContainText('session only');
        await expect(app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' })).toBeVisible();
        await expect(app.page.locator('#analyze-business-logic')).toHaveText(/Explain with IBMEye AI/);

        await app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' }).click();
        await expect(app.page.locator('#analysis-selection-scope')).toContainText('ORDERLIB, COMMONLIB, INVENTORY');
        await expect(app.page.locator('#run-object-analysis')).toBeEnabled();
        await app.page.locator('#analysis-library-input').fill('ORDERLIB');
        await expect(app.page.locator('#analysis-scope-badge')).toHaveText('Changes not applied');
        await expect(app.page.locator('#run-object-analysis')).toBeDisabled();
        await app.page.locator('#analysis-library-input').fill('ORDERLIB, COMMONLIB, INVENTORY');
        await expect(app.page.locator('#run-object-analysis')).toBeEnabled();
        await app.page.locator('#run-object-analysis').click();
        await expect(app.page.locator('#analysis-result-title')).toHaveText('ORDERLIB/ORDENTR');
        await expect(app.page.locator('#analysis-result-scope')).toContainText('ORDERLIB, COMMONLIB, INVENTORY');
        await expect(app.page.locator('#analysis-readiness')).toContainText('Review');
        await expect(app.page.locator('#analysis-dependency-body')).toContainText('ORDERLIB/ORDERQ');
        await expect(app.page.locator('#analysis-dependency-body')).toContainText('ORDERLIB/ORDER_MODE');
        await expect(app.page.locator('#analysis-dependency-body')).toContainText('COMMONLIB/PRICING_CALC');
        await expect(app.page.locator('#analysis-dependency-body')).toContainText('Service programs');
        await expect(app.page.locator('#analysis-dependency-body')).toContainText('Files');
        await expect(app.page.locator('#analysis-dependency-tree')).toContainText('ORDERLIB/ORDENTR');
        await expect(app.page.locator('#analysis-business-summary')).toContainText('detected business or runtime');
        await expect(app.page.locator('#analysis-business-findings')).toContainText('Validate program state');
        await expect(app.page.locator('#analysis-program-flow')).toContainText('Write ORDERLIB/ORDHDR');
        await expect(app.page.locator('#analysis-conversion-plan')).toContainText('Create equivalence tests');
        await expect(app.page.locator('#analysis-report-storage')).toContainText('Draft analysis');
        await expect(app.page.locator('#download-analysis-report')).toBeDisabled();
        await expect(app.page.locator('#approve-object-analysis')).toBeEnabled();
        await app.page.locator('#approve-object-analysis').click();
        await expect(app.page.locator('#analysis-report-storage')).toContainText('ORDERLIB/QRPGLESRC/ORDENTR');
        await expect(app.page.locator('#approve-object-analysis')).toContainText('Approved & mapped');
        await expect(app.page.locator('#download-analysis-report')).toBeEnabled();
        await expect(app.page.locator('.analysis-section').nth(0)).toHaveAttribute('open', '');
        await expect(app.page.locator('#analysis-business-section')).toHaveAttribute('open', '');
        await expect(app.page.locator('#analysis-flow-section')).toHaveAttribute('open', '');
        await expect(app.page.locator('#analysis-conversion-section')).toHaveAttribute('open', '');
    } finally {
        await app.cleanup();
    }
});

test('runs analysis directly from a source row action', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        const sourceRow = app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' });
        await sourceRow.locator('[data-analysis-action="true"]').click();
        await expect(app.page.locator('#analysis-result-title')).toHaveText('ORDERLIB/ORDENTR');
    } finally {
        await app.cleanup();
    }
});

test('loads source and builds the mapped modernization analysis', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        const sourceRow = app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' });
        await sourceRow.click();
        await expect(app.page.locator('#load-object-source')).toBeEnabled();
        await app.page.locator('#load-object-source').click();
        await expect(app.page.locator('#analysis-source-preview')).toBeVisible();
        await expect(app.page.locator('#analysis-source-preview-code')).toContainText('dcl-f CUSTOMER');
        await expect(app.page.locator('#build-object-ir')).toHaveCount(0);
        await app.page.locator('#run-object-analysis').click();
        await expect(app.page.locator('#analysis-result-title')).toHaveText('ORDERLIB/ORDENTR');
        await expect(app.page.locator('#analysis-business-section')).toBeVisible();
        await expect(app.page.locator('#analysis-flow-section')).toBeVisible();
        await expect(app.page.locator('#analysis-conversion-section')).toBeVisible();
        await expect(app.page.locator('#analysis-report-storage')).toContainText('Draft analysis');
        await app.page.locator('#approve-object-analysis').click();
        await expect(app.page.locator('#analysis-report-storage')).toContainText('imonitor-analysis/reports/ORDERLIB/ORDENTR.analysis.json');
    } finally {
        await app.cleanup();
    }
});

test('resizes the source browser with keyboard controls', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        const resizer = app.page.locator('#analysis-sidebar-resizer');
        const initialWidth = Number(await resizer.getAttribute('aria-valuenow'));
        await resizer.focus();
        await resizer.press('ArrowRight');
        await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(initialWidth);
    } finally {
        await app.cleanup();
    }
});

test('limits the local tree to the submitted comma-separated library list', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        await expect(app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'PRICING.rpgle' })).toBeVisible();

        await app.page.locator('#analysis-library-input').fill('ORDERLIB');
        await app.page.locator('#analysis-load-libraries').click();
        await expect(app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' })).toBeVisible();
        await expect(app.page.locator('[data-analysis-file="true"]').filter({ hasText: 'PRICING.rpgle' })).toHaveCount(0);
        await expect(app.page.locator('#analysis-status')).toContainText('Select an RPG');
    } finally {
        await app.cleanup();
    }
});

test('allows operators to edit and reorder the object search library list', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        await expect(app.page.locator('#analysis-library-order .analysis-library-order-item strong')).toHaveText([
            'ORDERLIB', 'COMMONLIB', 'INVENTORY'
        ]);

        await app.page.locator('[data-library-move="up"][data-library-index="1"]').click();
        await expect(app.page.locator('#analysis-scope-badge')).toHaveText('Changes not applied');
        await expect(app.page.locator('#analysis-library-order .analysis-library-order-item strong')).toHaveText([
            'COMMONLIB', 'ORDERLIB', 'INVENTORY'
        ]);

        await app.page.locator('#analysis-load-libraries').click();
        await expect(app.page.locator('#analysis-library-input')).toHaveValue('COMMONLIB, ORDERLIB, INVENTORY');
        await expect(app.page.locator('#analysis-scope-badge')).toHaveText('3 libraries active');
    } finally {
        await app.cleanup();
    }
});

test('explains that IBM i source needs a live connection in demo mode', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await app.page.locator('#open-object-analysis').click();
        await app.page.locator('[data-analysis-source="ibmi"]').click();
        await expect(app.page.locator('#analysis-status')).toContainText('live IBM i system');
        await expect(app.page.locator('#analysis-ibmi-source')).toBeVisible();
    } finally {
        await app.cleanup();
    }
});

test('places WRKJOBQ immediately after the IBMEye incident queue', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#connect').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        const order = await app.page.locator('.monitor-frame').evaluate((frame) => Array.from(frame.children).map((child) => ({
            name: child.id || child.className,
            cssOrder: getComputedStyle(child).order
        })));
        const incidentIndex = order.findIndex((item) => item.name.includes('alerts-panel'));
        const queueIndex = order.findIndex((item) => item.name.includes('job-queues-panel'));
        const aiIndex = order.findIndex((item) => item.name.includes('ai-assistant-panel'));
        expect(queueIndex).toBe(incidentIndex + 1);
        expect(aiIndex).toBe(queueIndex + 1);
        expect(order[queueIndex].cssOrder).toBe('3');
        expect(order[aiIndex].cssOrder).toBe('4');
    } finally {
        await app.cleanup();
    }
});
