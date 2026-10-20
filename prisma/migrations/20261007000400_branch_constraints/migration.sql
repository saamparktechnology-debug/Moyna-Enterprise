-- Stage 3, module 3.2 (branches): integrity rules for branch master data.
-- Code: 2 to 4 capital letters or digits (it prefixes every document number, and GST limits those to 16 characters).
ALTER TABLE "branches" ADD CONSTRAINT "chk_branches_code_format" CHECK (code ~ '^[A-Z0-9]{2,4}$');
ALTER TABLE "branches" ADD CONSTRAINT "chk_branches_name_not_blank" CHECK (length(btrim(name)) > 0);
-- GSTIN: 15 characters in the official layout, and its first two digits are the branch's GST state code.
ALTER TABLE "branches" ADD CONSTRAINT "chk_branches_gstin_format" CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "branches" ADD CONSTRAINT "chk_branches_gstin_matches_state" CHECK (gstin IS NULL OR left(gstin, 2) = state_code);
