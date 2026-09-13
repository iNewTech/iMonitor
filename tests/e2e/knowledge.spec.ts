import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

test('adds, searches, reviews, reindexes, and removes a knowledge source', async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-knowledge-e2e-'));
    const app = await electron.launch({ args: [process.cwd()], env: { ...process.env,
        IBM_EYE_STORE_DIR: path.join(sandbox, 'store'), IBM_EYE_USER_DATA_DIR: path.join(sandbox, 'user')
    } });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await page.locator('#connect').click();
        await page.locator('[data-app-destination="knowledge"]').click();
        await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
        await expect(page.locator('#knowledge-empty')).toBeVisible();

        await page.locator('#knowledge-add').click();
        await page.locator('#knowledge-source-name').fill('Night batch recovery');
        await page.locator('#knowledge-source-type').selectOption('runbook');
        await page.locator('#knowledge-content').fill('Job: QBATCH/NIGHT\nStep: inspect MSGW\npassword=should-not-be-stored\nVerify the job before release.');
        await page.locator('#knowledge-add-submit').click();
        await expect(page.locator('#knowledge-list .knowledge-row')).toHaveCount(1);
        await expect(page.locator('#knowledge-list')).toContainText('Night batch recovery');
        await expect(page.locator('#knowledge-record-count')).toContainText('2');

        await page.locator('#knowledge-search').fill('should-not-be-stored');
        await expect(page.locator('#knowledge-empty')).toBeVisible();
        await page.locator('#knowledge-search').fill('MSGW');
        await expect(page.locator('#knowledge-list .knowledge-row')).toHaveCount(1);
        await page.locator('#knowledge-list .knowledge-row').click();
        await expect(page.locator('#knowledge-detail-dialog')).toBeVisible();
        await expect(page.locator('#knowledge-detail-text')).not.toContainText('should-not-be-stored');
        await page.locator('#knowledge-detail-reindex').click();
        await expect(page.locator('#knowledge-detail-dialog')).toBeVisible();
        await page.locator('#knowledge-detail-delete').click();
        await expect(page.locator('#knowledge-empty')).toBeVisible();

        await page.locator('#knowledge-add').click();
        await page.locator('#knowledge-file').setInputFiles({ name: 'manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not supported') });
        await expect(page.locator('#knowledge-add-status')).toContainText('not supported');
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        await fs.rm(sandbox, { recursive: true, force: true });
    }
});
