BEGIN;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    UPDATE orders
    SET pricing_source = 'DEFAULT_RATE'
    WHERE pricing_source::text = 'MANUAL_ADJUSTMENT';

    ALTER TABLE orders
      DROP COLUMN IF EXISTS price_adjustment_reason;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_source') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_source_v2') THEN
      CREATE TYPE pricing_source_v2 AS ENUM ('DEFAULT_RATE', 'CUSTOMER_OVERRIDE', 'MIGRATED_UNVERIFIED');
    END IF;

    IF to_regclass('public.orders') IS NOT NULL THEN
      ALTER TABLE orders
      ALTER COLUMN pricing_source TYPE pricing_source_v2
      USING CASE
        WHEN pricing_source IS NULL THEN NULL
        ELSE pricing_source::text::pricing_source_v2
      END;
    END IF;

    DROP TYPE pricing_source;
    ALTER TYPE pricing_source_v2 RENAME TO pricing_source;
  END IF;
END
$$;

COMMIT;
