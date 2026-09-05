**free
ctl-opt nomain;
dcl-proc pricingCalc export;
  exec sql select TAX_RATE into :taxRate from QSYS2.SYSTEM_VALUE_INFO;
  return orderAmount * taxRate;
end-proc;
