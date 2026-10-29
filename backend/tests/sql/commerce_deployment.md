# Compras y ventas de varios productos

`20261027_commerce.proposed.sql` is an additive Supabase migration. It preserves existing products, sales, movements, prediction evidence, and inventory RPCs. It adds normalized supplier, purchase header/line, and sale header/line tables. Existing one-product sales remain visible in the Ventas list as historical records.

## Before applying

The installation chain is ordered by the preflights: `ventas.sql` creates `inventory_sales`, `inventory_sales_enabled()` and `inventory_register_sale()`; Fase 2 checks the exact definitions and permissions of that sales RPC and the existing write/catalog functions; Fase 3 requires Fase 2's `products.updated_at` and adds `inventory_register_stock()`; commerce requires both stock and sales RPCs. Do not skip or reorder these files.

1. Confirm the existing base schema is installed: `products`, `categories`, `inventory_members`, `inventory_movements`, `inventory_mutate(uuid,text,bigint,bigint,jsonb)`, and `inventory_write_enabled()`. Back up the database and verify the backup can be restored.
2. Apply `backend/tests/sql/ventas.sql` once. It creates the single-sale table and RPC; it needs the base schema above and denies client `CREATE` on `public`.
3. Apply `backend/tests/sql/20261013_catalog_products.proposed.sql` (Fase 2) once. Its digest preflight validates the original sales/write RPC definitions and ACLs.
4. Apply `backend/tests/sql/20261014_stock_movements.proposed.sql` (Fase 3) once. It adds the stock movement RPC and requires Fase 2's `products.updated_at`.
5. Apply `backend/tests/sql/20261027_commerce.proposed.sql` once. It adds commerce tables and links new sales to the existing sales history.
6. Run each complete file in the Supabase SQL Editor under the database owner, checking that each transaction commits before applying the next. Verify the commerce tables, `inventory_sales.sale_order_id`, RLS, and RPC grants. Refresh PostgREST's schema cache if needed.

The four SQL files above must be applied in that order after the stated base schema is present. Do not rerun a committed proposal: these additive scripts intentionally fail on schema drift or already-existing objects instead of masking differences with `IF NOT EXISTS`.

Until the migration is installed, the frontend displays the Supabase migration requirement and the existing inventory remains available. Never grant direct table writes to `anon` or `authenticated`; all writes go through the security-definer RPCs and the existing membership/write permission checks.

## Transaction behavior

- Creating a purchase or sale creates a pending header and immutable product/cost snapshots. Pending documents do not touch stock.
- Receiving a purchase calls the existing stock-entry RPC for every line in product-ID order, in the same PostgreSQL transaction. A replay of a received document returns its stored result without adding stock again.
- Confirming a sale calls the existing sale RPC for every line, in product-ID order, in the same transaction. It records each detail in `inventory_sales`, links it to the order, and uses the existing movement history. Any failed line rolls back the full confirmation.
- Cancelling a pending document does not change stock. A received purchase is immutable; this migration does not implement purchase reversals. Cancelling a confirmed sale creates stock-in reversal movements using per-line idempotency IDs. Processed documents cannot be edited.
- Reverted sale rows stay in the audit table with `cancelled_at` and remain linked to their original sale movement. The inventory API excludes those rows from sales totals and forecast inputs while preserving both the original sale and reversal in the Kardex.
- Concurrent stock changes are checked by the existing product version and row locks. Request IDs and document status prevent duplicate receipt, confirmation, or reversal.

The automated PGlite test is a synthetic isolated schema test. It does not connect to or alter the production Supabase project. A concurrent multi-session test and a staging Supabase deployment check are still required before production rollout.
