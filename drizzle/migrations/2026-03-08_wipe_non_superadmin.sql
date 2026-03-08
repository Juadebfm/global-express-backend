-- Wipe all data and users except the superadmin (owner).
-- Order matters: delete child rows before parent rows to respect FK constraints.

-- 1. Notifications (reference orders + users)
DELETE FROM notification_reads;
DELETE FROM notifications;
DELETE FROM admin_notifications;

-- 2. Order-related children
DELETE FROM order_status_events;
DELETE FROM package_images;
DELETE FROM order_packages;

-- 3. Payments (reference orders + users)
DELETE FROM payments;

-- 4. Bulk shipments
DELETE FROM bulk_shipment_items;
DELETE FROM bulk_shipments;

-- 5. Support tickets
DELETE FROM support_messages;
DELETE FROM support_tickets;

-- 6. Orders (now safe — children removed)
DELETE FROM orders;

-- 7. Session / push / audit / OTPs
DELETE FROM revoked_tokens;
DELETE FROM push_subscriptions;
DELETE FROM audit_logs;
DELETE FROM password_reset_otps;

-- 8. Customer pricing overrides
DELETE FROM customer_pricing_overrides;

-- 9. Finally, delete all non-superadmin users
DELETE FROM users WHERE role != 'superadmin';
