-- AlterTable
ALTER TABLE "factions" ADD COLUMN     "cost_per_tick" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trait_minimums" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "religions" ADD COLUMN     "cost_per_tick" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trait_minimums" JSONB NOT NULL DEFAULT '{}';
