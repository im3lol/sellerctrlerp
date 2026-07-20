DROP INDEX "stock_movements_item_wh_idx";--> statement-breakpoint
CREATE INDEX "delivery_note_lines_dn_idx" ON "delivery_note_lines" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE INDEX "delivery_note_lines_item_idx" ON "delivery_note_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "delivery_notes_order_idx" ON "delivery_notes" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "expense_claim_lines_claim_idx" ON "expense_claim_lines" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_entry_idx" ON "journal_entry_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "material_request_lines_req_idx" ON "material_request_lines" USING btree ("material_request_id");--> statement-breakpoint
CREATE INDEX "payment_lines_voucher_idx" ON "payment_lines" USING btree ("payment_voucher_id");--> statement-breakpoint
CREATE INDEX "payment_lines_invoice_idx" ON "payment_lines" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "pick_list_lines_list_idx" ON "pick_list_lines" USING btree ("pick_list_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_inv_idx" ON "purchase_invoice_lines" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_item_idx" ON "purchase_invoice_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_org_status_date_idx" ON "purchase_invoices" USING btree ("organization_id","status","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_invoices_org_status_due_idx" ON "purchase_invoices" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_idx" ON "purchase_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_order_idx" ON "purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_item_idx" ON "purchase_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_grn_idx" ON "purchase_receipt_lines" USING btree ("purchase_receipt_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_item_idx" ON "purchase_receipt_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "purchase_return_lines_ret_idx" ON "purchase_return_lines" USING btree ("purchase_return_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_invoice_idx" ON "purchase_returns" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_receipt_idx" ON "purchase_returns" USING btree ("purchase_receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_lines_voucher_idx" ON "receipt_lines" USING btree ("receipt_voucher_id");--> statement-breakpoint
CREATE INDEX "receipt_lines_invoice_idx" ON "receipt_lines" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "recurring_journal_lines_tpl_idx" ON "recurring_journal_lines" USING btree ("recurring_journal_id");--> statement-breakpoint
CREATE INDEX "recurring_sales_invoice_lines_tpl_idx" ON "recurring_sales_invoice_lines" USING btree ("recurring_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_inv_idx" ON "sales_invoice_lines" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_item_idx" ON "sales_invoice_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_org_status_date_idx" ON "sales_invoices" USING btree ("organization_id","status","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_invoices_org_status_due_idx" ON "sales_invoices" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "sales_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_order_idx" ON "sales_order_lines" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_item_idx" ON "sales_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "sales_quotation_lines_qt_idx" ON "sales_quotation_lines" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "sales_return_lines_ret_idx" ON "sales_return_lines" USING btree ("sales_return_id");--> statement-breakpoint
CREATE INDEX "sales_returns_invoice_idx" ON "sales_returns" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "sales_returns_delivery_idx" ON "sales_returns" USING btree ("delivery_note_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_lines_adj_idx" ON "stock_adjustment_lines" USING btree ("stock_adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" USING btree ("stock_transfer_id");