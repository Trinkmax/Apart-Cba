-- ════════════════════════════════════════════════════════════════════════════
-- Inventario — audit log de movimientos + trigger para mantener stock
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  amenity_id uuid NOT NULL REFERENCES apartcba.amenities(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('restock','consume','adjust','initial')),
  quantity_delta integer NOT NULL,
  quantity_after smallint,
  performed_by uuid REFERENCES auth.users(id),
  notes text,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_org_at
  ON apartcba.inventory_movements(organization_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_unit
  ON apartcba.inventory_movements(unit_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_amenity
  ON apartcba.inventory_movements(amenity_id, performed_at DESC);

ALTER TABLE apartcba.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_all ON apartcba.inventory_movements;
CREATE POLICY members_all ON apartcba.inventory_movements
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM apartcba.organization_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM apartcba.organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION apartcba.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
DECLARE
  v_new_qty smallint;
  v_default_par smallint;
BEGIN
  SELECT default_par_level INTO v_default_par
    FROM apartcba.amenities
    WHERE id = NEW.amenity_id;

  INSERT INTO apartcba.unit_amenities (unit_id, amenity_id, current_quantity, par_level, last_restocked_at)
  VALUES (
    NEW.unit_id,
    NEW.amenity_id,
    GREATEST(0, NEW.quantity_delta)::smallint,
    v_default_par,
    CASE WHEN NEW.movement_type IN ('restock','initial') THEN NEW.performed_at ELSE NULL END
  )
  ON CONFLICT (unit_id, amenity_id) DO UPDATE
    SET current_quantity = GREATEST(0, apartcba.unit_amenities.current_quantity + NEW.quantity_delta)::smallint,
        last_restocked_at = CASE
          WHEN NEW.movement_type IN ('restock','initial') THEN NEW.performed_at
          ELSE apartcba.unit_amenities.last_restocked_at
        END
  RETURNING current_quantity INTO v_new_qty;

  NEW.quantity_after := v_new_qty;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON apartcba.inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
  BEFORE INSERT ON apartcba.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION apartcba.apply_inventory_movement();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.inventory_movements;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.unit_amenities;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END$$;
