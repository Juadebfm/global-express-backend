-- Add general_inquiry to the inbound_lead_type enum for the public contact form
ALTER TYPE inbound_lead_type ADD VALUE IF NOT EXISTS 'general_inquiry';
