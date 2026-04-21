-- CreateEnum
CREATE TYPE "HeadlineCategory" AS ENUM ('MOST_DRAMATIC_FALL', 'MOST_INSPIRING_RISE', 'GREATEST_VILLAIN', 'MOST_TRAGIC', 'BEST_LOVE_STORY', 'MOST_CRIMINAL', 'RAGS_TO_RICHES', 'RICHES_TO_RAGS', 'MOST_INFLUENTIAL', 'LONGEST_SURVIVING');

-- CreateEnum
CREATE TYPE "HeadlineType" AS ENUM ('ANNUAL', 'DECADE');

-- AlterTable
ALTER TABLE "memory_bank" ADD COLUMN     "world_year" INTEGER;

-- CreateTable
CREATE TABLE "world_state" (
    "id" SERIAL NOT NULL,
    "current_year" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yearly_headlines" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "type" "HeadlineType" NOT NULL DEFAULT 'ANNUAL',
    "category" "HeadlineCategory" NOT NULL,
    "headline" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "person_id" UUID,
    "person_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yearly_headlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "yearly_headlines_year_idx" ON "yearly_headlines"("year");

-- CreateIndex
CREATE INDEX "yearly_headlines_type_idx" ON "yearly_headlines"("type");

-- CreateIndex
CREATE UNIQUE INDEX "yearly_headlines_year_type_category_key" ON "yearly_headlines"("year", "type", "category");

-- CreateIndex
CREATE INDEX "memory_bank_world_year_idx" ON "memory_bank"("world_year");
