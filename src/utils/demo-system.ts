import * as fs from 'fs/promises';
import * as path from 'path';
import type { ActiveJobRecord, QueryResult } from '../services/ibmi';

interface DemoSnapshotFile extends QueryResult<ActiveJobRecord> {
    generatedAt: string;
    pollCount: number;
}

interface DemoQueryResult extends QueryResult<ActiveJobRecord> {
    generatedAt?: string;
    pollCount?: number;
}

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, digits = 1) {
    const value = min + Math.random() * (max - min);
    return Number(value.toFixed(digits));
}

function createDemoJob(overrides: Partial<ActiveJobRecord>): ActiveJobRecord {
    return {
        JOB_NAME: '000000/GajenderT/DEMOJOB',
        JOB_NAME_SHORT: 'DEMOJOB',
        JOB_NUMBER: '000000',
        JOB_USER: 'GajenderT',
        SUBSYSTEM: 'QSYSWRK',
        SUBSYSTEM_LIBRARY_NAME: 'QSYS',
        SUBSYSTEM_JOB: 'QSYSWRK/DEMOJOB',
        CURRENT_USER: 'GajenderT',
        TYPE: 'BATCH',
        CPU: 0,
        CPU_TIME: 0,
        ELAPSED_CPU_TIME: 0,
        FUNCTION_NAME: 'Demo workload',
        STATUS: 'RUN',
        THREAD_COUNT: 1,
        TEMPORARY_STORAGE: 128,
        TOTAL_DISK_IO_COUNT: 0,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0,
        MESSAGE_REPLY: 'NO',
        DATABASE_LOCK_WAITS: 0,
        DATABASE_LOCK_WAIT_TIME: 0,
        NON_DATABASE_LOCK_WAITS: 0,
        NON_DATABASE_LOCK_WAIT_TIME: 0,
        INTERNAL_MACHINE_LOCK_WAITS: 0,
        INTERNAL_MACHINE_LOCK_WAIT_TIME: 0,
        SQL_STATEMENT_TEXT: 'select * from qsys2.active_job_info fetch first 25 rows only',
        SQL_STATEMENT_STATUS: 'RUNNING',
        SQL_STATEMENT_START_TIMESTAMP: new Date().toISOString(),
        ...overrides
    };
}

export function getDemoDataFilePath(baseDir: string) {
    return path.join(baseDir, 'demo', 'ibm-eye-demo-jobs.json');
}

export function getDemoDatabasePath(baseDir: string) {
    return path.join(baseDir, 'demo', 'ibm-eye-demo.sqlite');
}

function buildDemoGeneratedAt(pollCount: number) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(8, 5, 0, 0);

    const minuteOffset = ((Math.max(1, pollCount) - 1) * 43) % (12 * 60);
    const secondOffset = (pollCount * 17) % 60;
    return new Date(startOfDay.getTime() + (minuteOffset * 60_000) + (secondOffset * 1_000));
}

function offsetIso(baseTime: Date, minMs: number, maxMs: number) {
    return new Date(baseTime.getTime() - randomInt(minMs, maxMs)).toISOString();
}

function buildPersistentIncidentJobs(now: Date) {
    return [
        createDemoJob({
            JOB_NAME: '738412/QSYSOPR/MSGWJOB',
            JOB_NAME_SHORT: 'MSGWJOB',
            JOB_NUMBER: '738412',
            JOB_USER: 'QSYSOPR',
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_JOB: 'QINTER/MSGWJOB',
            CURRENT_USER: 'QSYSOPR',
            FUNCTION_NAME: 'Waiting on operator reply',
            STATUS: 'MSGW',
            CPU: randomFloat(0.2, 1.4),
            CPU_TIME: randomInt(1800, 4200),
            ELAPSED_CPU_TIME: randomInt(120, 340),
            THREAD_COUNT: 2,
            TEMPORARY_STORAGE: randomInt(260, 420),
            TOTAL_DISK_IO_COUNT: randomInt(12200, 12600),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(180, 260),
            MESSAGE_REPLY: 'YES',
            SQL_STATEMENT_TEXT: 'call inventory.hold_order_message(?)',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 35_000, 90_000)
        }),
        createDemoJob({
            JOB_NAME: '719844/QPGMR/ORDHOLD',
            JOB_NAME_SHORT: 'ORDHOLD',
            JOB_NUMBER: '719844',
            JOB_USER: 'QPGMR',
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_JOB: 'QINTER/ORDHOLD',
            CURRENT_USER: 'CSRUSER',
            FUNCTION_NAME: 'Order maintenance reply pending',
            STATUS: 'MSGW',
            CPU: randomFloat(0.1, 0.7),
            CPU_TIME: randomInt(900, 2200),
            ELAPSED_CPU_TIME: randomInt(80, 220),
            THREAD_COUNT: 1,
            TEMPORARY_STORAGE: randomInt(140, 260),
            TOTAL_DISK_IO_COUNT: randomInt(2800, 5600),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(35, 85),
            MESSAGE_REPLY: 'YES',
            SQL_STATEMENT_TEXT: 'call order_entry.await_credit_override(?)',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 70_000, 180_000)
        }),
        createDemoJob({
            JOB_NAME: '441210/APPUSR/LOCKJOB',
            JOB_NAME_SHORT: 'LOCKJOB',
            JOB_NUMBER: '441210',
            JOB_USER: 'APPUSR',
            SUBSYSTEM: 'QHTTPSVR',
            SUBSYSTEM_JOB: 'QHTTPSVR/LOCKJOB',
            CURRENT_USER: 'APPUSR',
            FUNCTION_NAME: 'Waiting on customer row lock',
            STATUS: 'LCKW',
            CPU: randomFloat(0.1, 0.8),
            CPU_TIME: randomInt(3200, 5800),
            THREAD_COUNT: 8,
            TEMPORARY_STORAGE: randomInt(420, 610),
            TOTAL_DISK_IO_COUNT: randomInt(67600, 68400),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(320, 420),
            DATABASE_LOCK_WAITS: randomInt(1, 4),
            DATABASE_LOCK_WAIT_TIME: randomInt(2200, 6800),
            SQL_STATEMENT_TEXT: 'update crm.customer set credit_hold = ? where customer_id = ?',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 40_000, 150_000)
        }),
        createDemoJob({
            JOB_NAME: '488551/APORDR/INVLOCK',
            JOB_NAME_SHORT: 'INVLOCK',
            JOB_NUMBER: '488551',
            JOB_USER: 'APORDR',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/INVLOCK',
            CURRENT_USER: 'APORDR',
            FUNCTION_NAME: 'Invoice settlement lock wait',
            STATUS: 'LCKW',
            CPU: randomFloat(0.2, 1),
            CPU_TIME: randomInt(4200, 7200),
            ELAPSED_CPU_TIME: randomInt(200, 430),
            THREAD_COUNT: 3,
            TEMPORARY_STORAGE: randomInt(360, 520),
            TOTAL_DISK_IO_COUNT: randomInt(44100, 50200),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(160, 320),
            DATABASE_LOCK_WAITS: randomInt(2, 6),
            DATABASE_LOCK_WAIT_TIME: randomInt(4800, 9600),
            SQL_STATEMENT_TEXT: 'update finance.invoice set settlement_status = ? where invoice_id = ?',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 90_000, 260_000)
        }),
        createDemoJob({
            JOB_NAME: '610040/QUSER/QZDASOINIT',
            JOB_NAME_SHORT: 'QZDASOINIT',
            JOB_NUMBER: '610040',
            JOB_USER: 'QUSER',
            SUBSYSTEM: 'QSERVER',
            SUBSYSTEM_JOB: 'QSERVER/QZDASOINIT',
            CURRENT_USER: 'APPAPI',
            FUNCTION_NAME: 'Remote SQL server mode',
            STATUS: 'DEQW',
            CPU: randomFloat(0.1, 0.5),
            CPU_TIME: randomInt(2500, 4600),
            ELAPSED_CPU_TIME: randomInt(1700, 3400),
            THREAD_COUNT: 5,
            TEMPORARY_STORAGE: randomInt(340, 540),
            TOTAL_DISK_IO_COUNT: randomInt(40200, 52000),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(160, 320),
            SQL_STATEMENT_TEXT: 'call reporting.wait_for_extract_window()',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 45_000, 130_000)
        }),
        createDemoJob({
            JOB_NAME: '662204/ETLUSR/ETLPIPE',
            JOB_NAME_SHORT: 'ETLPIPE',
            JOB_NUMBER: '662204',
            JOB_USER: 'ETLUSR',
            SUBSYSTEM: 'QUSRWRK',
            SUBSYSTEM_JOB: 'QUSRWRK/ETLPIPE',
            CURRENT_USER: 'ETLUSR',
            FUNCTION_NAME: 'Applying warehouse delta loads',
            STATUS: 'DLYW',
            CPU: randomFloat(0, 0.3),
            CPU_TIME: randomInt(6400, 10800),
            ELAPSED_CPU_TIME: randomInt(5200, 9300),
            THREAD_COUNT: 3,
            TEMPORARY_STORAGE: randomInt(900, 1400),
            TOTAL_DISK_IO_COUNT: randomInt(90200, 94400),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(420, 730),
            SQL_STATEMENT_TEXT: 'call warehouse.apply_delay_window()',
            SQL_STATEMENT_STATUS: 'DELAYED',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 25_000, 160_000)
        })
    ];
}

function buildRunningJobs(now: Date) {
    return [
        createDemoJob({
            JOB_NAME: '552901/BATCHNGT/NIGHTBCH',
            JOB_NAME_SHORT: 'NIGHTBCH',
            JOB_NUMBER: '552901',
            JOB_USER: 'BATCHNGT',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/NIGHTBCH',
            CURRENT_USER: 'BATCHNGT',
            FUNCTION_NAME: 'Posting invoices',
            STATUS: 'RUN',
            CPU: randomFloat(76, 91),
            CPU_TIME: randomInt(14800, 16200),
            ELAPSED_CPU_TIME: randomInt(9800, 11600),
            THREAD_COUNT: 4,
            TEMPORARY_STORAGE: randomInt(760, 920),
            TOTAL_DISK_IO_COUNT: randomInt(228000, 231500),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(1300, 1500),
            SQL_STATEMENT_TEXT: 'merge into finance.daily_invoice_summary using session.posted_batches on ...',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 120_000, 240_000)
        }),
        createDemoJob({
            JOB_NAME: '781204/QPADEV/INTERACT',
            JOB_NAME_SHORT: 'INTERACT',
            JOB_NUMBER: '781204',
            JOB_USER: 'QPADEV',
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_JOB: 'QINTER/INTERACT',
            CURRENT_USER: 'QPADEV',
            FUNCTION_NAME: 'Payment inquiry screen',
            STATUS: 'RUN',
            CPU: randomFloat(3, 9),
            CPU_TIME: randomInt(1200, 3600),
            ELAPSED_CPU_TIME: randomInt(600, 2200),
            THREAD_COUNT: 2,
            TEMPORARY_STORAGE: randomInt(180, 360),
            TOTAL_DISK_IO_COUNT: randomInt(8000, 12000),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(80, 140),
            SQL_STATEMENT_TEXT: 'select * from customer.payment_status where account_id = ?',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 15_000, 85_000)
        }),
        createDemoJob({
            JOB_NAME: '901155/ARBATCH/ARPOST',
            JOB_NAME_SHORT: 'ARPOST',
            JOB_NUMBER: '901155',
            JOB_USER: 'ARBATCH',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/ARPOST',
            CURRENT_USER: 'ARBATCH',
            FUNCTION_NAME: 'Accounts receivable posting',
            STATUS: 'RUN',
            CPU: randomFloat(28, 52),
            CPU_TIME: randomInt(5400, 10400),
            ELAPSED_CPU_TIME: randomInt(4400, 9200),
            THREAD_COUNT: 3,
            TEMPORARY_STORAGE: randomInt(440, 720),
            TOTAL_DISK_IO_COUNT: randomInt(102000, 128000),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(420, 760),
            SQL_STATEMENT_TEXT: 'insert into finance.ar_ledger select * from session.ar_delta',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 60_000, 150_000)
        }),
        createDemoJob({
            JOB_NAME: '430115/SPLUSR/SPLRUN',
            JOB_NAME_SHORT: 'SPLRUN',
            JOB_NUMBER: '430115',
            JOB_USER: 'SPLUSR',
            SUBSYSTEM: 'QSPL',
            SUBSYSTEM_JOB: 'QSPL/SPLRUN',
            CURRENT_USER: 'SPLUSR',
            FUNCTION_NAME: 'Spooled file generation',
            STATUS: 'RUN',
            CPU: randomFloat(4, 11),
            CPU_TIME: randomInt(1100, 2600),
            ELAPSED_CPU_TIME: randomInt(800, 1700),
            THREAD_COUNT: 2,
            TEMPORARY_STORAGE: randomInt(120, 260),
            TOTAL_DISK_IO_COUNT: randomInt(6200, 11400),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(70, 130),
            SQL_STATEMENT_TEXT: 'call qsys2.generate_spool_extract(?)',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 20_000, 70_000)
        }),
        createDemoJob({
            JOB_NAME: '220901/CTLUSR/CTLWATCH',
            JOB_NAME_SHORT: 'CTLWATCH',
            JOB_NUMBER: '220901',
            JOB_USER: 'CTLUSR',
            SUBSYSTEM: 'QCTL',
            SUBSYSTEM_JOB: 'QCTL/CTLWATCH',
            CURRENT_USER: 'CTLUSR',
            FUNCTION_NAME: 'Controller housekeeping',
            STATUS: 'RUN',
            CPU: randomFloat(1, 4),
            CPU_TIME: randomInt(400, 1400),
            ELAPSED_CPU_TIME: randomInt(300, 1100),
            THREAD_COUNT: 1,
            TEMPORARY_STORAGE: randomInt(80, 160),
            TOTAL_DISK_IO_COUNT: randomInt(1200, 2600),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(20, 80),
            SQL_STATEMENT_TEXT: 'values current timestamp',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 10_000, 55_000)
        }),
        createDemoJob({
            JOB_NAME: '551902/WEBUSR/HTTPAPI2',
            JOB_NAME_SHORT: 'HTTPAPI2',
            JOB_NUMBER: '551902',
            JOB_USER: 'WEBUSR',
            SUBSYSTEM: 'QHTTPSVR',
            SUBSYSTEM_JOB: 'QHTTPSVR/HTTPAPI2',
            CURRENT_USER: 'WEBUSR',
            FUNCTION_NAME: 'Public API traffic',
            STATUS: 'RUN',
            CPU: randomFloat(8, 19),
            CPU_TIME: randomInt(2600, 5400),
            ELAPSED_CPU_TIME: randomInt(1800, 4200),
            THREAD_COUNT: 6,
            TEMPORARY_STORAGE: randomInt(320, 520),
            TOTAL_DISK_IO_COUNT: randomInt(48600, 60200),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(180, 360),
            SQL_STATEMENT_TEXT: 'select api_name, avg_ms from api.performance_view order by avg_ms desc',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 15_000, 95_000)
        })
    ];
}

function buildCumulativeGrowthJobs(now: Date, pollCount: number) {
    const growthJobs = [
        createDemoJob({
            JOB_NAME: '660210/EDIUSR/EDIPUSH',
            JOB_NAME_SHORT: 'EDIPUSH',
            JOB_NUMBER: '660210',
            JOB_USER: 'EDIUSR',
            SUBSYSTEM: 'QUSRWRK',
            SUBSYSTEM_JOB: 'QUSRWRK/EDIPUSH',
            CURRENT_USER: 'EDIUSR',
            FUNCTION_NAME: 'Outbound EDI document push',
            STATUS: 'RUN',
            CPU: randomFloat(12, 24),
            CPU_TIME: randomInt(2400, 5200),
            ELAPSED_CPU_TIME: randomInt(1600, 3100),
            THREAD_COUNT: 2,
            TEMPORARY_STORAGE: randomInt(220, 360),
            TOTAL_DISK_IO_COUNT: randomInt(18200, 28400),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(120, 240),
            SQL_STATEMENT_TEXT: 'insert into edi.outbound_queue select * from session.pending_docs',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 30_000, 90_000)
        }),
        createDemoJob({
            JOB_NAME: '667701/OPSUSR/MSGWAIT2',
            JOB_NAME_SHORT: 'MSGWAIT2',
            JOB_NUMBER: '667701',
            JOB_USER: 'OPSUSR',
            SUBSYSTEM: 'QINTER',
            SUBSYSTEM_JOB: 'QINTER/MSGWAIT2',
            CURRENT_USER: 'OPSUSR',
            FUNCTION_NAME: 'Operator reply pending on tape rotation',
            STATUS: 'MSGW',
            CPU: randomFloat(0, 0.4),
            CPU_TIME: randomInt(640, 1880),
            ELAPSED_CPU_TIME: randomInt(50, 160),
            THREAD_COUNT: 1,
            TEMPORARY_STORAGE: randomInt(96, 150),
            TOTAL_DISK_IO_COUNT: randomInt(900, 1800),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(10, 28),
            MESSAGE_REPLY: 'YES',
            SQL_STATEMENT_TEXT: 'call media.await_tape_confirmation(?)',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 210_000, 420_000)
        }),
        createDemoJob({
            JOB_NAME: '780114/SHIPUSR/SHIPPICK',
            JOB_NAME_SHORT: 'SHIPPICK',
            JOB_NUMBER: '780114',
            JOB_USER: 'SHIPUSR',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/SHIPPICK',
            CURRENT_USER: 'SHIPUSR',
            FUNCTION_NAME: 'Wave picking release',
            STATUS: 'RUN',
            CPU: randomFloat(19, 36),
            CPU_TIME: randomInt(4200, 7600),
            ELAPSED_CPU_TIME: randomInt(3400, 6400),
            THREAD_COUNT: 4,
            TEMPORARY_STORAGE: randomInt(310, 520),
            TOTAL_DISK_IO_COUNT: randomInt(44200, 62500),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(230, 460),
            SQL_STATEMENT_TEXT: 'update warehouse.pick_wave set released = 1 where release_group = ?',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 50_000, 170_000)
        }),
        createDemoJob({
            JOB_NAME: '800222/ARUSR/ARLOCK2',
            JOB_NAME_SHORT: 'ARLOCK2',
            JOB_NUMBER: '800222',
            JOB_USER: 'ARUSR',
            SUBSYSTEM: 'QBATCH',
            SUBSYSTEM_JOB: 'QBATCH/ARLOCK2',
            CURRENT_USER: 'ARUSR',
            FUNCTION_NAME: 'Customer aging rebuild lock wait',
            STATUS: 'LCKW',
            CPU: randomFloat(0.1, 0.6),
            CPU_TIME: randomInt(1800, 4400),
            ELAPSED_CPU_TIME: randomInt(90, 220),
            THREAD_COUNT: 2,
            TEMPORARY_STORAGE: randomInt(200, 360),
            TOTAL_DISK_IO_COUNT: randomInt(16100, 24100),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(88, 140),
            DATABASE_LOCK_WAITS: randomInt(2, 5),
            DATABASE_LOCK_WAIT_TIME: randomInt(3200, 8400),
            SQL_STATEMENT_TEXT: 'update finance.customer_aging set age_bucket = ? where account_id = ?',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 180_000, 360_000)
        }),
        createDemoJob({
            JOB_NAME: '820115/PRINTUSR/PRTQWAIT',
            JOB_NAME_SHORT: 'PRTQWAIT',
            JOB_NUMBER: '820115',
            JOB_USER: 'PRINTUSR',
            SUBSYSTEM: 'QSPL',
            SUBSYSTEM_JOB: 'QSPL/PRTQWAIT',
            CURRENT_USER: 'PRINTUSR',
            FUNCTION_NAME: 'Waiting on printer queue availability',
            STATUS: 'DEQW',
            CPU: randomFloat(0, 0.3),
            CPU_TIME: randomInt(300, 880),
            ELAPSED_CPU_TIME: randomInt(110, 240),
            THREAD_COUNT: 1,
            TEMPORARY_STORAGE: randomInt(60, 140),
            TOTAL_DISK_IO_COUNT: randomInt(300, 980),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(6, 24),
            SQL_STATEMENT_TEXT: 'call qsys2.wait_for_printer_queue(?)',
            SQL_STATEMENT_STATUS: 'WAITING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 110_000, 260_000)
        }),
        createDemoJob({
            JOB_NAME: '842001/MFGUSR/MRPRUN',
            JOB_NAME_SHORT: 'MRPRUN',
            JOB_NUMBER: '842001',
            JOB_USER: 'MFGUSR',
            SUBSYSTEM: 'QUSRWRK',
            SUBSYSTEM_JOB: 'QUSRWRK/MRPRUN',
            CURRENT_USER: 'MFGUSR',
            FUNCTION_NAME: 'Material requirements planning',
            STATUS: 'RUN',
            CPU: randomFloat(42, 68),
            CPU_TIME: randomInt(8200, 13800),
            ELAPSED_CPU_TIME: randomInt(7100, 12000),
            THREAD_COUNT: 6,
            TEMPORARY_STORAGE: randomInt(920, 1480),
            TOTAL_DISK_IO_COUNT: randomInt(128000, 186000),
            ELAPSED_TOTAL_DISK_IO_COUNT: randomInt(620, 980),
            SQL_STATEMENT_TEXT: 'call planning.run_mrp_snapshot(?)',
            SQL_STATEMENT_STATUS: 'RUNNING',
            SQL_STATEMENT_START_TIMESTAMP: offsetIso(now, 120_000, 320_000)
        })
    ];

    const visibleGrowthCount = Math.min(growthJobs.length, Math.max(0, pollCount - 1));
    return growthJobs.slice(0, visibleGrowthCount);
}

export function buildDemoSnapshot(pollCount: number): DemoSnapshotFile {
    const now = buildDemoGeneratedAt(pollCount);
    const data = [
        ...buildPersistentIncidentJobs(now),
        ...buildRunningJobs(now),
        ...buildCumulativeGrowthJobs(now, pollCount)
    ];

    return {
        generatedAt: now.toISOString(),
        pollCount,
        data
    };
}

export async function writeDemoSnapshot(filePath: string, pollCount: number) {
    const snapshot = buildDemoSnapshot(pollCount);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return snapshot;
}

export async function readDemoSnapshot(filePath: string): Promise<QueryResult<ActiveJobRecord>> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DemoSnapshotFile>;

    return {
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
        pollCount: typeof parsed.pollCount === 'number' ? parsed.pollCount : undefined,
        data: Array.isArray(parsed.data) ? parsed.data : []
    } as DemoQueryResult;
}
