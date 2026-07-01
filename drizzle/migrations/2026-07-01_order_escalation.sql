-- Add escalation fields to orders table.
-- escalated_at: when a staff member flagged the order for superadmin review (null = not escalated).
-- escalation_note: required context note written by the staff member at time of escalation.
ALTER TABLE orders
  ADD COLUMN escalated_at TIMESTAMPTZ,
  ADD COLUMN escalation_note TEXT;
