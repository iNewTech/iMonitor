create table ORDERLIB.CUSTOMER (
  CUSTOMER_ID decimal(9, 0) not null primary key,
  CREDIT_LIMIT decimal(11, 2) not null,
  ACTIVE char(1) not null
);
