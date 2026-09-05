# iMonitor feature access

iMonitor uses a simple Free/Premium feature boundary. The application keeps Premium controls visible so users can understand what is available, but protected operations are disabled until Premium is active.

## Free plan

- Job, subsystem, wait, SQL, message, and log information
- IBMEye alert detection and incident history
- Alert acknowledgement, ownership, return to queue, notes, and recheck
- Desktop notifications
- IBMEye AI explanations and recommendations with local Open Models

## Premium plan

- IBM i job actions such as hold, release, end, and MSGW reply
- ClickUp action tracking
- Slack alert delivery
- Jira incident tracking
- SMS notifications
- Hosted AI providers such as OpenAI, Claude, and Grok
- Email notifications using the user's SMTP server remain available on Free.

## Development license

Development builds accept this local test key:

```text
IMONITOR-DEV-PREMIUM-2026
```

The Connect screen includes a development plan selector so Free and Premium behavior can be previewed. Selecting Premium enables the development override; entering the key validates the Premium path explicitly.

The key is validated in the Electron main process and is intentionally rejected by packaged production builds. Development builds also include a development override so Premium workflows can be tested without changing production licensing behavior.

Production licensing should replace this path with signed license validation before release.

## Provider-neutral SMS

Premium users can connect any REST-based SMS gateway from Settings → SMS alerts. The adapter supports HTTPS endpoints, POST/PUT/PATCH/GET requests, JSON/form/text bodies, bearer/API-key/Basic authentication, custom headers, multiple recipients, and optional response ID extraction. Request templates can use alert tokens such as `{{recipient}}`, `{{message}}`, `{{title}}`, `{{timestamp}}`, `{{connection}}`, and `{{alertId}}`; configured credentials are also available when a provider requires them in a body or custom header.

Credentials are encrypted in local app storage. The development build can use a localhost endpoint for testing; production endpoints must use HTTPS. The shared IBMEye Alerts channel rules decide when SMS delivery is enabled, and repeated alerts are protected by the normal notification cooldown.
