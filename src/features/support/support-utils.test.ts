import { describe, expect, it } from 'vitest';
import {
    buildSupportContactBody,
    buildSupportDiagnosticsBody,
    buildSupportDiagnosticsFileName,
    buildSupportMailtoUrl
} from './support-utils';

describe('support-utils', () => {
    it('builds a mailto URL with encoded subject and body', () => {
        const url = buildSupportMailtoUrl({
            supportEmail: 'gajendertyagi.tyagi@gmail.com',
            subject: 'iMonitor support',
            body: 'Line one\nLine two'
        });

        expect(url).toBe(
            'mailto:gajendertyagi.tyagi%40gmail.com?subject=iMonitor%20support&body=Line%20one%0ALine%20two'
        );
    });

    it('builds a readable contact-only support body', () => {
        const body = buildSupportContactBody({
            appName: 'iMonitor',
            appVersion: '1.2.3'
        });

        expect(body).toContain('I need help with iMonitor v1.2.3.');
        expect(body).toContain('Issue summary:');
    });

    it('builds a diagnostics support body that includes the file path', () => {
        const body = buildSupportDiagnosticsBody({
            appName: 'iMonitor',
            appVersion: '1.2.3',
            diagnosticsPath: '/tmp/iMonitor-support.txt'
        });

        expect(body).toContain('I am sending encrypted diagnostics from iMonitor v1.2.3.');
        expect(body).toContain('Diagnostics file: /tmp/iMonitor-support.txt');
    });

    it('builds a safe diagnostics file name', () => {
        const fileName = buildSupportDiagnosticsFileName('iMonitor App', '2026-08-24T12:34:56.789Z');

        expect(fileName).toBe('imonitor-app-support-2026-08-24T12-34-56-789Z.imonitor-diagnostics');
    });
});
