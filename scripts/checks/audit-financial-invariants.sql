\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT 'unbalanced_posted_journals' AS check_name, count(*) AS issues FROM (
 SELECT e.id FROM journal_entries e LEFT JOIN journal_entry_lines l ON l.journal_entry_id=e.id
 WHERE e.status='POSTED' GROUP BY e.id HAVING abs(coalesce(sum(l.debit-l.credit),0))>0.005
) x;
SELECT 'sales_invoice_header_arithmetic' AS check_name,count(*) AS issues FROM sales_invoices
 WHERE abs(total_amount-(subtotal-discount_amount+tax_amount+shipping_amount))>0.01;
SELECT 'purchase_invoice_header_arithmetic' AS check_name,count(*) AS issues FROM purchase_invoices
 WHERE abs(total_amount-(subtotal-discount_amount+tax_amount+shipping_amount))>0.01;
SELECT 'sales_order_header_discount_not_on_lines' AS check_name,count(*) AS issues FROM sales_orders o
 WHERE abs(o.discount_amount-coalesce((SELECT sum(l.discount_amount) FROM sales_order_lines l WHERE l.sales_order_id=o.id),0))>0.01;
SELECT 'sales_invoice_line_header_discount_mismatch' AS check_name,count(*) AS issues FROM sales_invoices o
 WHERE abs(o.discount_amount-coalesce((SELECT sum(l.discount_amount) FROM sales_invoice_lines l WHERE l.sales_invoice_id=o.id),0))>0.01;
SELECT 'sales_invoice_balance_formula' AS check_name,count(*) AS issues FROM sales_invoices i
 WHERE i.status IN ('POSTED','PARTIAL_PAID','PAID') AND abs(i.balance_due-(i.total_amount-i.paid_amount-coalesce((
 SELECT sum(r.total_amount) FROM sales_returns r WHERE r.sales_invoice_id=i.id AND r.status='POSTED' AND r.delivery_note_id IS NULL),0)))>0.01;
SELECT 'purchase_invoice_balance_formula' AS check_name,count(*) AS issues FROM purchase_invoices i
 WHERE i.status IN ('POSTED','PARTIAL_PAID','PAID') AND abs(i.balance_due-(i.total_amount-i.paid_amount-coalesce((
 SELECT sum(r.total_amount) FROM purchase_returns r WHERE r.purchase_invoice_id=i.id AND r.status='POSTED' AND r.purchase_receipt_id IS NULL),0)))>0.01;
WITH latest AS (
 SELECT DISTINCT ON(organization_id,item_id,warehouse_id) organization_id,item_id,warehouse_id,balance_quantity,balance_value
 FROM stock_movements ORDER BY organization_id,item_id,warehouse_id,created_at DESC,
 CASE WHEN split_part(number,'-',3) ~ '^[0-9]+$' THEN split_part(number,'-',3)::numeric ELSE 0 END DESC
)
SELECT 'negative_stock_balances' AS check_name,count(*) AS issues FROM latest WHERE balance_quantity < -0.0001 OR balance_value < -0.01;
WITH latest AS (
 SELECT DISTINCT ON(organization_id,item_id,warehouse_id) organization_id,balance_value
 FROM stock_movements ORDER BY organization_id,item_id,warehouse_id,created_at DESC,
 CASE WHEN split_part(number,'-',3) ~ '^[0-9]+$' THEN split_part(number,'-',3)::numeric ELSE 0 END DESC
), inventory AS (SELECT organization_id,sum(balance_value) value FROM latest GROUP BY organization_id),
 gl AS (
 SELECT a.organization_id,sum(l.debit-l.credit) value FROM accounts a
 LEFT JOIN accounting_configurations c ON c.organization_id=a.organization_id
 JOIN journal_entry_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.journal_entry_id AND e.status='POSTED'
 WHERE a.id=coalesce(c.inventory_account_id,(SELECT d.id FROM accounts d WHERE d.organization_id=a.organization_id AND d.code='1104' LIMIT 1)) GROUP BY a.organization_id
)
SELECT 'inventory_gl_vs_stock_organizations' AS check_name,count(*) AS issues FROM inventory i FULL JOIN gl g USING(organization_id)
 WHERE abs(coalesce(i.value,0)-coalesce(g.value,0))>0.05;
SELECT 'posted_sales_invoice_without_posting' AS check_name,count(*) AS issues FROM sales_invoices i WHERE i.status IN ('POSTED','PARTIAL_PAID','PAID')
 AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.organization_id=i.organization_id AND e.source_type='SALES_INVOICE' AND e.source_id=i.id AND e.status='POSTED');
SELECT 'posted_purchase_invoice_without_posting' AS check_name,count(*) AS issues FROM purchase_invoices i WHERE i.status IN ('POSTED','PARTIAL_PAID','PAID')
 AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.organization_id=i.organization_id AND e.source_type='PURCHASE_INVOICE' AND e.source_id=i.id AND e.status='POSTED');
ROLLBACK;
