-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('religion', 'faction');

-- AlterTable
ALTER TABLE "memory_bank" ADD COLUMN     "decade_of_life" INTEGER,
ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "life_decade_summaries" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "decade_end_age" INTEGER NOT NULL,
    "decade_of_life" INTEGER NOT NULL,
    "world_year_start" INTEGER NOT NULL,
    "world_year_end" INTEGER NOT NULL,
    "top_memories" JSONB NOT NULL DEFAULT '[]',
    "aggregates" JSONB NOT NULL DEFAULT '{}',
    "prior_summary_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "life_decade_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memories" (
    "id" UUID NOT NULL,
    "group_type" TEXT NOT NULL,
    "group_id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "event_summary" TEXT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "tone" "Tone" NOT NULL DEFAULT 'epic',
    "world_year" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 70,
    "counterparty_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_memories" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "event_summary" TEXT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "tone" "Tone" NOT NULL DEFAULT 'epic',
    "world_year" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 80,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tick_jobs" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "lock_key" BIGINT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tick_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yearly_reports" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "population_start" INTEGER NOT NULL,
    "population_end" INTEGER NOT NULL,
    "births" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "deaths_by_cause" JSONB NOT NULL DEFAULT '{}',
    "market_index_start" DOUBLE PRECISION NOT NULL,
    "market_index_end" DOUBLE PRECISION NOT NULL,
    "top_swings" JSONB NOT NULL DEFAULT '[]',
    "group_events" JSONB NOT NULL DEFAULT '[]',
    "bulk_actions" JSONB NOT NULL DEFAULT '[]',
    "force_scores" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yearly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "life_decade_summaries_person_id_idx" ON "life_decade_summaries"("person_id");

-- CreateIndex
CREATE INDEX "life_decade_summaries_person_id_decade_of_life_idx" ON "life_decade_summaries"("person_id", "decade_of_life");

-- CreateIndex
CREATE UNIQUE INDEX "life_decade_summaries_person_id_decade_end_age_key" ON "life_decade_summaries"("person_id", "decade_end_age");

-- CreateIndex
CREATE INDEX "group_memories_group_type_group_id_idx" ON "group_memories"("group_type", "group_id");

-- CreateIndex
CREATE INDEX "group_memories_world_id_idx" ON "group_memories"("world_id");

-- CreateIndex
CREATE INDEX "group_memories_world_year_idx" ON "group_memories"("world_year");

-- CreateIndex
CREATE INDEX "world_memories_world_id_idx" ON "world_memories"("world_id");

-- CreateIndex
CREATE INDEX "world_memories_world_id_world_year_idx" ON "world_memories"("world_id", "world_year");

-- CreateIndex
CREATE INDEX "tick_jobs_status_idx" ON "tick_jobs"("status");

-- CreateIndex
CREATE INDEX "tick_jobs_world_id_status_idx" ON "tick_jobs"("world_id", "status");

-- CreateIndex
CREATE INDEX "tick_jobs_kind_status_idx" ON "tick_jobs"("kind", "status");

-- CreateIndex
CREATE INDEX "yearly_reports_world_id_idx" ON "yearly_reports"("world_id");

-- CreateIndex
CREATE UNIQUE INDEX "yearly_reports_world_id_year_key" ON "yearly_reports"("world_id", "year");

-- CreateIndex
CREATE INDEX "memory_bank_person_id_decade_of_life_idx" ON "memory_bank"("person_id", "decade_of_life");

-- CreateIndex
CREATE INDEX "memory_bank_person_id_weight_idx" ON "memory_bank"("person_id", "weight");

-- AddForeignKey
ALTER TABLE "life_decade_summaries" ADD CONSTRAINT "life_decade_summaries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_memories" ADD CONSTRAINT "world_memories_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tick_jobs" ADD CONSTRAINT "tick_jobs_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yearly_reports" ADD CONSTRAINT "yearly_reports_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
