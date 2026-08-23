# Alert Workflow

## Current State

IBMEye currently supports:

- active alerts
- resolved alerts
- manual clear
- newest-first ordering
- sticky queue behavior

## Current Rules

- alerts remain visible after the triggering condition changes
- active alerts appear before resolved alerts
- manual clear hides an alert until the condition clears and reoccurs
- failed poll alerts resolve after a successful later poll

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
