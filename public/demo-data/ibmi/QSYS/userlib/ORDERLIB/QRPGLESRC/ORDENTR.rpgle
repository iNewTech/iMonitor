**free
ctl-opt dftactgrp(*no) actgrp('ORDERS');
/copy ORDERLIB/QRPGLESRC/ORDCOPY

dcl-f CUSTOMER keyed usage(*update);
dcl-f ORDHDR keyed usage(*update);
dcl-f ORDDTL keyed usage(*update);

dcl-pr calculateTax packed(9:2) extproc('PRICING_CALC');
  orderAmount packed(9:2);
end-pr;

// Validate the customer and create the order in one transaction.
exec sql
  select CREDIT_LIMIT into :creditLimit
    from ORDERLIB.CUSTOMER where CUSTOMER_ID = :customerId;

chain customerId CUSTOMER;
if not %found(CUSTOMER);
  return;
endif;

update ORDHDR;
write ORDDTL;
DTAQ(ORDERLIB/ORDERQ);
DTAARA(ORDERLIB/ORDER_SWITCH);
ENVVAR(ORDER_MODE);

// Queue the invoice post for the batch subsystem.
QCMDEXC('SBMJOB CMD(CALL PGM(INVENTORY/BILLPOST))');
commit;
