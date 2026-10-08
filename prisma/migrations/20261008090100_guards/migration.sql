-- Immutable records and the approved-content lock, enforced by the database itself.
-- Messages are matched by the application (lib/domain/srs/core.ts lockedError) and the tests.

CREATE FUNCTION "srs_reject"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END
$$;

CREATE FUNCTION "srs_reject_delete_with_document"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SrsDocument" WHERE "id" = OLD."documentId") THEN
    RAISE EXCEPTION '%', TG_ARGV[0];
  END IF;
  RETURN OLD;
END
$$;

CREATE FUNCTION "srs_reject_delete_with_item"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SrsItem" WHERE "id" = OLD."itemId") THEN
    RAISE EXCEPTION '%', TG_ARGV[0];
  END IF;
  RETURN OLD;
END
$$;

CREATE FUNCTION "srs_document_locked"(doc_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT COALESCE((SELECT "status" IN ('approval_pending', 'approved', 'superseded', 'archived') FROM "SrsDocument" WHERE "id" = doc_id), FALSE)
$$;

CREATE FUNCTION "srs_lock_by_document"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF "srs_document_locked"(CASE WHEN TG_OP = 'DELETE' THEN OLD."documentId" ELSE NEW."documentId" END) THEN
    RAISE EXCEPTION 'SRS is locked: start a revision to change approved content';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "srs_lock_by_item"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF "srs_document_locked"((SELECT "documentId" FROM "SrsItem" WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."itemId" ELSE NEW."itemId" END)) THEN
    RAISE EXCEPTION 'SRS is locked: start a revision to change approved content';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "srs_template_version_immutable" BEFORE UPDATE OF "config", "version", "templateId" ON "SrsTemplateVersion"
FOR EACH ROW EXECUTE FUNCTION "srs_reject"('SRS template versions are immutable');

CREATE TRIGGER "srs_version_immutable" BEFORE UPDATE OF "snapshot", "hash", "label", "seq", "documentId", "kind" ON "SrsVersion"
FOR EACH ROW EXECUTE FUNCTION "srs_reject"('SRS versions are immutable');

CREATE TRIGGER "srs_version_status" BEFORE UPDATE OF "status" ON "SrsVersion"
FOR EACH ROW WHEN ((OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'superseded')) OR (OLD."status" = 'superseded' AND NEW."status" <> 'superseded') OR (OLD."status" = 'rejected' AND NEW."status" <> 'rejected'))
EXECUTE FUNCTION "srs_reject"('An approved SRS version can only be superseded');

CREATE TRIGGER "srs_version_no_delete" BEFORE DELETE ON "SrsVersion"
FOR EACH ROW EXECUTE FUNCTION "srs_reject_delete_with_document"('SRS versions are never deleted');

CREATE TRIGGER "srs_signature_immutable" BEFORE UPDATE ON "SrsSignature"
FOR EACH ROW EXECUTE FUNCTION "srs_reject"('Signatures are immutable');

CREATE TRIGGER "srs_signature_no_delete" BEFORE DELETE ON "SrsSignature"
FOR EACH ROW EXECUTE FUNCTION "srs_reject_delete_with_document"('Signatures are never deleted');

CREATE TRIGGER "srs_artifact_immutable" BEFORE UPDATE ON "SrsArtifact"
FOR EACH ROW EXECUTE FUNCTION "srs_reject"('Generated SRS artifacts are immutable');

CREATE TRIGGER "srs_artifact_no_delete" BEFORE DELETE ON "SrsArtifact"
FOR EACH ROW EXECUTE FUNCTION "srs_reject_delete_with_document"('Generated SRS artifacts are never deleted');

CREATE TRIGGER "srs_item_revision_immutable" BEFORE UPDATE ON "SrsItemRevision"
FOR EACH ROW EXECUTE FUNCTION "srs_reject"('Requirement revisions are immutable');

CREATE TRIGGER "srs_item_revision_no_delete" BEFORE DELETE ON "SrsItemRevision"
FOR EACH ROW EXECUTE FUNCTION "srs_reject_delete_with_item"('Requirement revisions are never deleted');

CREATE TRIGGER "srs_document_lock" BEFORE UPDATE OF "overrides", "nfrNotApplicable", "title", "templateVersionId", "projectType" ON "SrsDocument"
FOR EACH ROW WHEN (OLD."status" IN ('approval_pending', 'approved', 'superseded', 'archived'))
EXECUTE FUNCTION "srs_reject"('SRS is locked: start a revision to change approved content');

CREATE TRIGGER "srs_item_lock_insert" BEFORE INSERT ON "SrsItem" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();
CREATE TRIGGER "srs_item_lock_update" BEFORE UPDATE OF "title", "description", "data", "origin", "priority", "visibility", "kind", "key" ON "SrsItem" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();
CREATE TRIGGER "srs_item_lock_delete" BEFORE DELETE ON "SrsItem" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();

CREATE TRIGGER "srs_section_lock_insert" BEFORE INSERT ON "SrsSection" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();
CREATE TRIGGER "srs_section_lock_update" BEFORE UPDATE OF "content", "title", "applicable", "naReason", "origin", "visibility", "required", "sort" ON "SrsSection" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();

CREATE TRIGGER "srs_answer_lock_insert" BEFORE INSERT ON "SrsAnswer" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();
CREATE TRIGGER "srs_answer_lock_update" BEFORE UPDATE OF "value", "origin" ON "SrsAnswer" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_document"();

CREATE TRIGGER "srs_criterion_lock_insert" BEFORE INSERT ON "SrsCriterion" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_item"();
CREATE TRIGGER "srs_criterion_lock_update" BEFORE UPDATE OF "given", "whenText", "thenText" ON "SrsCriterion" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_item"();
CREATE TRIGGER "srs_criterion_lock_delete" BEFORE DELETE ON "SrsCriterion" FOR EACH ROW EXECUTE FUNCTION "srs_lock_by_item"();

-- Supabase exposes this schema through its Data API. Row-level security with no policies blocks the
-- anon and authenticated roles entirely; the application connects as the table owner and is unaffected.
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
