-- Chunk 5: the age of a lead, in whole years. Optional; existing leads have none.
ALTER TABLE "leads" ADD COLUMN "age" smallint;
ALTER TABLE "leads" ADD CONSTRAINT "chk_leads_age" CHECK (age IS NULL OR age BETWEEN 1 AND 120);
