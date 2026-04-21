-- Phase 7 Wave 1 — City foundation
-- Adds a single-city container per world. Everyone in a world implicitly
-- lives in its sole city until geography expands to multi-city in a future
-- phase (at which point we drop the unique and add city_id on Person).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "cities" (
    "id"          UUID         NOT NULL,
    "name"        TEXT         NOT NULL,
    "description" TEXT,
    "founded_year" INTEGER     NOT NULL DEFAULT 1,
    "world_id"    UUID         NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- One city per world (drop this @unique when we add multi-city).
CREATE UNIQUE INDEX "cities_world_id_key" ON "cities"("world_id");

-- CASCADE so deleting a world removes its city, matching other per-world tables.
ALTER TABLE "cities"
  ADD CONSTRAINT "cities_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill — one default city per existing world, founded in year 1.
INSERT INTO "cities" ("id", "name", "founded_year", "world_id", "created_at", "updated_at")
SELECT gen_random_uuid(), w.name || ' Proper', 1, w.id, NOW(), NOW()
FROM "worlds" w
WHERE NOT EXISTS (SELECT 1 FROM "cities" c WHERE c.world_id = w.id);
