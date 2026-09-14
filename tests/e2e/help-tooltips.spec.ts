import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const test = base.extend<{ app: { desktop: ElectronApplication; page: Page } }>({
    app: async ({}, use) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-help-'));
        const store = path.join(root, 'store');
        const userData = path.join(root, 'user-data');
        await Promise.all([fs.mkdir(store), fs.mkdir(userData)]);
        const desktop = await electron.launch({
            args: [process.cwd()],
            env: { ...process.env, IBM_EYE_STORE_DIR: store, IBM_EYE_USER_DATA_DIR: userData }
        });
        try {
            const page = await desktop.firstWindow();
            await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
            await expect(page.locator('#imonitor-context-tooltip')).toHaveCount(1);
            await use({ desktop, page });
        } finally {
            await desktop.close();
            await fs.rm(root, { recursive: true, force: true });
        }
    }
});

const tooltip = (page: Page) => page.locator('#imonitor-context-tooltip');

async function connect(page: Page) {
    await page.locator('#connect').click();
    await expect(page.locator('.job-row.has-incident').first()).toBeVisible();
}

test('hover help is delayed, stays readable under the pointer, and takes no layout space', async ({ app }) => {
    const { page } = app;
    const button = page.locator('#connect');
    const before = await button.boundingBox();
    await button.hover();
    expect(await tooltip(page).isVisible()).toBe(false);
    await expect(tooltip(page)).toContainText('selected profile');
    await expect(tooltip(page)).toBeVisible();
    expect(await button.boundingBox()).toEqual(before);
    await tooltip(page).hover();
    await expect(tooltip(page)).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(tooltip(page)).toBeHidden();
    await expect(page.locator('.context-help-icon')).toHaveCount(0);
});

test('keyboard help preserves existing descriptions and titles and Escape dismisses it', async ({ app }) => {
    const { page } = app;
    const button = page.locator('#connect');
    await button.evaluate((node) => {
        node.setAttribute('aria-describedby', 'saved-connections-hint');
        node.setAttribute('title', 'Original connection hint');
    });
    await button.focus();
    await expect(tooltip(page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-describedby', 'saved-connections-hint imonitor-context-tooltip');
    await expect(button).not.toHaveAttribute('title');
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).toBeHidden();
    await expect(button).toHaveAttribute('aria-describedby', 'saved-connections-hint');
    await expect(button).toHaveAttribute('title', 'Original connection hint');
    await expect(button).toBeFocused();
    // It must not reopen on the same focused control until focus or hover changes.
    await page.keyboard.press('ArrowRight');
    await expect(tooltip(page)).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.locator('.job-row').first()).toBeVisible();
});

test('dynamic disabled actions explain the live reason without enabling the action', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => {
        const button = document.createElement('button');
        button.id = 'help-disabled-probe';
        button.className = 'btn';
        button.dataset.actionKind = 'endJob';
        button.disabled = true;
        button.textContent = 'End Job';
        button.title = 'Your access does not allow ending this job.';
        button.style.cssText = 'position:fixed;top:10px;left:10px;z-index:1000';
        button.addEventListener('click', () => button.dataset.executed = 'yes');
        document.body.append(button);
    });
    const button = page.locator('#help-disabled-probe');
    await button.hover();
    await expect(tooltip(page)).toHaveText('Your access does not allow ending this job.');
    await expect(tooltip(page)).toBeVisible();
    await button.evaluate((node) => node.title = 'Changed: <img src=x onerror=alert(1)> approval required.');
    await expect(tooltip(page)).toContainText('<img src=x');
    await expect(tooltip(page).locator('img')).toHaveCount(0);
    await page.mouse.down();
    await page.mouse.up();
    await expect(button).toBeDisabled();
    await expect(button).not.toHaveAttribute('data-executed');
    await page.mouse.move(500, 5);
    await expect(tooltip(page)).toBeHidden();
    await expect(button).toHaveAttribute('title', /Changed:/);
    await button.evaluate((node: HTMLButtonElement) => { node.disabled = false; });
    await button.hover();
    await expect(tooltip(page)).toContainText('interrupt business work');
    await button.click();
    await expect(button).toHaveAttribute('data-executed', 'yes');
    await expect(tooltip(page)).toBeHidden();
});

test('live state changes update help and replaced job cells never leave a stale overlay', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => {
        const state = document.createElement('span');
        state.id = 'help-state-probe';
        state.className = 'job-condition';
        state.dataset.state = 'MSGW';
        state.textContent = 'Message wait';
        state.style.cssText = 'position:fixed;top:10px;left:10px;z-index:1000';
        document.body.append(state);
    });
    const state = page.locator('#help-state-probe');
    await state.hover();
    await expect(tooltip(page)).toContainText('waiting for a message reply');
    await expect(state).toHaveClass('job-condition');
    await state.evaluate((node) => node.dataset.state = 'LCKW');
    await expect(tooltip(page)).toContainText('waiting for a lock');
    await state.evaluate((node) => node.remove());
    await expect(tooltip(page)).toBeHidden();
    await page.locator('#connect').hover();
    await expect(tooltip(page)).toContainText('selected profile');
    await expect(tooltip(page)).toBeVisible();
});

test('knowledge heading help is unobtrusive and modal help dismisses before the dialog', async ({ app }) => {
    const { page } = app;
    await connect(page);
    await page.locator('[data-app-destination="knowledge"]').click();
    const icon = page.getByRole('button', { name: 'About the knowledge library', exact: true });
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
    await icon.click();
    await expect(tooltip(page)).toContainText('freshness and approval');
    await expect(tooltip(page)).toBeVisible();
    await icon.click();
    await expect(tooltip(page)).toBeHidden();
    await page.locator('#knowledge-add').click();
    const save = page.locator('#knowledge-add-submit');
    await page.keyboard.press('Tab');
    await save.focus();
    await expect(tooltip(page)).toBeVisible();
    await expect(page.locator('#knowledge-add-dialog #imonitor-context-tooltip')).toHaveCount(1);
    expect(await tooltip(page).evaluate((node) => node.matches(':popover-open'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).toBeHidden();
    await expect(page.locator('#knowledge-add-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#knowledge-add-dialog')).toBeHidden();
});

test('settings help fits narrow windows in both light and dark themes', async ({ app }, testInfo) => {
    const { page } = app;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await connect(page);
    await page.locator('#open-settings').click();
    await page.getByTestId('settings-page-storage').click();
    const icon = page.getByRole('button', { name: 'About storage', exact: true });
    await expect(icon).toHaveCount(1);
    await app.desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 760));
    for (const theme of ['aurora-mist', 'night-console']) {
        await page.locator('body').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
        // Cancel Settings' smooth section navigation before checking a fixed overlay.
        await icon.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
        await page.mouse.move(2, 2);
        await icon.hover();
        await expect(tooltip(page)).toBeVisible();
        const bounds = await tooltip(page).boundingBox();
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        expect(bounds!.x).toBeGreaterThanOrEqual(8);
        expect(bounds!.y).toBeGreaterThanOrEqual(8);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 8);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 8);
        await page.screenshot({ path: testInfo.outputPath(`help-${theme}.png`) });
        await expect(tooltip(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await icon.click();
        await expect(tooltip(page)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`help-click-${theme}.png`) });
        await expect(tooltip(page)).toBeVisible();
        await page.keyboard.press('Escape');
    }
    await page.reload();
    await page.getByTestId('settings-page-storage').click();
    await expect(page.getByRole('button', { name: 'About storage', exact: true })).toHaveCount(1);
    await expect(tooltip(page)).toHaveCount(1);
});

test('board controls and independent job windows share help without changing the workflow', async ({ app }) => {
    const { page } = app;
    await connect(page);
    await page.locator('#superpanel-focus-next').hover();
    await expect(tooltip(page)).toContainText('highest-priority');
    const opened = app.desktop.waitForEvent('window');
    await page.locator('#superpanel-focus-next').click();
    const task = await opened;
    await expect(task.locator('#task-content')).toBeVisible();
    const claim = task.locator('.task-alert-action[data-action="claim"]');
    await claim.hover();
    await expect(tooltip(task)).toContainText('Assign this incident to you');
    await claim.click();
    await expect(task.locator('.task-alert-action[data-action="release"]')).toBeVisible();
    await expect(tooltip(task)).toBeHidden();
    await task.locator('#task-ai-summary').hover();
    await expect(tooltip(task)).toContainText(/captured evidence|Wait for/);
    await expect(task.getByRole('button', { name: 'About guided recovery', exact: true })).toHaveCount(1);
});

test('object analysis explains why compile is unavailable and source loading still works', async ({ app }) => {
    const { page } = app;
    await connect(page);
    await page.locator('#board-workspace-menu > summary').click();
    await page.locator('#open-object-analysis').click();
    await page.locator('[data-analysis-file="true"]').filter({ hasText: 'ORDENTR.rpgle' }).click();
    const compile = page.locator('#generate-compile-plan');
    await expect(compile).toBeDisabled();
    await compile.hover();
    await expect(tooltip(page)).toContainText(/analy[sz]/i);
    await expect(tooltip(page)).toBeVisible();
    await page.locator('#load-object-source').click();
    await expect(page.locator('#analysis-source-preview-code')).toContainText('dcl-f CUSTOMER');
    await expect(tooltip(page)).toBeHidden();
});
