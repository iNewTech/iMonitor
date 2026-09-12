import { describe, expect, it } from 'vitest';
import { REPLAY_SCENARIOS, getReplayScenario, runReplay, sanitizeReplaySelection } from './incident-replay';

describe('incident replay training', () => {
    it('provides ten versioned scenarios with expected evidence and outcomes', () => {
        expect(REPLAY_SCENARIOS).toHaveLength(10);
        expect(REPLAY_SCENARIOS.every((scenario) => scenario.schema === 'imonitor-replay-scenario' && scenario.version === 1 && scenario.checks.length > 0)).toBe(true);
        expect(new Set(REPLAY_SCENARIOS.map((scenario) => scenario.expectedOutcome))).toEqual(new Set(['recovered', 'still-blocked', 'missing-evidence', 'unsafe-blocked', 'escalate']));
    });

    it('replays deterministically and never reports a live mutation', () => {
        const scenario = getReplayScenario('msgw-recovered')!;
        const result = runReplay(scenario, 'replyMessage');
        expect(result).toMatchObject({ outcome: 'recovered', trainingOnly: true, executedLiveAction: false, scenarioId: scenario.id });
        expect(result.checks.every((item) => item.status === 'passed')).toBe(true);
        expect(runReplay(scenario, 'replyMessage')).toEqual(result);
    });

    it('blocks unsafe or unavailable responses without calling a connector', () => {
        const stale = runReplay(getReplayScenario('msgw-stale-reply')!, 'replyMessage');
        const missing = runReplay(getReplayScenario('msgw-missing-evidence')!, 'replyMessage');
        expect(stale).toMatchObject({ outcome: 'unsafe-blocked', executedLiveAction: false });
        expect(missing).toMatchObject({ outcome: 'unsafe-blocked', executedLiveAction: false });
        expect(stale.summary).toContain('No live action');
    });

    it('normalizes unsupported response selections to investigation', () => {
        expect(sanitizeReplaySelection('replyMessage')).toBe('replyMessage');
        expect(sanitizeReplaySelection('endJob')).toBe('investigate');
    });
});
