import * as mapepire from "@ibm/mapepire-js";
import type { DaemonServer } from "@ibm/mapepire-js";

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
   * Executes one IBM i CL command through QCMDEXC.
   */
  async executeClCommand(command: string) {
    return this.query('CALL QSYS2.QCMDEXC(?)', [command]);
  }
}
