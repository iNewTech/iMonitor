**free
ctl-opt nomain;
dcl-proc calculateTax export;
  return orderAmount * 0.18;
end-proc;
