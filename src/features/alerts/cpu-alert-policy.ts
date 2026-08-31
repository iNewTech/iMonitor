export const DEFAULT_HIGH_CPU_DURATION_SECONDS = 0;
export const DEFAULT_HIGH_CPU_RECOVERY_THRESHOLD = 70;

/**
 * Returns true when CPU has remained above the alert threshold for the required duration.
 */
export function isCpuAlertEligible(
    aboveSince: string | undefined,
    now: string,
    durationSeconds = DEFAULT_HIGH_CPU_DURATION_SECONDS
) {
    if (!aboveSince || durationSeconds <= 0) {
        return Boolean(aboveSince);
    }

    const elapsedMs = new Date(now).getTime() - new Date(aboveSince).getTime();
    return Number.isFinite(elapsedMs) && elapsedMs >= durationSeconds * 1000;
}

/**
 * Returns true when CPU has dropped far enough to recover a high CPU incident.
 */
export function isCpuRecovered(cpu: number, recoveryThreshold: number) {
    return Number.isFinite(cpu) && cpu < recoveryThreshold;
}
