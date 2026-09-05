create table INVENTORY.INVOICE (
  INVOICE_ID decimal(9, 0) not null primary key,
  ORDER_ID decimal(9, 0) not null,
  POSTED_AT timestamp not null
);
