# IBMEye Alerts in iMonitor ActionBoard

## Current State

The `IBMEye` alert module inside `iMonitor` currently supports:

- active alerts
- resolved alerts
- manual clear
- DLYW and DEQW wait detection
- newest-first ordering
- sticky queue behavior
- scroll-stable refresh behavior while reading expanded alerts

## Current Rules

- alerts remain visible after the triggering condition changes
- active alerts appear before resolved alerts
- manual clear hides an alert until the condition clears and reoccurs
- failed poll alerts resolve after a successful later poll

## ClickUp Action Tracking

New alerts do not create ClickUp tasks automatically. Slack handles alert delivery; ClickUp begins tracking only when an operator selects `Start Work`.

When work starts, the backend:

1. claims the alert for the active operator
2. creates one linked ClickUp task and assigns it to that operator
3. posts an AI report with `Issue`, `Why`, and `How to resolve` sections
4. attaches only the matching job history when captured history exists

AI and attachment failures are recorded in encrypted developer diagnostics and do not remove the task or alert.

## Slack Delivery

Slack delivery uses one Incoming Webhook configured for a shared operations channel. The `IBMEye Alerts` watch rules are the single source of truth for which conditions are delivered to Slack; the Slack integration does not duplicate those condition switches. Each newly created alert is sent once, while repeated polls for the same active condition remain quiet.

Webhook failures are recorded in encrypted developer diagnostics and do not interrupt monitoring.

## Planned Workflow States

- New
- Acknowledged
- In Progress
- Resolved
- Cleared

## Planned User Actions

- Acknowledge
- Mark In Progress
- Resolve
- Clear
- Add note
- Export incident

## Planned Persistence

Alert workflow state should survive app restart and live in a dedicated local store module.
