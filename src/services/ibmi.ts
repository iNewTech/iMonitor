import * as mapepire from "@ibm/mapepire-js";
import {DaemonServer} from "@ibm/mapepire-js/dist/src/types"

export default class Db {
  private pool: mapepire.Pool|undefined;

  async connect(server: DaemonServer) {
    const ca = await mapepire.getCertificate(server);
    server.ca = ca.raw;

    this.pool = new mapepire.Pool({creds: server, maxSize: 5, startingSize: 1});
    await this.pool.init();
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
    
    return this.pool.execute(statement, {parameters: bindingsValues});
  }

  async getActiveJobs() {
    if (!this.pool) {
      throw new Error("Database not connected");
    }
    
    const statement = `
            SELECT 
                SUBSYSTEM || '/' || JOB_NAME_SHORT as SUBSYSTEM_JOB,
                AUTHORIZATION_NAME as CURRENT_USER,
                JOB_TYPE_ENHANCED as TYPE,
                ELAPSED_CPU_PERCENTAGE as CPU,
                FUNCTION as FUNCTION_NAME,
                JOB_STATUS as STATUS
            FROM TABLE(QSYS2.ACTIVE_JOB_INFO(
                RESET_STATISTICS => 'NO',
                DETAILED_INFO => 'FULL'))
            WHERE JOB_TYPE <> 'SYS'
            ORDER BY ELAPSED_CPU_PERCENTAGE DESC
        `;
    return this.query(statement);
  }
}
