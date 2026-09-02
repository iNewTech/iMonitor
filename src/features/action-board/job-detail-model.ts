/**
 * Describes one message-shaped record returned by an IBM i detail query.
 */
export interface JobDetailMessageRecord {
    MESSAGE_TIMESTAMP?: string | null;
    MESSAGE_ID?: string | null;
    MESSAGE_TYPE?: string | null;
    MESSAGE_TEXT?: string | null;
    MESSAGE_SECOND_LEVEL_TEXT?: string | null;
    MESSAGE_QUEUE_LIBRARY?: string | null;
    MESSAGE_QUEUE_NAME?: string | null;
    MESSAGE_KEY_HEX?: string | null;
}

/**
 * Formats one IBM i job log record into a compact operator-readable line.
 */
export function formatJobDetailMessage(record: JobDetailMessageRecord) {
    const timestamp = record.MESSAGE_TIMESTAMP || 'Unknown time';
    const type = record.MESSAGE_TYPE || 'MESSAGE';
    const id = record.MESSAGE_ID ? ` ${record.MESSAGE_ID}` : '';
    const text = record.MESSAGE_TEXT || 'No message text.';
    const secondLevel = record.MESSAGE_SECOND_LEVEL_TEXT
        ? ` | ${record.MESSAGE_SECOND_LEVEL_TEXT}`
        : '';

    return `[${timestamp}] ${type}${id}: ${text}${secondLevel}`;
}

/**
 * Returns the stable context sections shown for a selected job.
 */
export function getJobContextSections(context: {
    jobInfo?: Record<string, unknown> | null;
    jobQueue?: Record<string, unknown> | null;
    subsystem?: Record<string, unknown> | null;
}) {
    return [
        { key: 'jobInfo', label: 'Job properties', value: context.jobInfo },
        { key: 'jobQueue', label: 'Job queue properties', value: context.jobQueue },
        { key: 'subsystem', label: 'Subsystem properties', value: context.subsystem }
    ];
}
