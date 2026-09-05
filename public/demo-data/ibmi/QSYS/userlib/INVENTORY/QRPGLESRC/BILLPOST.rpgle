**free
ctl-opt dftactgrp(*no);
dcl-f ORDHDR keyed usage(*input) extfile('ORDERLIB/ORDHDR');
dcl-f INVOICE keyed usage(*update);
chain orderId ORDHDR;
write INVOICE;
DTAQ(INVOICEQ);
