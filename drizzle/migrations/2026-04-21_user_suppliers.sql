CREATE TABLE IF NOT EXISTS user_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_suppliers_user_supplier_unique
  ON user_suppliers(user_id, supplier_id);
CREATE INDEX IF NOT EXISTS user_suppliers_user_id_idx
  ON user_suppliers(user_id);
CREATE INDEX IF NOT EXISTS user_suppliers_supplier_id_idx
  ON user_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS user_suppliers_linked_by_user_id_idx
  ON user_suppliers(linked_by_user_id);
CREATE INDEX IF NOT EXISTS user_suppliers_created_at_idx
  ON user_suppliers(created_at);
