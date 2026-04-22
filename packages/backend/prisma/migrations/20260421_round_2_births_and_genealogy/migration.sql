-- Round 2 — Births system
--   1. Pregnancy table: created by conception interactions + agentic action;
--      resolves at due_tick via createChildFromParents.
--   2. persons.parent_a_id / parent_b_id: nullable self-relations for genealogy.

-- AlterTable: add genealogy columns to persons
ALTER TABLE "persons"
  ADD COLUMN "parent_a_id" UUID,
  ADD COLUMN "parent_b_id" UUID;

-- CreateTable
CREATE TABLE "pregnancies" (
    "id" UUID NOT NULL,
    "parent_a_id" UUID NOT NULL,
    "parent_b_id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "started_tick" INTEGER NOT NULL,
    "due_tick" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "child_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pregnancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pregnancies_world_id_idx"           ON "pregnancies"("world_id");
CREATE INDEX "pregnancies_resolved_due_tick_idx"  ON "pregnancies"("resolved", "due_tick");
CREATE INDEX "pregnancies_parent_a_id_idx"        ON "pregnancies"("parent_a_id");
CREATE INDEX "pregnancies_parent_b_id_idx"        ON "pregnancies"("parent_b_id");
CREATE INDEX "persons_parent_a_id_idx"            ON "persons"("parent_a_id");
CREATE INDEX "persons_parent_b_id_idx"            ON "persons"("parent_b_id");

-- AddForeignKey — person.parent_a/b self-relations
ALTER TABLE "persons"
  ADD CONSTRAINT "persons_parent_a_id_fkey"
  FOREIGN KEY ("parent_a_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "persons"
  ADD CONSTRAINT "persons_parent_b_id_fkey"
  FOREIGN KEY ("parent_b_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — pregnancy → parents (Cascade so dropping a parent aborts pregnancy)
ALTER TABLE "pregnancies"
  ADD CONSTRAINT "pregnancies_parent_a_id_fkey"
  FOREIGN KEY ("parent_a_id") REFERENCES "persons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pregnancies"
  ADD CONSTRAINT "pregnancies_parent_b_id_fkey"
  FOREIGN KEY ("parent_b_id") REFERENCES "persons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — pregnancy → world
ALTER TABLE "pregnancies"
  ADD CONSTRAINT "pregnancies_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
