import { describe, expect, it } from 'vitest';

import { getConnectionPageModel } from '../../../public/connection/layout.js';

describe('connection page model', () => {
    it('keeps the connection flow focused on one primary action', () => {
        expect(getConnectionPageModel()).toMatchObject({
            primaryActionLabel: 'Connect & Monitor',
            secondaryActionLabel: 'Save Profile',
            showSavedProfiles: true,
            showDemoAction: false
        });
    });

    it('describes saved profiles without adding another competing action', () => {
        expect(getConnectionPageModel({ savedProfileCount: 2 })).toMatchObject({
            savedProfileCount: 2,
            savedProfilesHint: 'Choose a saved system or enter connection details below.'
        });
    });
});
