# iMonitor feature access

iMonitor uses a simple Free/Premium feature boundary. The application keeps Premium controls visible so users can understand what is available, but protected operations are disabled until Premium is active.

## Free plan

- Job, subsystem, wait, SQL, message, and log information
- IBMEye alert detection and incident history
- Alert acknowledgement, ownership, return to queue, notes, and recheck
- Desktop notifications
- IBMEye AI explanations and recommendations

## Premium plan

- IBM i job actions such as hold, release, end, and MSGW reply
- ClickUp action tracking
- Slack alert delivery
- Email notifications
- Future SMS notifications

## Development license

Development builds accept this local test key:

```text
IMONITOR-DEV-PREMIUM-2026
```

The Connect screen includes a development plan selector so Free and Premium behavior can be previewed. Selecting Premium enables the development override; entering the key validates the Premium path explicitly.

The key is validated in the Electron main process and is intentionally rejected by packaged production builds. Development builds also include a development override so Premium workflows can be tested without changing production licensing behavior.

Production licensing should replace this path with signed license validation before release.
