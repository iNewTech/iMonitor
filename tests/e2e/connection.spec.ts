import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

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
