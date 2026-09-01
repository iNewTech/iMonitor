import { randomBytes } from 'node:crypto';

const key = `IMONITOR-DEV-${randomBytes(10).toString('hex').toUpperCase()}`;
console.log(`Generated development license key: ${key}`);
console.log(`Start the app with: IMONITOR_DEV_LICENSE_KEY=${key} npm start`);
