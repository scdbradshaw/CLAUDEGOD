-- Phase 4 — World Designer
-- Replaces the WorldState singleton with a full World model that supports
-- multiple isolated worlds. All per-world entities gain a world_id FK.

-- 1. Create worlds table
CREATE TABLE "worlds" (
  "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"                     TEXT         NOT NULL DEFAULT 'Default World',
  "description"              TEXT,
  "is_active"                BOOLEAN      NOT NULL DEFAULT false,
  "archived_at"              TIMESTAMP(3),
  "population_tier"          TEXT         NOT NULL DEFAULT 'intimate',
  "ruleset_id"               UUID,
  "current_year"             INTEGER      NOT NULL DEFAULT 1,
  "tick_count"               INTEGER      NOT NULL DEFAULT 0,
  "total_deaths"             INTEGER      NOT NULL DEFAULT 0,
  "market_index"             FLOAT8       NOT NULL DEFAULT 100.0,
  "market_trend"             FLOAT8       NOT NULL DEFAULT 0.015,
  "market_volatility"        FLOAT8       NOT NULL DEFAULT 0.03,
  "global_traits"            JSONB        NOT NULL DEFAULT '{}',
  "global_trait_multipliers" JSONB        NOT NULL DEFAULT '{}',
  "active_trait_categories"  JSONB        NOT NULL DEFAULT '[]',
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "worlds_is_active_idx" ON "worlds"("is_active");

-- 2. Seed the default world from the existing world_state row (if any)
DO $$
DECLARE
  v_world_id  UUID := gen_random_uuid();
  v_ruleset   UUID;
  ws          RECORD;
BEGIN
  -- Pick the active ruleset (or any ruleset if none is marked active)
  SELECT id INTO v_ruleset FROM rulesets WHERE is_active = true LIMIT 1;
  IF v_ruleset IS NULL THEN
    SELECT id INTO v_ruleset FROM rulesets ORDER BY created_at LIMIT 1;
  END IF;

  -- Try to read existing world_state
  BEGIN
    SELECT * INTO ws FROM world_state LIMIT 1;
  EXCEPTION WHEN undefined_table THEN
    ws := NULL;
  END;

  IF ws IS NOT NULL THEN
    INSERT INTO "worlds" (
      "id", "name", "is_active", "population_tier", "ruleset_id",
      "current_year", "tick_count", "total_deaths",
      "market_index", "market_trend", "market_volatility",
      "global_traits", "global_trait_multipliers", "active_trait_categories"
    ) VALUES (
      v_world_id, 'Default World', true, 'intimate', v_ruleset,
      COALESCE(ws.current_year, 1),
      COALESCE(ws.tick_count, 0),
      COALESCE(ws.total_deaths, 0),
      COALESCE(ws.market_index, 100.0),
      COALESCE(ws.market_trend, 0.015),
      COALESCE(ws.market_volatility, 0.03),
      COALESCE(ws.global_traits::jsonb,            '{}'),
      COALESCE(ws.global_trait_multipliers::jsonb, '{}'),
      COALESCE(ws.active_trait_categories::jsonb,  '[]')
    );
  ELSE
    INSERT INTO "worlds" (
      "id", "name", "is_active", "population_tier", "ruleset_id"
    ) VALUES (
      v_world_id, 'Default World', true, 'intimate', v_ruleset
    );
  END IF;
END;
$$;

-- 3. Add world_id columns (nullable first to allow backfill)
ALTER TABLE "persons"          ADD COLUMN "world_id" UUID;
ALTER TABLE "religions"        ADD COLUMN "world_id" UUID;
ALTER TABLE "factions"         ADD COLUMN "world_id" UUID;
ALTER TABLE "deceased_persons" ADD COLUMN "world_id" UUID;
ALTER TABLE "yearly_headlines" ADD COLUMN "world_id" UUID;

-- 4. Backfill with the single active world
UPDATE "persons"          SET "world_id" = (SELECT id FROM worlds WHERE is_active = true LIMIT 1);
UPDATE "religions"        SET "world_id" = (SELECT id FROM worlds WHERE is_active = true LIMIT 1);
UPDATE "factions"         SET "world_id" = (SELECT id FROM worlds WHERE is_active = true LIMIT 1);
UPDATE "deceased_persons" SET "world_id" = (SELECT id FROM worlds WHERE is_active = true LIMIT 1);
UPDATE "yearly_headlines" SET "world_id" = (SELECT id FROM worlds WHERE is_active = true LIMIT 1);

-- 5. Make world_id NOT NULL
ALTER TABLE "persons"          ALTER COLUMN "world_id" SET NOT NULL;
ALTER TABLE "religions"        ALTER COLUMN "world_id" SET NOT NULL;
ALTER TABLE "factions"         ALTER COLUMN "world_id" SET NOT NULL;
ALTER TABLE "deceased_persons" ALTER COLUMN "world_id" SET NOT NULL;
ALTER TABLE "yearly_headlines" ALTER COLUMN "world_id" SET NOT NULL;

-- 6. Foreign key constraints
ALTER TABLE "worlds"
  ADD CONSTRAINT "worlds_ruleset_id_fkey"
  FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "persons"
  ADD CONSTRAINT "persons_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "religions"
  ADD CONSTRAINT "religions_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "factions"
  ADD CONSTRAINT "factions_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deceased_persons"
  ADD CONSTRAINT "deceased_persons_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "yearly_headlines"
  ADD CONSTRAINT "yearly_headlines_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Indexes
CREATE INDEX "persons_world_id_idx"          ON "persons"("world_id");
CREATE INDEX "religions_world_id_idx"        ON "religions"("world_id");
CREATE INDEX "factions_world_id_idx"         ON "factions"("world_id");
CREATE INDEX "deceased_persons_world_id_idx" ON "deceased_persons"("world_id");
CREATE INDEX "yearly_headlines_world_id_idx" ON "yearly_headlines"("world_id");

-- 8. Drop the old unique constraint on yearly_headlines (world_id is now part of it)
ALTER TABLE "yearly_headlines"
  DROP CONSTRAINT IF EXISTS "yearly_headlines_year_type_category_key";

ALTER TABLE "yearly_headlines"
  ADD CONSTRAINT "yearly_headlines_world_id_year_type_category_key"
  UNIQUE ("world_id", "year", "type", "category");

-- 9. Drop the old world_state table
DROP TABLE IF EXISTS "world_state";
