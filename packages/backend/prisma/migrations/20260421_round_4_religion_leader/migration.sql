-- Round 4 — Faction / Religion succession
--
-- Religions previously dissolved unconditionally when their founder died.
-- We're adding a `leader_id` column so the succession pipeline in
-- `handlePersonDeath` can try to promote a worthy heir from the memberships
-- before falling back to dissolution. Factions already have leader_id.

ALTER TABLE "religions"
  ADD COLUMN "leader_id" UUID NULL;

ALTER TABLE "religions"
  ADD CONSTRAINT "religions_leader_id_fkey"
  FOREIGN KEY ("leader_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "religions_leader_id_idx" ON "religions"("leader_id");

-- Backfill: every active religion's current torchbearer IS its founder until
-- someone dies. For dissolved religions, leave leader_id NULL.
UPDATE "religions"
   SET "leader_id" = "founder_id"
 WHERE "is_active"  = true
   AND "founder_id" IS NOT NULL;
