import { describe, expect, it } from 'vitest';
import { formatClickUpComment } from './clickup-markdown';

describe('formatClickUpComment', () => {
    it('converts diagnostic markdown into readable ClickUp comment text', () => {
        expect(formatClickUpComment('**Issue:** MSGW detected\n\n**How to resolve:**\n\n1. *Check* the queue\n2. Review [job log](https://example.test/log)'))
            .toBe('Issue: MSGW detected\n\nHow to resolve:\n\n1. Check the queue\n2. Review job log (https://example.test/log)');
    });

    it('removes markdown fences and heading markers without losing content', () => {
        expect(formatClickUpComment('# Summary\n```sql\nSELECT 1;\n```')).toBe('Summary\nSELECT 1;');
    });
});
