import { describe, expect, it } from 'vitest';
import { DEFAULT_COLLECTOR_SETTINGS, normalizeCollectorSettings } from './collector-model';

describe('collector settings', () => {
    it('provides a disabled, safe default', () => {
        expect(DEFAULT_COLLECTOR_SETTINGS).toMatchObject({ enabled: false, intervalMs: 5000, retentionDays: 30 });
    });

    it('trims identifiers and clamps operator inputs', () => {
        expect(normalizeCollectorSettings({
            enabled: true,
            connectionId: '  system-1  ',
            intervalMs: 0,
            retentionDays: 99999,
            maxStorageMb: -4
        })).toMatchObject({
            enabled: true,
            connectionId: 'system-1',
            intervalMs: 1000,
            retentionDays: 3650,
            maxStorageMb: 1
        });
    });
});
