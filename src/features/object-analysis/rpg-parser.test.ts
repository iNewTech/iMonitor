import { describe, expect, it } from 'vitest';
import { parseRpgSource } from './rpg-parser';

describe('RPG source dependency parser', () => {
    it('captures program, file, runtime, and conversion-sensitive references', () => {
        const result = parseRpgSource(`
            /copy ORDERLIB/QRPGLESRC/ORDCOPY
            dcl-f CUSTOMER keyed usage(*update);
            dcl-pr calculateTax extproc('PRICING_CALC');
            exec sql select * from ORDERLIB.CUSTOMER;
            chain customerId CUSTOMER;
            update ORDHDR;
            DTAQ(ORDERLIB/ORDERQ);
            DTAARA(ORDERLIB/ORDER_SWITCH);
            ENVVAR(ORDER_MODE);
            QCMDEXC('SBMJOB CMD(CALL PGM(INVENTORY/BILLPOST))');
            commit;
        `);

        expect(result.references).toEqual(expect.arrayContaining([
            expect.objectContaining({ targetName: 'ORDCOPY', relationship: 'includes' }),
            expect.objectContaining({ targetName: 'CUSTOMER', relationship: 'uses' }),
            expect.objectContaining({ targetName: 'ORDHDR', relationship: 'writes' }),
            expect.objectContaining({ targetName: 'ORDERQ', targetType: '*DTAQ' }),
            expect.objectContaining({ targetName: 'ORDER_SWITCH', targetType: '*DTAARA' }),
            expect.objectContaining({ targetName: 'ORDER_MODE', targetType: '*ENVVAR' }),
            expect.objectContaining({ targetName: 'BILLPOST', targetType: '*PGM', relationship: 'submits' })
        ]));
        expect(result.signals).toEqual(expect.arrayContaining([
            'Dynamic CL command execution was found.',
            'Commitment control or transaction boundaries were found.',
            'Data queues are used.',
            'Data areas are used.',
            'Environment variables are used.'
        ]));
    });
});
