-- AlterTable
ALTER TABLE "world_state" ADD COLUMN     "global_trait_multipliers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "market_index" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
ADD COLUMN     "market_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.015,
ADD COLUMN     "market_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
ADD COLUMN     "tick_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_deaths" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "deceased_persons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "age_at_death" INTEGER NOT NULL,
    "world_year" INTEGER NOT NULL,
    "cause" TEXT NOT NULL,
    "final_health" INTEGER NOT NULL,
    "final_wealth" DOUBLE PRECISION NOT NULL,
    "final_happiness" INTEGER NOT NULL,
    "peak_positive_outcome" TEXT,
    "peak_negative_outcome" TEXT,
    "died_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deceased_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rulesets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rulesets_pkey" PRIMARY KEY ("id")
);
