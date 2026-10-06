-- CreateTable
CREATE TABLE "SrsTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SrsTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SrsTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "major" INTEGER NOT NULL DEFAULT 0,
    "minor" INTEGER NOT NULL DEFAULT 1,
    "clientAccess" BOOLEAN NOT NULL DEFAULT false,
    "overrides" TEXT NOT NULL DEFAULT '{}',
    "nfrNotApplicable" TEXT NOT NULL DEFAULT '{}',
    "confidentiality" TEXT NOT NULL DEFAULT 'Confidential',
    "approvedVersionId" TEXT,
    "revisionReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SrsDocument_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "SrsTemplateVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL DEFAULT '',
    "applicable" BOOLEAN NOT NULL DEFAULT true,
    "naReason" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'elec_proposal',
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsSection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'client_input',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsAnswer_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL DEFAULT 'elec_proposal',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" TEXT NOT NULL DEFAULT 'should',
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "ownerId" TEXT,
    "ownerName" TEXT NOT NULL DEFAULT '',
    "sourceKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "baselineVersionId" TEXT,
    "reapprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" DATETIME,
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsItemRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "requiresReapproval" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SrsItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsCriterion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "given" TEXT NOT NULL,
    "whenText" TEXT NOT NULL,
    "thenText" TEXT NOT NULL,
    "qaStatus" TEXT NOT NULL DEFAULT 'pending',
    "evidence" TEXT NOT NULL DEFAULT '',
    "verifiedByName" TEXT NOT NULL DEFAULT '',
    "verifiedAt" DATETIME,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsCriterion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SrsItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'document',
    "targetKey" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "status" TEXT NOT NULL DEFAULT 'open',
    "classification" TEXT,
    "mentions" TEXT NOT NULL DEFAULT '[]',
    "attachmentIds" TEXT NOT NULL DEFAULT '[]',
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "resolvedByName" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsComment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "changeRequestId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "approvedAt" DATETIME,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsSignature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerRole" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "drawing" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "snapshotHash" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsSignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SrsSignature_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SrsVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SrsDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SrsArtifact_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SrsVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SrsLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SrsItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scopeImpact" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedById" TEXT,
    "requesterName" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "affectsDueOn" TEXT,
    "decisionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "srsDocumentId" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'change_request',
    "affectedItemKeys" TEXT NOT NULL DEFAULT '[]',
    "timelineImpact" TEXT NOT NULL DEFAULT '',
    "effortImpact" TEXT NOT NULL DEFAULT '',
    "commercialImpact" TEXT NOT NULL DEFAULT '',
    "risks" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "srsVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ChangeRequest" ("affectsDueOn", "code", "createdAt", "currency", "customerVisible", "decisionNote", "estimatedCostCents", "estimatedMinutes", "id", "organizationId", "projectId", "reason", "requestedById", "requesterName", "scopeImpact", "status", "title", "updatedAt", "version") SELECT "affectsDueOn", "code", "createdAt", "currency", "customerVisible", "decisionNote", "estimatedCostCents", "estimatedMinutes", "id", "organizationId", "projectId", "reason", "requestedById", "requesterName", "scopeImpact", "status", "title", "updatedAt", "version" FROM "ChangeRequest";
DROP TABLE "ChangeRequest";
ALTER TABLE "new_ChangeRequest" RENAME TO "ChangeRequest";
CREATE INDEX "ChangeRequest_organizationId_status_idx" ON "ChangeRequest"("organizationId", "status");
CREATE UNIQUE INDEX "ChangeRequest_projectId_code_key" ON "ChangeRequest"("projectId", "code");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "objectives" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statusBeforeArchive" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
    "healthReasons" TEXT NOT NULL DEFAULT '[]',
    "managerId" TEXT,
    "startOn" TEXT,
    "dueOn" TEXT,
    "budgetCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "scopeBaselinedAt" DATETIME,
    "projectType" TEXT NOT NULL DEFAULT 'custom',
    "opportunityId" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("archivedAt", "budgetCents", "code", "createdAt", "currency", "customerId", "dueOn", "healthReasons", "healthScore", "healthStatus", "id", "managerId", "name", "objectives", "organizationId", "priority", "scope", "scopeBaselinedAt", "searchText", "startOn", "status", "statusBeforeArchive", "summary", "updatedAt", "version") SELECT "archivedAt", "budgetCents", "code", "createdAt", "currency", "customerId", "dueOn", "healthReasons", "healthScore", "healthStatus", "id", "managerId", "name", "objectives", "organizationId", "priority", "scope", "scopeBaselinedAt", "searchText", "startOn", "status", "statusBeforeArchive", "summary", "updatedAt", "version" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_opportunityId_key" ON "Project"("opportunityId");
CREATE INDEX "Project_organizationId_status_idx" ON "Project"("organizationId", "status");
CREATE INDEX "Project_customerId_status_idx" ON "Project"("customerId", "status");
CREATE INDEX "Project_managerId_idx" ON "Project"("managerId");
CREATE INDEX "Project_searchText_idx" ON "Project"("searchText");
CREATE UNIQUE INDEX "Project_organizationId_code_key" ON "Project"("organizationId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SrsTemplate_organizationId_projectType_idx" ON "SrsTemplate"("organizationId", "projectType");

-- CreateIndex
CREATE UNIQUE INDEX "SrsTemplate_organizationId_key_key" ON "SrsTemplate"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SrsTemplateVersion_templateId_version_key" ON "SrsTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "SrsDocument_organizationId_status_idx" ON "SrsDocument"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SrsDocument_projectId_ordinal_key" ON "SrsDocument"("projectId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "SrsDocument_organizationId_code_key" ON "SrsDocument"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SrsSection_documentId_key_key" ON "SrsSection"("documentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SrsAnswer_documentId_questionKey_key" ON "SrsAnswer"("documentId", "questionKey");

-- CreateIndex
CREATE INDEX "SrsItem_documentId_kind_sort_idx" ON "SrsItem"("documentId", "kind", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "SrsItem_documentId_key_key" ON "SrsItem"("documentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SrsItem_documentId_sourceKey_key" ON "SrsItem"("documentId", "sourceKey");

-- CreateIndex
CREATE INDEX "SrsItemRevision_itemId_revision_idx" ON "SrsItemRevision"("itemId", "revision");

-- CreateIndex
CREATE INDEX "SrsCriterion_itemId_sort_idx" ON "SrsCriterion"("itemId", "sort");

-- CreateIndex
CREATE INDEX "SrsComment_documentId_targetType_targetKey_idx" ON "SrsComment"("documentId", "targetType", "targetKey");

-- CreateIndex
CREATE INDEX "SrsComment_documentId_kind_status_idx" ON "SrsComment"("documentId", "kind", "status");

-- CreateIndex
CREATE INDEX "SrsVersion_documentId_status_idx" ON "SrsVersion"("documentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SrsVersion_documentId_seq_key" ON "SrsVersion"("documentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SrsSignature_versionId_signerId_key" ON "SrsSignature"("versionId", "signerId");

-- CreateIndex
CREATE UNIQUE INDEX "SrsArtifact_versionId_format_key" ON "SrsArtifact"("versionId", "format");

-- CreateIndex
CREATE INDEX "SrsLink_targetType_targetId_idx" ON "SrsLink"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SrsLink_itemId_targetType_targetId_key" ON "SrsLink"("itemId", "targetType", "targetId");

-- Immutable records and the approved-content lock, enforced by the database itself.
CREATE TRIGGER "srs_template_version_immutable" BEFORE UPDATE OF "config", "version", "templateId" ON "SrsTemplateVersion"
BEGIN SELECT RAISE(ABORT, 'SRS template versions are immutable'); END;

CREATE TRIGGER "srs_version_immutable" BEFORE UPDATE OF "snapshot", "hash", "label", "seq", "documentId", "kind" ON "SrsVersion"
BEGIN SELECT RAISE(ABORT, 'SRS versions are immutable'); END;

CREATE TRIGGER "srs_version_status" BEFORE UPDATE OF "status" ON "SrsVersion"
WHEN (OLD."status" = 'approved' AND NEW."status" NOT IN ('approved', 'superseded')) OR (OLD."status" = 'superseded' AND NEW."status" <> 'superseded') OR (OLD."status" = 'rejected' AND NEW."status" <> 'rejected')
BEGIN SELECT RAISE(ABORT, 'An approved SRS version can only be superseded'); END;

CREATE TRIGGER "srs_version_no_delete" BEFORE DELETE ON "SrsVersion"
WHEN EXISTS (SELECT 1 FROM "SrsDocument" WHERE "id" = OLD."documentId")
BEGIN SELECT RAISE(ABORT, 'SRS versions are never deleted'); END;

CREATE TRIGGER "srs_signature_immutable" BEFORE UPDATE ON "SrsSignature"
BEGIN SELECT RAISE(ABORT, 'Signatures are immutable'); END;

CREATE TRIGGER "srs_signature_no_delete" BEFORE DELETE ON "SrsSignature"
WHEN EXISTS (SELECT 1 FROM "SrsDocument" WHERE "id" = OLD."documentId")
BEGIN SELECT RAISE(ABORT, 'Signatures are never deleted'); END;

CREATE TRIGGER "srs_artifact_immutable" BEFORE UPDATE ON "SrsArtifact"
BEGIN SELECT RAISE(ABORT, 'Generated SRS artifacts are immutable'); END;

CREATE TRIGGER "srs_artifact_no_delete" BEFORE DELETE ON "SrsArtifact"
WHEN EXISTS (SELECT 1 FROM "SrsDocument" WHERE "id" = OLD."documentId")
BEGIN SELECT RAISE(ABORT, 'Generated SRS artifacts are never deleted'); END;

CREATE TRIGGER "srs_item_revision_immutable" BEFORE UPDATE ON "SrsItemRevision"
BEGIN SELECT RAISE(ABORT, 'Requirement revisions are immutable'); END;

CREATE TRIGGER "srs_item_revision_no_delete" BEFORE DELETE ON "SrsItemRevision"
WHEN EXISTS (SELECT 1 FROM "SrsItem" WHERE "id" = OLD."itemId")
BEGIN SELECT RAISE(ABORT, 'Requirement revisions are never deleted'); END;

CREATE TRIGGER "srs_document_lock" BEFORE UPDATE OF "overrides", "nfrNotApplicable", "title", "templateVersionId", "projectType" ON "SrsDocument"
WHEN OLD."status" IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_item_lock_insert" BEFORE INSERT ON "SrsItem"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_item_lock_update" BEFORE UPDATE OF "title", "description", "data", "origin", "priority", "visibility", "kind", "key" ON "SrsItem"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_item_lock_delete" BEFORE DELETE ON "SrsItem"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = OLD."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_section_lock_insert" BEFORE INSERT ON "SrsSection"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_section_lock_update" BEFORE UPDATE OF "content", "title", "applicable", "naReason", "origin", "visibility", "required", "sort" ON "SrsSection"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_answer_lock_insert" BEFORE INSERT ON "SrsAnswer"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_answer_lock_update" BEFORE UPDATE OF "value", "origin" ON "SrsAnswer"
WHEN (SELECT "status" FROM "SrsDocument" WHERE "id" = NEW."documentId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_criterion_lock_insert" BEFORE INSERT ON "SrsCriterion"
WHEN (SELECT d."status" FROM "SrsDocument" d JOIN "SrsItem" i ON i."documentId" = d."id" WHERE i."id" = NEW."itemId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_criterion_lock_update" BEFORE UPDATE OF "given", "whenText", "thenText" ON "SrsCriterion"
WHEN (SELECT d."status" FROM "SrsDocument" d JOIN "SrsItem" i ON i."documentId" = d."id" WHERE i."id" = NEW."itemId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;

CREATE TRIGGER "srs_criterion_lock_delete" BEFORE DELETE ON "SrsCriterion"
WHEN (SELECT d."status" FROM "SrsDocument" d JOIN "SrsItem" i ON i."documentId" = d."id" WHERE i."id" = OLD."itemId") IN ('approval_pending', 'approved', 'superseded', 'archived')
BEGIN SELECT RAISE(ABORT, 'SRS is locked: start a revision to change approved content'); END;