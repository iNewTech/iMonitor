# iMonitor macOS Widget

This folder contains the native WidgetKit scaffold for the iMonitor desktop widget.

## What the Electron app writes

iMonitor writes the latest widget summary after every monitoring poll:

- Development fallback: `~/Library/Application Support/iMonitor/widget/imonitor-widget-summary.json`
- macOS widget App Group path: `~/Library/Group Containers/group.com.inewtech.imonitor/widget/imonitor-widget-summary.json`

The widget reads the App Group path.

## Xcode setup

1. Open Xcode and create or open a macOS app container project for iMonitor.
2. Add a Widget Extension target named `iMonitorWidget`.
3. Copy `iMonitorWidget/iMonitorWidget.swift` into that target.
4. Set the widget bundle id to `com.inewtech.imonitor.widget`.
5. Add App Groups capability to both the app and widget target.
6. Add this group to both targets: `group.com.inewtech.imonitor`.
7. Use `iMonitorWidget/iMonitorWidget.entitlements` for the widget target.
8. Package/sign the Electron app with `build/entitlements.mac.plist`.

## Widget behavior

The widget supports small and medium sizes and shows:

- live/idle state
- peak CPU
- total jobs
- running jobs
- waiting jobs
- MSGW count
- top issue or top CPU job

Tapping the widget opens `imonitor://open/actionboard`.

## Important limitation

macOS decides when widgets refresh. iMonitor writes fresh data every poll, but the widget may not repaint instantly. For a true live seconds-level display, use an Electron floating widget instead.
