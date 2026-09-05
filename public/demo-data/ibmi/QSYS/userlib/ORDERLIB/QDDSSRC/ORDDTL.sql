create table ORDERLIB.ORDDTL (
  ORDER_ID decimal(9, 0) not null,
  LINE_NUMBER decimal(5, 0) not null,
  ITEM_ID varchar(20) not null,
  QUANTITY decimal(9, 0) not null
);
