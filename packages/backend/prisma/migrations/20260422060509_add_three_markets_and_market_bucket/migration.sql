-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "market_bucket" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "worlds" ADD COLUMN     "market_highlights" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "market_history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "market_stable_index" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
ADD COLUMN     "market_stable_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.012,
ADD COLUMN     "market_stable_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.015,
ADD COLUMN     "market_volatile_index" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
ADD COLUMN     "market_volatile_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
ADD COLUMN     "market_volatile_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
ALTER COLUMN "market_trend" SET DEFAULT 0.018,
ALTER COLUMN "market_volatility" SET DEFAULT 0.05;
