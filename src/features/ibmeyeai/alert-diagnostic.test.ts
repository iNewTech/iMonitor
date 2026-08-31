import { describe, expect, it } from 'vitest';
import { buildAlertDiagnosticPrompt, buildFallbackAlertDiagnostic } from './alert-diagnostic';

const alert = {
    id: 'msgw:123/DEMO/JOB',
    kind: 'messageWait' as const,
    severity: 'critical' as const,
    timestamp: '2026-08-30T09:00:00.000Z',
    title: 'MSGW detected',
    message: 'QINTER/DEMOJOB entered message wait.',
    detail: 'Waiting for an operator reply.',
    jobName: '123/DEMO/JOB',
    workflowStatus: 'new' as const,
    notes: [],
    timeline: [],
    workflowUpdatedAt: '2026-08-30T09:00:00.000Z'
};

describe('alert-diagnostic', () => {
    it('asks AI for a structured issue, cause, and resolution report', () => {
        const prompt = buildAlertDiagnosticPrompt(alert);

        expect(prompt).toContain('Issue');
        expect(prompt).toContain('Why');
        expect(prompt).toContain('How to resolve');
        expect(prompt).toContain('MSGW detected');
        expect(prompt).toContain('123/DEMO/JOB');
    });

    it('provides an honest fallback when AI is unavailable', () => {
        const fallback = buildFallbackAlertDiagnostic(alert, 'Ollama is unavailable.');

        expect(fallback).toContain('Issue:\nMSGW detected');
        expect(fallback).toContain('Why:\nWaiting for an operator reply.');
        expect(fallback).toContain('How to resolve:\nReview the alert and the current job state before taking an operator action.');
        expect(fallback).toContain('Ollama is unavailable.');
    });
});
