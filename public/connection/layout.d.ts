export interface ConnectionPageModel {
    primaryActionLabel: 'Connect & Monitor';
    secondaryActionLabel: 'Save Profile';
    showSavedProfiles: true;
    showDemoAction: false;
    savedProfileCount: number;
    savedProfilesHint: string;
}

export function getConnectionPageModel(options?: { savedProfileCount?: number }): ConnectionPageModel;
