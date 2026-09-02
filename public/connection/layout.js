/** Returns stable copy and visibility rules for the focused connection flow. */
export function getConnectionPageModel(options = {}) {
    return {
        primaryActionLabel: 'Connect & Monitor',
        secondaryActionLabel: 'Save Profile',
        showSavedProfiles: true,
        showDemoAction: false,
        savedProfileCount: Math.max(0, options.savedProfileCount || 0),
        savedProfilesHint: 'Choose a saved system or enter connection details below.'
    };
}
