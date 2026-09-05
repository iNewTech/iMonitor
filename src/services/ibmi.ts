import * as mapepire from "@ibm/mapepire-js";
import type { DaemonServer } from "@ibm/mapepire-js";
import {
  decodeCursor,
  encodeCursor,
  normalizeJobQueueRecord,
  normalizePageSize,
  normalizeQueuedJobRecord,
  type JobQueueQuery,
  type QueuedJobQuery
} from "../features/action-board/job-queue-model";

export type ServiceLogLevel = "info" | "success" | "warning" | "error";
export type ServiceLogArea = "connection" | "sql";

export interface ServiceLogEntry {
  area: ServiceLogArea;
  level: ServiceLogLevel;
  message: string;
  detail?: string;
  sql?: string;
}

export interface QueryResult<T> {
  data: T[];
}

export interface JobQueueRecord {
  JOB_QUEUE_NAME: string;
  JOB_QUEUE_LIBRARY: string;
  JOB_QUEUE_STATUS: string;
  SUBSYSTEM_NAME: string | null;
  SUBSYSTEM_LIBRARY_NAME: string | null;
  SEQUENCE_NUMBER: number | null;
  OPERATOR_CONTROLLED: string | null;
  WAITING_JOBS: number;
  ACTIVE_JOBS: number | null;
  MAX_ACTIVE_JOBS: number | null;
  HELD_JOBS: number | null;
  TEXT_DESCRIPTION: string | null;
  OLDEST_WAIT_TIME: string | null;
}

export interface QueuedJobRecord {
  JOB_NAME: string;
  JOB_NAME_SHORT: string | null;
  JOB_NUMBER: string | null;
  JOB_USER: string | null;
  JOB_STATUS: string | null;
  JOB_TYPE: string | null;
  JOB_TYPE_ENHANCED: string | null;
  JOB_QUEUE_NAME: string;
  JOB_QUEUE_LIBRARY: string;
  JOB_QUEUE_STATUS: string | null;
  JOB_QUEUE_PRIORITY: number | string | null;
  JOB_QUEUE_TIME: string | null;
  JOB_ENTERED_SYSTEM_TIME: string | null;
  SUBSYSTEM: string | null;
  SUBSYSTEM_LIBRARY_NAME: string | null;
}

export interface PagedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ActiveJobRecord {
  JOB_NAME: string | null;
  JOB_NAME_SHORT: string | null;
  JOB_NUMBER: string | null;
  JOB_USER: string | null;
  SUBSYSTEM: string | null;
  SUBSYSTEM_LIBRARY_NAME: string | null;
  SUBSYSTEM_JOB: string | null;
  CURRENT_USER: string | null;
  TYPE: string | null;
  CPU: number | string | null;
  CPU_TIME: number | string | null;
  ELAPSED_CPU_TIME: number | string | null;
  FUNCTION_NAME: string | null;
  STATUS: string | null;
  THREAD_COUNT: number | string | null;
  TEMPORARY_STORAGE: number | string | null;
  TOTAL_DISK_IO_COUNT: number | string | null;
  ELAPSED_TOTAL_DISK_IO_COUNT: number | string | null;
  MESSAGE_REPLY: string | null;
  DATABASE_LOCK_WAITS: number | string | null;
  DATABASE_LOCK_WAIT_TIME: number | string | null;
  NON_DATABASE_LOCK_WAITS: number | string | null;
  NON_DATABASE_LOCK_WAIT_TIME: number | string | null;
  INTERNAL_MACHINE_LOCK_WAITS: number | string | null;
  INTERNAL_MACHINE_LOCK_WAIT_TIME: number | string | null;
  SQL_STATEMENT_TEXT: string | null;
  SQL_STATEMENT_STATUS: string | null;
    SQL_STATEMENT_START_TIMESTAMP: string | null;
}

export interface JobLogRecord {
  ORDINAL_POSITION: number | null;
  MESSAGE_ID: string | null;
  MESSAGE_TYPE: string | null;
  MESSAGE_TIMESTAMP: string | null;
  MESSAGE_TEXT: string | null;
  MESSAGE_SECOND_LEVEL_TEXT: string | null;
  MESSAGE_KEY_HEX: string | null;
  QUALIFIED_JOB_NAME: string | null;
}

export interface JobMessageRecord extends JobLogRecord {
  MESSAGE_QUEUE_LIBRARY: string | null;
  MESSAGE_QUEUE_NAME: string | null;
}

export interface SystemMessageRecord {
  MESSAGE_QUEUE_LIBRARY: string | null;
  MESSAGE_QUEUE_NAME: string | null;
  MESSAGE_KEY_HEX: string | null;
  MESSAGE_ID: string | null;
  MESSAGE_TYPE: string | null;
  FROM_USER: string | null;
  FROM_JOB: string | null;
  MESSAGE_TIMESTAMP: string | null;
  MESSAGE_TEXT: string | null;
  MESSAGE_SECOND_LEVEL_TEXT: string | null;
}

interface PeerCertificateIdentity {
  [key: string]: string | undefined;
}

export default class Db {
  private pool: mapepire.Pool|undefined;

  constructor(private readonly logger?: (entry: ServiceLogEntry) => void) {}

  private log(entry: ServiceLogEntry) {
    this.logger?.(entry);
  }

  private async initPool(server: DaemonServer) {
    this.pool = new mapepire.Pool({creds: server, maxSize: 5, startingSize: 1});
    await this.pool.init();
  }

  private isSameIdentity(
    left: PeerCertificateIdentity | undefined,
    right: PeerCertificateIdentity | undefined
  ) {
    if (!left || !right) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => left[key] === right[key]);
  }

  async connect(server: DaemonServer) {
    this.log({
      area: "connection",
      level: "info",
      message: `Fetching TLS certificate for ${server.host}:${server.port ?? 8076}.`
    });

    const ca = await mapepire.getCertificate(server);
    const isSelfSigned = this.isSameIdentity(
      ca.subject as PeerCertificateIdentity | undefined,
      ca.issuer as PeerCertificateIdentity | undefined
    );

    if (isSelfSigned) {
      this.log({
        area: "connection",
        level: "warning",
        message: `Self-signed Mapepire certificate detected for ${server.host}:${server.port ?? 8076}.`,
        detail: "Connecting with relaxed TLS verification because the current SDK strict-validation path rejects this certificate."
      });

      await this.initPool({
        ...server,
        ca: undefined,
        rejectUnauthorized: false
      });

      this.log({
        area: "connection",
        level: "warning",
        message: `Mapepire pool is ready for ${server.host}:${server.port ?? 8076} with relaxed TLS verification.`,
        detail: "The remote certificate is self-signed and was accepted without strict verification."
      });
      return;
    }

    server.ca = ca.raw;

    try {
      await this.initPool(server);

      this.log({
        area: "connection",
        level: "success",
        message: `Mapepire pool is ready for ${server.host}:${server.port ?? 8076}.`,
        detail: "TLS trust was established from the remote certificate."
      });
    } catch (error) {
      this.log({
        area: "connection",
        level: "error",
        message: `Certificate-based connection failed for ${server.host}:${server.port ?? 8076}.`,
        detail: error instanceof Error ? error.message : "Unknown TLS error"
      });
      throw error;
    }
  }

  close() {
    if (this.pool) {
      this.pool.end();
      this.pool = undefined;
    }
  }

  /**
   * @throws Will crash if query is invalid
   */
  /*
  static query<T>(statement: string, bindingsValues: (number|string)[] = []): Promise<T[]> {
    return this.pool.query(statement, bindingsValues) as Promise<T[]>;
  }
  */
  async query<T>(statement: string, bindingsValues: (number|string)[] = []) {
    if (!this.pool) {
      throw new Error("Database not connected");
    }

    try {
      const result = await this.pool.execute(statement, {parameters: bindingsValues});
      const resultWithData = result as {
        data?: unknown[];
      };
      const rowCount = Array.isArray(resultWithData.data) ? resultWithData.data.length : undefined;

      this.log({
        area: "sql",
        level: "success",
        message: "SQL executed successfully.",
        detail: rowCount === undefined
          ? `Parameters supplied: ${bindingsValues.length}.`
          : `Rows returned: ${rowCount}. Parameters supplied: ${bindingsValues.length}.`,
        sql: statement.trim()
      });

      return result as unknown as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SQL execution error";

      this.log({
        area: "sql",
        level: "error",
        message: "SQL execution failed.",
        detail: message,
        sql: statement.trim()
      });

      throw error;
    }
  }

  async getActiveJobs() {
    if (!this.pool) {
      throw new Error("Database not connected");
    }
    
    const statement = `
            SELECT 
                JOB_NAME,
                JOB_NAME_SHORT,
                JOB_NUMBER,
                JOB_USER,
                SUBSYSTEM,
                SUBSYSTEM_LIBRARY_NAME,
                COALESCE(SUBSYSTEM, '') CONCAT '/' CONCAT COALESCE(JOB_NAME_SHORT, '') AS SUBSYSTEM_JOB,
                AUTHORIZATION_NAME AS CURRENT_USER,
                JOB_TYPE_ENHANCED AS TYPE,
                ELAPSED_CPU_PERCENTAGE AS CPU,
                CPU_TIME,
                ELAPSED_CPU_TIME,
                FUNCTION AS FUNCTION_NAME,
                JOB_STATUS AS STATUS,
                THREAD_COUNT,
                TEMPORARY_STORAGE,
                TOTAL_DISK_IO_COUNT,
                ELAPSED_TOTAL_DISK_IO_COUNT,
                MESSAGE_REPLY,
                DATABASE_LOCK_WAITS,
                DATABASE_LOCK_WAIT_TIME,
                NON_DATABASE_LOCK_WAITS,
                NON_DATABASE_LOCK_WAIT_TIME,
                INTERNAL_MACHINE_LOCK_WAITS,
                INTERNAL_MACHINE_LOCK_WAIT_TIME,
                SQL_STATEMENT_TEXT,
                SQL_STATEMENT_STATUS,
                SQL_STATEMENT_START_TIMESTAMP
            FROM TABLE(QSYS2.ACTIVE_JOB_INFO(
                RESET_STATISTICS => 'NO',
                DETAILED_INFO => 'FULL'))
            WHERE JOB_TYPE <> 'SYS'
            ORDER BY ELAPSED_CPU_PERCENTAGE DESC
        `;
    return this.query<QueryResult<ActiveJobRecord>>(statement);
  }

  /**
   * Loads a bounded page of IBM i job queues. The queue view is intentionally
   * paged so a large partition cannot make the ActionBoard wait on startup.
   */
  async getJobQueues(options: JobQueueQuery = {}): Promise<PagedResult<Record<string, unknown>>> {
    const limit = normalizePageSize(options.limit);
    const parameters: (number | string)[] = [];
    const predicates: string[] = [];
    const search = options.search?.trim();
    const status = options.status?.trim().toUpperCase();
    const cursor = decodeCursor<{ library?: string; name?: string }>(options.cursor);

    if (search) {
      const pattern = `%${search.toUpperCase()}%`;
      predicates.push('(UPPER(JOB_QUEUE_NAME) LIKE ? OR UPPER(JOB_QUEUE_LIBRARY) LIKE ?)');
      parameters.push(pattern, pattern);
    }
    if (status && status !== 'ALL') {
      predicates.push('UPPER(JOB_QUEUE_STATUS) = ?');
      parameters.push(status);
    }
    if (cursor?.library && cursor.name) {
      predicates.push('(JOB_QUEUE_LIBRARY > ? OR (JOB_QUEUE_LIBRARY = ? AND JOB_QUEUE_NAME > ?))');
      parameters.push(cursor.library, cursor.library, cursor.name);
    }

    const result = await this.query<QueryResult<Record<string, unknown>>>(`
      SELECT *
      FROM QSYS2.JOB_QUEUE_INFO
      ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''}
      ORDER BY JOB_QUEUE_LIBRARY, JOB_QUEUE_NAME
      FETCH FIRST ${limit + 1} ROWS ONLY
    `, parameters);
    const records = Array.isArray(result.data) ? result.data : [];
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page[page.length - 1];

    return {
      data: page,
      hasMore,
      nextCursor: hasMore && last
        ? encodeCursor({
          library: normalizeJobQueueRecord(last).JOB_QUEUE_LIBRARY,
          name: normalizeJobQueueRecord(last).JOB_QUEUE_NAME
        })
        : null
    };
  }

  /**
   * Loads queued jobs from QSYS2.JOB_INFO (*JOBQ), optionally scoped to one
   * queue. A queue-less search is used when an operator searches for a job
   * that is not in the first visible queue page.
   */
  async getQueuedJobs(options: QueuedJobQuery = {}): Promise<PagedResult<Record<string, unknown>>> {
    const limit = normalizePageSize(options.limit);
    const parameters: (number | string)[] = [];
    const predicates: string[] = [];
    const search = options.search?.trim();
    const status = options.status?.trim().toUpperCase();
    const cursor = decodeCursor<{ queueTime?: string; jobName?: string }>(options.cursor);

    if (options.queueName?.trim()) {
      predicates.push('JOB_QUEUE_NAME = ?');
      parameters.push(options.queueName.trim());
    }
    if (options.queueLibrary?.trim()) {
      predicates.push('JOB_QUEUE_LIBRARY = ?');
      parameters.push(options.queueLibrary.trim());
    }
    if (search) {
      const pattern = `%${search.toUpperCase()}%`;
      predicates.push('(UPPER(JOB_NAME) LIKE ? OR UPPER(JOB_NAME_SHORT) LIKE ? OR UPPER(JOB_USER) LIKE ?)');
      parameters.push(pattern, pattern, pattern);
    }
    if (status && status !== 'ALL') {
      predicates.push('UPPER(JOB_QUEUE_STATUS) = ?');
      parameters.push(status);
    }
    if (cursor?.queueTime && cursor.jobName) {
      predicates.push('(JOB_QUEUE_TIME > ? OR (JOB_QUEUE_TIME = ? AND JOB_NAME > ?))');
      parameters.push(cursor.queueTime, cursor.queueTime, cursor.jobName);
    }

    const result = await this.query<QueryResult<Record<string, unknown>>>(`
      SELECT JOB_NAME, JOB_NAME_SHORT, JOB_NUMBER, JOB_USER, JOB_STATUS,
             JOB_TYPE, JOB_TYPE_ENHANCED, JOB_QUEUE_NAME, JOB_QUEUE_LIBRARY,
             JOB_QUEUE_STATUS, JOB_QUEUE_PRIORITY, JOB_QUEUE_TIME,
             JOB_ENTERED_SYSTEM_TIME, SUBSYSTEM, SUBSYSTEM_LIBRARY_NAME
      FROM TABLE(QSYS2.JOB_INFO(
        JOB_STATUS_FILTER => '*JOBQ',
        JOB_USER_FILTER => '*ALL'
      )) X
      ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''}
      ORDER BY JOB_QUEUE_TIME, JOB_NAME
      FETCH FIRST ${limit + 1} ROWS ONLY
    `, parameters);
    const records = Array.isArray(result.data) ? result.data : [];
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page[page.length - 1];
    const normalizedLast = last ? normalizeQueuedJobRecord(last) : null;

    return {
      data: page,
      hasMore,
      nextCursor: hasMore && normalizedLast?.JOB_QUEUE_TIME
        ? encodeCursor({
          queueTime: normalizedLast.JOB_QUEUE_TIME,
          jobName: normalizedLast.JOB_NAME
        })
        : null
    };
  }

  /**
   * Executes one IBM i CL command through QCMDEXC.
   */
  async executeClCommand(command: string) {
    return this.query('CALL QSYS2.QCMDEXC(?)', [command]);
  }

  /**
   * Loads the current IBM i job properties, including queue metadata.
   */
  async getJobProperties(jobName: string) {
    const result = await this.query<QueryResult<Record<string, unknown>>>(`
      SELECT *
      FROM TABLE(QSYS2.JOB_INFO(JOB_NAME_FILTER => ?))
      FETCH FIRST 1 ROW ONLY
    `, [jobName]);
    return result.data?.[0] ?? null;
  }

  /**
   * Loads the job queue definition associated with a job.
   */
  async getJobQueueDetails(queueName: string, queueLibrary = 'QGPL') {
    const result = await this.query<QueryResult<Record<string, unknown>>>(`
      SELECT *
      FROM QSYS2.JOB_QUEUE_INFO
      WHERE JOB_QUEUE_NAME = ?
        AND JOB_QUEUE_LIBRARY = ?
      FETCH FIRST 1 ROW ONLY
    `, [queueName, queueLibrary]);
    return result.data?.[0] ?? null;
  }

  /**
   * Loads operational information for a subsystem.
   */
  async getSubsystemDetails(subsystemName: string, subsystemLibrary = 'QSYS') {
    const result = await this.query<QueryResult<Record<string, unknown>>>(`
      SELECT *
      FROM QSYS2.SUBSYSTEM_INFO
      WHERE SUBSYSTEM_DESCRIPTION = ?
        AND SUBSYSTEM_DESCRIPTION_LIBRARY = ?
      FETCH FIRST 1 ROW ONLY
    `, [subsystemName, subsystemLibrary]);
    return result.data?.[0] ?? null;
  }

  /**
   * Loads the most recent messages from an IBM i job log.
   */
  async getJobLog(jobName: string) {
    const result = await this.query<QueryResult<JobLogRecord>>(`
      SELECT ORDINAL_POSITION, MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TIMESTAMP,
             MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT, HEX(MESSAGE_KEY) AS MESSAGE_KEY_HEX,
             QUALIFIED_JOB_NAME
      FROM TABLE(QSYS2.JOBLOG_INFO(?, 'YES'))
      ORDER BY ORDINAL_POSITION DESC
      FETCH FIRST 100 ROWS ONLY
    `, [jobName]);
    return result.data ?? [];
  }

  /**
   * Loads inquiry messages with their queue and message key for safe replies.
   */
  async getJobMessages(jobName: string) {
    const result = await this.query<QueryResult<JobMessageRecord>>(`
      SELECT MESSAGE_QUEUE_LIBRARY, MESSAGE_QUEUE_NAME, HEX(MESSAGE_KEY) AS MESSAGE_KEY_HEX,
             MESSAGE_ID, MESSAGE_TYPE, FROM_USER, FROM_JOB, MESSAGE_TIMESTAMP,
             MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
      FROM QSYS2.MESSAGE_QUEUE_INFO
      WHERE FROM_JOB = ?
        AND MESSAGE_TYPE IN ('INQUIRY', 'NOTIFY')
      ORDER BY MESSAGE_TIMESTAMP DESC
      FETCH FIRST 20 ROWS ONLY
    `, [jobName]);
    return result.data ?? [];
  }

  /**
   * Loads recent operator messages without changing QSYSOPR state.
   */
  async getSystemMessages() {
    const result = await this.query<QueryResult<SystemMessageRecord>>(`
      SELECT MESSAGE_QUEUE_LIBRARY, MESSAGE_QUEUE_NAME, HEX(MESSAGE_KEY) AS MESSAGE_KEY_HEX,
             MESSAGE_ID, MESSAGE_TYPE, FROM_USER, FROM_JOB, MESSAGE_TIMESTAMP,
             MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
      FROM TABLE(QSYS2.MESSAGE_QUEUE_INFO('QSYS', 'QSYSOPR', 'ALL', 0))
      ORDER BY MESSAGE_TIMESTAMP DESC
      FETCH FIRST 100 ROWS ONLY
    `);
    return result.data ?? [];
  }

  /**
   * Loads a job together with its queue and subsystem context.
   */
  async getJobContext(jobName: string) {
    const jobInfo = await this.getJobProperties(jobName);
    if (!jobInfo) {
      return { jobInfo: null, jobQueue: null, subsystem: null };
    }

    const queueName = String(jobInfo.JOB_QUEUE_NAME || '').trim();
    const queueLibrary = String(jobInfo.JOB_QUEUE_LIBRARY || 'QGPL').trim() || 'QGPL';
    const subsystemName = String(jobInfo.JOB_SUBSYSTEM || '').trim();
    const subsystemLibrary = String(jobInfo.SUBSYSTEM_DESCRIPTION_LIBRARY || 'QSYS').trim() || 'QSYS';
    const [jobQueue, subsystem] = await Promise.all([
      queueName ? this.getJobQueueDetails(queueName, queueLibrary) : Promise.resolve(null),
      subsystemName ? this.getSubsystemDetails(subsystemName, subsystemLibrary) : Promise.resolve(null)
    ]);

    return { jobInfo, jobQueue, subsystem };
  }
}
