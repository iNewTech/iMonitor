export type Plan = 'free' | 'premium';

export type FeatureId =
    | 'job-information'
    | 'alert-workflow'
    | 'desktop-notifications'
    | 'ai-analysis'
    | 'job-actions'
    | 'clickup-integration'
    | 'slack-integration'
    | 'email-notifications'
    | 'sms-notifications';

export interface FeatureEntitlement {
    id: FeatureId;
    label: string;
    plan: Plan;
    description: string;
}

export interface EntitlementState {
    plan: Plan;
    source: 'free' | 'development-license' | 'development-override';
    licenseKey?: string;
    expiresAt?: string;
    features: Record<FeatureId, boolean>;
}

export const DEVELOPMENT_LICENSE_KEY = 'IMONITOR-DEV-PREMIUM-2026';

export const FEATURE_ENTITLEMENTS: readonly FeatureEntitlement[] = [
    { id: 'job-information', label: 'Job and system information', plan: 'free', description: 'View jobs, waits, SQL context, logs, and system details.' },
    { id: 'alert-workflow', label: 'Alert ownership and notes', plan: 'free', description: 'Acknowledge, claim, recheck, and document incidents.' },
    { id: 'desktop-notifications', label: 'Desktop notifications', plan: 'free', description: 'Receive local notifications for watched conditions.' },
    { id: 'ai-analysis', label: 'IBMEye AI analysis', plan: 'free', description: 'Ask for evidence-based explanations and recommendations.' },
    { id: 'job-actions', label: 'IBM i job actions', plan: 'premium', description: 'Run approved hold, release, end, and message actions.' },
    { id: 'clickup-integration', label: 'ClickUp integration', plan: 'premium', description: 'Create and update external work items.' },
    { id: 'slack-integration', label: 'Slack integration', plan: 'premium', description: 'Deliver alerts to Slack channels.' },
    { id: 'email-notifications', label: 'Email notifications', plan: 'premium', description: 'Deliver alerts through SMTP email.' },
    { id: 'sms-notifications', label: 'SMS notifications', plan: 'premium', description: 'Deliver concise alerts through SMS.' }
];

function featureMap(enabledPremium: boolean): Record<FeatureId, boolean> {
    return Object.fromEntries(FEATURE_ENTITLEMENTS.map((feature) => [
        feature.id,
        feature.plan === 'free' || enabledPremium
    ])) as Record<FeatureId, boolean>;
}

/** Creates the plan state used by both UI and backend guards. */
export function createEntitlementState(options: {
    development: boolean;
    licenseKey?: string;
    forceFree?: boolean;
}): EntitlementState {
    const validDevelopmentLicense = options.development && options.licenseKey === DEVELOPMENT_LICENSE_KEY;
    const developmentOverride = options.development && !options.forceFree && !options.licenseKey;
    const premium = validDevelopmentLicense || developmentOverride;

    return {
        plan: premium ? 'premium' : 'free',
        source: validDevelopmentLicense
            ? 'development-license'
            : developmentOverride
                ? 'development-override'
                : 'free',
        licenseKey: validDevelopmentLicense ? options.licenseKey : undefined,
        expiresAt: validDevelopmentLicense ? '2099-12-31T23:59:59.000Z' : undefined,
        features: featureMap(premium)
    };
}

/** Returns true when a feature is available in the current plan. */
export function hasEntitlement(state: EntitlementState, feature: FeatureId) {
    return state.features[feature] === true;
}

/** Returns a stable error for a blocked Premium operation. */
export function premiumRequiredMessage(feature: FeatureId) {
    const definition = FEATURE_ENTITLEMENTS.find((candidate) => candidate.id === feature);
    return `${definition?.label || 'This feature'} requires Premium.`;
}
