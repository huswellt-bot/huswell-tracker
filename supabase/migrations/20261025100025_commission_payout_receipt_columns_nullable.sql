-- Commission payouts do not use receipt uploads. Keep the receipt fields
-- nullable at the table level while the Finance RPCs enforce receipts for
-- every workflow that still requires them.

begin;

alter table public.finance_transactions
  alter column receipt_storage_path drop not null,
  alter column receipt_file_name drop not null,
  alter column receipt_content_type drop not null,
  alter column receipt_file_size drop not null;

commit;
