create table ORDERLIB.ORDHDR (
  ORDER_ID decimal(9, 0) not null primary key,
  CUSTOMER_ID decimal(9, 0) not null,
  ORDER_STATUS char(10) not null
);
