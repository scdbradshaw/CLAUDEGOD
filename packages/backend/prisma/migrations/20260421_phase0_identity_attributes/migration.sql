-- Phase 0: Identity Attributes + Occupation
-- 1. Rename lifespan → death_age
ALTER TABLE "persons" RENAME COLUMN "lifespan" TO "death_age";

-- 2. Add occupation column (defaults to 'commoner' for existing rows)
ALTER TABLE "persons" ADD COLUMN "occupation" TEXT NOT NULL DEFAULT 'commoner';

-- 3. Reset traits JSONB — old 100-key survival/philosophy system is replaced
--    by the 25 identity attributes. Existing trait data is invalid; clear it
--    so the next seed/generation populates the correct keys.
UPDATE "persons" SET "traits" = '{}';
