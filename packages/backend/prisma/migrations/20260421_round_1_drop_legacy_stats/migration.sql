-- Round 1 follow-up: drop the legacy 6-stat block columns whose data has
-- already been superseded by the `traits` JSONB map + top-level `health`.
-- Committed in 45f4e19 but the migration SQL was never generated.

-- AlterTable
ALTER TABLE "deceased_persons" DROP COLUMN IF EXISTS "final_happiness";

-- AlterTable
ALTER TABLE "persons"
  DROP COLUMN IF EXISTS "happiness",
  DROP COLUMN IF EXISTS "influence",
  DROP COLUMN IF EXISTS "intelligence",
  DROP COLUMN IF EXISTS "morality",
  DROP COLUMN IF EXISTS "reputation";
