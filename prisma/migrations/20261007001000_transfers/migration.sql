-- Stage 4 migration 10 (module 4.5, inter-branch transfers): what the sender asked for, what was damaged, the serial number
-- shown on a line to both branches, a note on every step, and the one cross-branch stock write that dispatch needs.

ALTER TABLE "transfer_events" ADD COLUMN "note" text;
ALTER TABLE "transfer_events" ADD CONSTRAINT "chk_transfer_events_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300);

ALTER TABLE "transfer_lines" ADD COLUMN "qty_requested" integer;
UPDATE "transfer_lines" SET qty_requested = qty_sent;
ALTER TABLE "transfer_lines" ALTER COLUMN "qty_requested" SET NOT NULL;
ALTER TABLE "transfer_lines" ADD COLUMN "qty_damaged" integer NOT NULL DEFAULT 0;
-- The serial number is copied onto the line so that both branches can read it, whichever branch the unit is in.
ALTER TABLE "transfer_lines" ADD COLUMN "serial_no" text;

ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_qty_requested_positive" CHECK (qty_requested > 0);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_sent_within_requested" CHECK (qty_sent <= qty_requested);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_received_within_sent" CHECK (qty_received <= qty_sent);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_damaged_within_received" CHECK (qty_damaged >= 0 AND qty_damaged <= qty_received);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_serial_pair" CHECK ((serial_unit_id IS NULL) = (serial_no IS NULL));
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_serial_is_one" CHECK (serial_unit_id IS NULL OR (qty_requested = 1 AND qty_sent = 1));

-- Stock is held by branch, and a branch user cannot write another branch's rows. Dispatch takes the goods off the sender's
-- shelf (the application does that as the sender) and this function puts them "in transit" at the destination. It takes
-- only a transfer line, reads everything else from it, and refuses unless the transfer is being dispatched by someone
-- who may act for the sending branch, so it cannot be used to change any other stock.
CREATE FUNCTION transfer_arrive_in_transit(p_line_id uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l transfer_lines%ROWTYPE;
  t transfers%ROWTYPE;
BEGIN
  SELECT * INTO l FROM transfer_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The transfer line does not exist'; END IF;
  SELECT * INTO t FROM transfers WHERE id = l.transfer_id;
  IF t.status <> 'DISPATCHED' THEN RAISE EXCEPTION 'The transfer is not being dispatched'; END IF;
  IF NOT app_branch_allowed(t.from_branch_id) THEN RAISE EXCEPTION 'Only the sending branch may dispatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM stock_ledger
    WHERE source_doc_id = l.id AND source_doc_type = 'TRANSFER_LINE' AND branch_id = t.to_branch_id
  ) THEN RAISE EXCEPTION 'This line has already been dispatched'; END IF;

  IF l.serial_unit_id IS NOT NULL THEN
    UPDATE serial_units SET branch_id = t.to_branch_id, state = 'IN_TRANSIT'
    WHERE id = l.serial_unit_id AND branch_id = t.from_branch_id AND state = 'AVAILABLE';
    IF NOT FOUND THEN RAISE EXCEPTION 'The serial unit is not available in the sending branch'; END IF;
  END IF;

  INSERT INTO stock_balances (branch_id, item_id, state, quantity)
  VALUES (t.to_branch_id, l.item_id, 'IN_TRANSIT', 0)
  ON CONFLICT (branch_id, item_id, state) DO NOTHING;
  UPDATE stock_balances SET quantity = quantity + l.qty_sent
  WHERE branch_id = t.to_branch_id AND item_id = l.item_id AND state = 'IN_TRANSIT';

  INSERT INTO stock_ledger (branch_id, item_id, serial_unit_id, state, qty_delta, movement_type, source_doc_id, source_doc_type, created_by)
  VALUES (t.to_branch_id, l.item_id, l.serial_unit_id, 'IN_TRANSIT', l.qty_sent, 'TRANSFER_DISPATCH', l.id, 'TRANSFER_LINE', p_user);
END $$;

REVOKE ALL ON FUNCTION transfer_arrive_in_transit(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_arrive_in_transit(uuid, uuid) TO erp_app;
