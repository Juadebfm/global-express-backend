BEGIN;

DO $$
BEGIN
  IF to_regclass('public.package_images') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'package_images'
        AND column_name = 'bulk_item_id'
    ) THEN
      DELETE FROM package_images
      WHERE order_id IS NULL
        AND bulk_item_id IS NOT NULL;

      ALTER TABLE package_images
        DROP COLUMN IF EXISTS bulk_item_id;
    END IF;
  END IF;

  IF to_regclass('public.order_packages') IS NOT NULL THEN
    ALTER TABLE order_packages
      DROP COLUMN IF EXISTS bulk_item_id;
  END IF;

  DROP TABLE IF EXISTS bulk_shipment_items;
  DROP TABLE IF EXISTS bulk_shipments;
END
$$;

COMMIT;
