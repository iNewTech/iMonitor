import SwiftUI
import WidgetKit

private let appGroupIdentifier = "group.com.inewtech.imonitor"
private let summaryFileName = "imonitor-widget-summary.json"

struct IMonitorWidgetSummary: Decodable {
    struct Connection: Decodable {
        let name: String?
        let host: String?
    }

    struct Status: Decodable {
        let label: String
        let healthy: Bool
        let detail: String
    }

    struct Metrics: Decodable {
        let totalJobs: Int
        let runningJobs: Int
        let waitingJobs: Int
        let messageWaitJobs: Int
        let lockWaitJobs: Int
        let peakCpu: Double
    }

    struct TopIssue: Decodable {
        let title: String
        let subtitle: String
        let severity: String
        let jobName: String?
        let owner: String?
    }

    let generatedAt: String
    let connection: Connection
    let status: Status
    let metrics: Metrics
    let topIssue: TopIssue?

    static let placeholder = IMonitorWidgetSummary(
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        connection: Connection(name: "Demo connection", host: "dummy"),
        status: Status(label: "Live", healthy: false, detail: "2 active issues"),
        metrics: Metrics(totalJobs: 18, runningJobs: 9, waitingJobs: 9, messageWaitJobs: 2, lockWaitJobs: 3, peakCpu: 76.8),
        topIssue: TopIssue(title: "QBATCH/NIGHTBCH", subtitle: "High CPU job detected", severity: "warning", jobName: "552901/BATCHNGT/NIGHTBCH", owner: "GajenderT")
    )
}

struct IMonitorEntry: TimelineEntry {
    let date: Date
    let summary: IMonitorWidgetSummary
}

struct IMonitorProvider: TimelineProvider {
    func placeholder(in context: Context) -> IMonitorEntry {
        IMonitorEntry(date: Date(), summary: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (IMonitorEntry) -> Void) {
        completion(IMonitorEntry(date: Date(), summary: loadSummary()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<IMonitorEntry>) -> Void) {
        let entry = IMonitorEntry(date: Date(), summary: loadSummary())
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 5, to: Date()) ?? Date().addingTimeInterval(300)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }

    private func loadSummary() -> IMonitorWidgetSummary {
        guard
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
        else {
            return .placeholder
        }

        let url = container.appendingPathComponent("widget").appendingPathComponent(summaryFileName)
        guard let data = try? Data(contentsOf: url) else {
            return .placeholder
        }

        return (try? JSONDecoder().decode(IMonitorWidgetSummary.self, from: data)) ?? .placeholder
    }
}

struct IMonitorWidgetView: View {
    let entry: IMonitorEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemSmall:
            smallView
        default:
            mediumView
        }
    }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Text("\(entry.summary.metrics.peakCpu, specifier: "%.1f")%")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
            HStack {
                metric("Jobs", entry.summary.metrics.totalJobs)
                metric("Wait", entry.summary.metrics.waitingJobs)
            }
            issueLine
        }
        .padding()
        .containerBackground(backgroundGradient, for: .widget)
    }

    private var mediumView: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            HStack(alignment: .firstTextBaseline, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(entry.summary.metrics.peakCpu, specifier: "%.1f")%")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    Text("Peak CPU")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                metric("Jobs", entry.summary.metrics.totalJobs)
                metric("Run", entry.summary.metrics.runningJobs)
                metric("Wait", entry.summary.metrics.waitingJobs)
                metric("MSGW", entry.summary.metrics.messageWaitJobs)
            }
            issueLine
        }
        .padding()
        .containerBackground(backgroundGradient, for: .widget)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(entry.summary.status.healthy ? .green : .orange)
                .frame(width: 8, height: 8)
            Text("iMonitor")
                .font(.headline)
            Spacer()
            Text(entry.summary.status.label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }

    private var issueLine: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.summary.topIssue?.title ?? entry.summary.status.detail)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
            Text(entry.summary.topIssue?.subtitle ?? entry.summary.connection.name ?? "No system selected")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }

    private func metric(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)")
                .font(.headline.monospacedDigit())
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }

    private var backgroundGradient: some ShapeStyle {
        LinearGradient(
            colors: [
                Color(red: 0.90, green: 0.97, blue: 0.96),
                Color(red: 0.75, green: 0.84, blue: 0.99),
                Color(red: 0.12, green: 0.44, blue: 0.39)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

@main
struct IMonitorWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "IMonitorWidget", provider: IMonitorProvider()) { entry in
            IMonitorWidgetView(entry: entry)
                .widgetURL(URL(string: "imonitor://open/actionboard"))
        }
        .configurationDisplayName("iMonitor Live")
        .description("Shows IBM i CPU, jobs, waits, and the top issue from iMonitor.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
