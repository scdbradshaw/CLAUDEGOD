-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "traits" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "world_state" ADD COLUMN     "active_trait_categories" JSONB NOT NULL DEFAULT '[]';
