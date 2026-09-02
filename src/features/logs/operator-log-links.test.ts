import { describe, expect, it } from 'vitest';

const { renderOperatorLogDetail } = require('../../../public/monitor/operator-log-links.js') as {
    renderOperatorLogDetail: (value: string) => string;
};

describe('operator-log-links', () => {
    it('renders ClickUp and other secure web URLs as clickable links', () => {
        const markup = renderOperatorLogDetail(
            'DEQW detected | https://app.clickup.com/t/86d47b01h'
        );

        expect(markup).toContain('<a ');
        expect(markup).toContain('href="https://app.clickup.com/t/86d47b01h"');
        expect(markup).toContain('data-external-url="https://app.clickup.com/t/86d47b01h"');
        expect(markup).toContain('https://app.clickup.com/t/86d47b01h</a>');
    });

    it('escapes normal text and ignores unsafe URL schemes', () => {
        const markup = renderOperatorLogDetail('<script>alert(1)</script> javascript:alert(1)');

        expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(markup).not.toContain('<a ');
        expect(markup).not.toContain('href="javascript:');
    });
});
