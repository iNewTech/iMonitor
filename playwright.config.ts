import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: path.join(__dirname, 'tests', 'e2e'),
    timeout: 30000,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    workers: 1,
    reporter: 'list'
});
