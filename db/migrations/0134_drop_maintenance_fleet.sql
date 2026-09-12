-- Drop the maintenance & fleet module.
--
-- It was built during the ERP-parity push and no tenant ever used it: all six tables
-- were empty when this ran. The product is an ERP for marketplace sellers — work
-- orders, fuel logs and driver trips are a different business.
--
-- Entitlements need no cleanup: no row in `plans` or `org_subscriptions` listed
-- 'maintenance' in enabled_modules, and no member carried a maintenance.* override.
-- Checked before writing this, rather than assumed.
--
-- Order matters: children before parents. work_order_parts references work_orders,
-- and asset_meter_readings and trips reference fixed_assets. CASCADE would do it in
-- one line but would also silently take anything that has grown a dependency on these
-- since — naming each table means a surprise raises an error instead of quietly
-- deleting something.

DROP TABLE IF EXISTS work_order_parts;
DROP TABLE IF EXISTS asset_meter_readings;
DROP TABLE IF EXISTS fuel_logs;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS work_orders;
DROP TABLE IF EXISTS maintenance_plans;
