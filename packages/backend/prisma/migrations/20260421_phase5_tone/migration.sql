-- Phase 5 — Tone enum + Tone columns on yearly_headlines and memory_bank.
-- Also fixes Phase 4 drift: population_tier was created as TEXT but
-- declared in schema.prisma as the PopulationTier enum. Convert in place.

-- ── PopulationTier (Phase 4 drift fix) ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PopulationTier" AS ENUM ('intimate', 'town', 'civilization');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Convert worlds.population_tier TEXT → PopulationTier enum in place.
-- Existing values ('intimate' | 'town' | 'civilization') are all valid members.
ALTER TABLE "worlds"
  ALTER COLUMN "population_tier" DROP DEFAULT,
  ALTER COLUMN "population_tier" TYPE "PopulationTier"
    USING ("population_tier"::"PopulationTier"),
  ALTER COLUMN "population_tier" SET DEFAULT 'intimate'::"PopulationTier";

-- ── Tone enum ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "Tone" AS ENUM ('tabloid', 'literary', 'epic', 'reportage', 'neutral');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── yearly_headlines.tone (required, default neutral) ──────────────────────
ALTER TABLE "yearly_headlines"
  ADD COLUMN "tone" "Tone" NOT NULL DEFAULT 'neutral';

-- Back-fill: every existing DECADE row gets 'epic'. Annual rows stay 'neutral'.
UPDATE "yearly_headlines" SET "tone" = 'epic' WHERE "type" = 'DECADE';

-- ── memory_bank.tone (nullable, no default) ────────────────────────────────
ALTER TABLE "memory_bank"
  ADD COLUMN "tone" "Tone";
