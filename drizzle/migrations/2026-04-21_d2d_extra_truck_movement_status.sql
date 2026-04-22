DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_status_v2'
      AND e.enumlabel = 'IN_EXTRA_TRUCK_MOVEMENT_LAGOS'
  ) THEN
    ALTER TYPE shipment_status_v2 ADD VALUE 'IN_EXTRA_TRUCK_MOVEMENT_LAGOS';
  END IF;
END $$;
