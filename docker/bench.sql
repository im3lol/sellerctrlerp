BEGIN;
INSERT INTO items (id, organization_id, code, name_ar, uom_id, is_active)
SELECT 'bench-'||g, '9f578857-faab-4953-9daf-25184c9dcb44', 'BENCH-'||g, 'صنف '||g, '', true FROM generate_series(1,5000) g;
INSERT INTO stock_movements (id, organization_id, number, item_id, warehouse_id, type, quantity, unit_cost, total_cost, balance_quantity, balance_value, date, created_at)
SELECT gen_random_uuid()::text, '9f578857-faab-4953-9daf-25184c9dcb44', 'SMB-'||g||'-'||s, 'bench-'||g, '676f0388-b24a-4364-aacf-3cb9b14e68a2', 'IN', 1, 1, 1, s, s, now(), now() - (s || ' seconds')::interval
FROM generate_series(1,5000) g, generate_series(1,10) s;
ANALYZE items; ANALYZE stock_movements;
