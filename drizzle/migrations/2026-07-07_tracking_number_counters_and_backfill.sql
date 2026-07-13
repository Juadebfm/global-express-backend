CREATE TABLE IF NOT EXISTS tracking_number_counters (
  tracking_date_key text PRIMARY KEY,
  last_value integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracking_number_counters_date_key_check CHECK (tracking_date_key ~ '^[0-9]{8}$'),
  CONSTRAINT tracking_number_counters_last_value_check CHECK (last_value >= 0 AND last_value <= 9999)
);

CREATE TEMP TABLE tmp_tracking_assignments AS
WITH existing_sequences AS (
  SELECT date_key, MAX(sequence_no) AS max_sequence
  FROM (
    SELECT split_part(tracking_number, '-', 1) AS date_key, split_part(tracking_number, '-', 2)::integer AS sequence_no
    FROM orders
    WHERE tracking_number ~ '^[0-9]{8}-[0-9]{4}$'

    UNION ALL

    SELECT split_part(tracking_number, '-', 1) AS date_key, split_part(tracking_number, '-', 2)::integer AS sequence_no
    FROM gallery_items
    WHERE tracking_number ~ '^[0-9]{8}-[0-9]{4}$'

    UNION ALL

    SELECT split_part(primary_tracking_number, '-', 1) AS date_key, split_part(primary_tracking_number, '-', 2)::integer AS sequence_no
    FROM batch_customer_slots
    WHERE primary_tracking_number ~ '^[0-9]{8}-[0-9]{4}$'
  ) seeded
  GROUP BY date_key
),
entities_to_backfill AS (
  SELECT
    'orders'::text AS entity_type,
    id::text AS entity_id,
    to_char(created_at, 'YYYYMMDD') AS date_key,
    created_at AS created_at_value
  FROM orders
  WHERE tracking_number !~ '^[0-9]{8}-[0-9]{4}$'

  UNION ALL

  SELECT
    'gallery_items'::text AS entity_type,
    id::text AS entity_id,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDD') AS date_key,
    created_at AT TIME ZONE 'UTC' AS created_at_value
  FROM gallery_items
  WHERE tracking_number !~ '^[0-9]{8}-[0-9]{4}$'

  UNION ALL

  SELECT
    'batch_customer_slots'::text AS entity_type,
    id::text AS entity_id,
    to_char(created_at, 'YYYYMMDD') AS date_key,
    created_at AS created_at_value
  FROM batch_customer_slots
  WHERE primary_tracking_number !~ '^[0-9]{8}-[0-9]{4}$'
),
assigned_sequences AS (
  SELECT
    entities_to_backfill.entity_type,
    entities_to_backfill.entity_id,
    entities_to_backfill.date_key,
    COALESCE(existing_sequences.max_sequence, 0)
      + ROW_NUMBER() OVER (
        PARTITION BY entities_to_backfill.date_key
        ORDER BY entities_to_backfill.created_at_value, entities_to_backfill.entity_type, entities_to_backfill.entity_id
      ) AS next_sequence
  FROM entities_to_backfill
  LEFT JOIN existing_sequences
    ON existing_sequences.date_key = entities_to_backfill.date_key
)
SELECT
  entity_type,
  entity_id,
  date_key,
  next_sequence
FROM assigned_sequences;

UPDATE orders
SET tracking_number = tmp_tracking_assignments.date_key || '-' || lpad(tmp_tracking_assignments.next_sequence::text, 4, '0')
FROM tmp_tracking_assignments
WHERE tmp_tracking_assignments.entity_type = 'orders'
  AND orders.id::text = tmp_tracking_assignments.entity_id;

UPDATE gallery_items
SET tracking_number = tmp_tracking_assignments.date_key || '-' || lpad(tmp_tracking_assignments.next_sequence::text, 4, '0')
FROM tmp_tracking_assignments
WHERE tmp_tracking_assignments.entity_type = 'gallery_items'
  AND gallery_items.id::text = tmp_tracking_assignments.entity_id;

UPDATE batch_customer_slots
SET primary_tracking_number = tmp_tracking_assignments.date_key || '-' || lpad(tmp_tracking_assignments.next_sequence::text, 4, '0')
FROM tmp_tracking_assignments
WHERE tmp_tracking_assignments.entity_type = 'batch_customer_slots'
  AND batch_customer_slots.id::text = tmp_tracking_assignments.entity_id;

DROP TABLE tmp_tracking_assignments;

INSERT INTO tracking_number_counters (tracking_date_key, last_value)
SELECT
  date_key,
  MAX(sequence_no) AS last_value
FROM (
  SELECT split_part(tracking_number, '-', 1) AS date_key, split_part(tracking_number, '-', 2)::integer AS sequence_no
  FROM orders
  WHERE tracking_number ~ '^[0-9]{8}-[0-9]{4}$'

  UNION ALL

  SELECT split_part(tracking_number, '-', 1) AS date_key, split_part(tracking_number, '-', 2)::integer AS sequence_no
  FROM gallery_items
  WHERE tracking_number ~ '^[0-9]{8}-[0-9]{4}$'

  UNION ALL

  SELECT split_part(primary_tracking_number, '-', 1) AS date_key, split_part(primary_tracking_number, '-', 2)::integer AS sequence_no
  FROM batch_customer_slots
  WHERE primary_tracking_number ~ '^[0-9]{8}-[0-9]{4}$'
) all_sequences
GROUP BY date_key
ON CONFLICT (tracking_date_key) DO UPDATE
SET
  last_value = GREATEST(tracking_number_counters.last_value, EXCLUDED.last_value),
  updated_at = now();
