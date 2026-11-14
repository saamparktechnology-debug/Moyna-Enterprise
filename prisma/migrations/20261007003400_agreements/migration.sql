-- Chunk 10 (HR): employee agreements. A template holds editable terms and rules. An agreement is made for one employee from
-- a template (or written from scratch) and edited while it is a draft. It is printed with the employee's signature on the
-- left and the Super Admin's on the right; once both have signed, the signed copy is uploaded as the acceptance and the
-- agreement is frozen.

CREATE TABLE "agreement_templates" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "body" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "agreement_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_agreement_templates_name" CHECK (btrim(name) <> ''),
  CONSTRAINT "chk_agreement_templates_body" CHECK (btrim(body) <> '')
);
CREATE UNIQUE INDEX "agreement_templates_name_key" ON "agreement_templates" (lower(name));
CREATE TRIGGER "agreement_templates_row_version" BEFORE UPDATE ON "agreement_templates" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

CREATE TABLE "staff_agreements" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "template_id" uuid,
  "agreement_no" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "effective_from" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "rendered_body" text,
  "signed_on" date,
  "signed_object_key" text,
  "signed_file_name" text,
  "signed_mime_type" text,
  "signed_size_bytes" integer,
  "employee_signed" boolean NOT NULL DEFAULT false,
  "admin_signed" boolean NOT NULL DEFAULT false,
  "recorded_by" uuid,
  "ended_on" date,
  "end_reason" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "staff_agreements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_agreements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_agreements_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_agreements_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "agreement_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "chk_staff_agreements_status" CHECK (status IN ('DRAFT', 'SIGNED', 'ENDED', 'DISCARDED')),
  CONSTRAINT "chk_staff_agreements_text" CHECK (btrim(title) <> '' AND btrim(body) <> ''),
  CONSTRAINT "chk_staff_agreements_signed" CHECK (
    status NOT IN ('SIGNED', 'ENDED') OR (
      rendered_body IS NOT NULL AND signed_on IS NOT NULL AND signed_object_key IS NOT NULL
      AND signed_file_name IS NOT NULL AND signed_mime_type IS NOT NULL AND signed_size_bytes IS NOT NULL
      AND employee_signed AND admin_signed
    )
  ),
  CONSTRAINT "chk_staff_agreements_ended" CHECK (
    (status = 'ENDED' AND ended_on IS NOT NULL AND end_reason IS NOT NULL)
    OR (status = 'DISCARDED' AND end_reason IS NOT NULL)
    OR status IN ('DRAFT', 'SIGNED')
  )
);
CREATE UNIQUE INDEX "staff_agreements_branch_id_agreement_no_key" ON "staff_agreements" ("branch_id", "agreement_no");
CREATE UNIQUE INDEX "staff_agreements_signed_object_key_key" ON "staff_agreements" ("signed_object_key") WHERE signed_object_key IS NOT NULL;
-- A person has at most one agreement in force at a time.
CREATE UNIQUE INDEX "staff_agreements_one_signed_key" ON "staff_agreements" ("staff_id") WHERE status = 'SIGNED';
CREATE INDEX "staff_agreements_staff_id_idx" ON "staff_agreements" ("staff_id");
CREATE INDEX "staff_agreements_template_id_idx" ON "staff_agreements" ("template_id");

-- A signed agreement is a record of what was agreed: only its ending can be written afterwards. A discarded one never changes.
CREATE FUNCTION staff_agreements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DISCARDED' OR OLD.status = 'ENDED' THEN
    RAISE EXCEPTION 'An agreement that is % cannot be changed', lower(OLD.status) USING ERRCODE = '23514';
  END IF;
  IF NEW.staff_id <> OLD.staff_id OR NEW.branch_id <> OLD.branch_id OR NEW.agreement_no <> OLD.agreement_no THEN
    RAISE EXCEPTION 'An agreement keeps its person and its number' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'SIGNED' THEN
    IF NEW.status <> 'ENDED' THEN
      RAISE EXCEPTION 'A signed agreement can only be ended' USING ERRCODE = '23514';
    END IF;
    IF NEW.title <> OLD.title OR NEW.body <> OLD.body OR NEW.rendered_body IS DISTINCT FROM OLD.rendered_body
       OR NEW.effective_from <> OLD.effective_from OR NEW.signed_on IS DISTINCT FROM OLD.signed_on
       OR NEW.signed_object_key IS DISTINCT FROM OLD.signed_object_key THEN
      RAISE EXCEPTION 'A signed agreement cannot be changed, only ended' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'ENDED' THEN
    RAISE EXCEPTION 'An agreement must be signed before it can end' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_agreements_guard" BEFORE UPDATE ON "staff_agreements" FOR EACH ROW EXECUTE FUNCTION staff_agreements_guard();
CREATE TRIGGER "staff_agreements_row_version" BEFORE UPDATE ON "staff_agreements" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

ALTER TABLE "staff_agreements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_agreements_branch_scope" ON "staff_agreements" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
