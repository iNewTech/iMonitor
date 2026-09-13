import { describe, expect, it } from 'vitest';
import { filterJobs } from './jobs-filter.js';
import { describeJobCondition } from './job-rows.js';
import { canUseProvider } from './ibmeyeai/model-source.js';

const jobs = [
    { JOB_NAME: '1/OPS/BATCH', SUBSYSTEM: 'QBATCH', STATUS: 'RUN', CPU: 95 },
    { JOB_NAME: '2/OPS/LOCK', SUBSYSTEM: 'QBATCH', STATUS: 'LCKW', CPU: 0 },
    { JOB_NAME: '3/WEB/API', SUBSYSTEM: 'QHTTPSVR', STATUS: 'RUN', CPU: 2 }
];
const alerts = [
    { jobName: jobs[0].JOB_NAME, isActive: true, kind: 'highCpu', severity: 'warning', owner: 'Anita', workflowStatus: 'claimed' },
    { jobName: jobs[1].JOB_NAME, isActive: true, kind: 'lockWait', severity: 'critical', title: 'Lock held', owner: '' }
];
const context = { findAlert: (key: string) => alerts.find(alert => alert.jobName === key), operatorName: 'Anita' };

describe('ActionBoard conditions and filters', () => {
    it('shows a specific high CPU condition instead of a healthy Running badge', () => {
        expect(describeJobCondition(jobs[0], alerts[0])).toMatchObject({ label: 'High CPU', tone: 'warning' });
        expect(describeJobCondition(jobs[2], null)).toMatchObject({ label: 'Running', tone: 'normal', detail: '' });
    });
    it('keeps recovery pending explicit until monitoring clears the incident', () => {
        expect(describeJobCondition({ ...jobs[1], STATUS: 'RUN' }, alerts[1])).toMatchObject({ label: 'Lock wait', detail: 'Observed Running; recovery not yet verified' });
        expect(describeJobCondition({ ...jobs[1], STATUS: 'RUN' }, { ...alerts[1], isActive: false }).label).toBe('Running');
    });
    it('combines current operator ownership with status, subsystem and search', () => {
        expect(filterJobs(jobs, { mine: true, status: 'ATTENTION', subsystem: 'QBATCH', query: 'Anita' }, context)).toEqual([jobs[0]]);
        expect(filterJobs(jobs, { mine: true }, { ...context, operatorName: 'Other operator' })).toEqual([]);
        expect(filterJobs(jobs, { status: 'HIGH_CPU' }, context)).toEqual([jobs[0]]);
        expect(filterJobs(jobs, { status: 'LCKW' }, context)).toEqual([jobs[1]]);
        expect(filterJobs(jobs, { status: 'RUN', subsystem: 'QHTTPSVR' }, context)).toEqual([jobs[2]]);
    });
    it('prefers an exact job identity over fuzzy neighbours but still tolerates typos', () => {
        const entries = [{ JOB_NAME: '100012/OPS/JOB12' }, { JOB_NAME: '100011/OPS/JOB11' }, { JOB_NAME: '123/OPS/INTERACT' }];
        expect(filterJobs(entries, { query: 'JOB12' })).toEqual([entries[0]]);
        expect(filterJobs(entries, { query: 'interct' })).toEqual([entries[2]]);
    });
    it('does not turn a missing operator into an unassigned work match', () => {
        expect(filterJobs(jobs, { mine: true }, { ...context, operatorName: '' })).toEqual([]);
    });
});

describe('quick model selection', () => {
    const snapshot = { settings: { enabled: true }, providerCatalog: [{ id: 'ollama' }, { id: 'openai' }], availability: { enabled: true, provider: 'ollama', healthy: true, availableModels: ['gemma3'] } };
    it('allows only discovery-backed ready providers', () => {
        expect(canUseProvider(snapshot, 'ollama')).toBe(true);
        expect(canUseProvider(snapshot, 'openai')).toBe(false);
        expect(canUseProvider({ ...snapshot, availability: { ...snapshot.availability, healthy: false } }, 'ollama')).toBe(false);
        expect(canUseProvider({ ...snapshot, availability: { ...snapshot.availability, availableModels: [] } }, 'ollama')).toBe(false);
        expect(canUseProvider({ ...snapshot, settings: { enabled: false } }, 'ollama')).toBe(false);
    });
});
