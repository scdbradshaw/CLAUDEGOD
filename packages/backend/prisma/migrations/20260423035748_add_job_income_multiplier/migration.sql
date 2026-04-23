-- CreateEnum
CREATE TYPE "Sexuality" AS ENUM ('HETEROSEXUAL', 'HOMOSEXUAL', 'BISEXUAL', 'ASEXUAL', 'PANSEXUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "EmotionalImpact" AS ENUM ('traumatic', 'negative', 'neutral', 'positive', 'euphoric');

-- CreateEnum
CREATE TYPE "HeadlineCategory" AS ENUM ('MOST_DRAMATIC_FALL', 'MOST_INSPIRING_RISE', 'GREATEST_VILLAIN', 'MOST_TRAGIC', 'BEST_LOVE_STORY', 'MOST_CRIMINAL', 'RAGS_TO_RICHES', 'RICHES_TO_RAGS', 'MOST_INFLUENTIAL', 'LONGEST_SURVIVING');

-- CreateEnum
CREATE TYPE "HeadlineType" AS ENUM ('ANNUAL', 'DECADE');

-- CreateEnum
CREATE TYPE "InnerCircleRelation" AS ENUM ('parent', 'child', 'sibling', 'spouse', 'lover', 'close_friend', 'rival', 'enemy');

-- CreateEnum
CREATE TYPE "GroupOrigin" AS ENUM ('emergent', 'player', 'event');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('religion', 'faction');

-- CreateEnum
CREATE TYPE "PopulationTier" AS ENUM ('intimate', 'town', 'civilization');

-- CreateEnum
CREATE TYPE "Tone" AS ENUM ('tabloid', 'literary', 'epic', 'reportage', 'neutral');

-- CreateTable
CREATE TABLE "worlds" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "population_tier" "PopulationTier" NOT NULL DEFAULT 'intimate',
    "ruleset_id" UUID,
    "current_year" INTEGER NOT NULL DEFAULT 1,
    "year_count" INTEGER NOT NULL DEFAULT 0,
    "bi_annual_index" INTEGER NOT NULL DEFAULT 0,
    "total_deaths" INTEGER NOT NULL DEFAULT 0,
    "market_index" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "market_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.018,
    "market_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "market_stable_index" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "market_stable_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.012,
    "market_stable_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.015,
    "market_volatile_index" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "market_volatile_trend" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
    "market_volatile_volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "market_history" JSONB NOT NULL DEFAULT '[]',
    "market_highlights" JSONB NOT NULL DEFAULT '{}',
    "global_traits" JSONB NOT NULL DEFAULT '{}',
    "global_trait_multipliers" JSONB NOT NULL DEFAULT '{}',
    "active_trait_categories" JSONB NOT NULL DEFAULT '[]',
    "job_income_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "founded_year" INTEGER NOT NULL DEFAULT 1,
    "world_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sexuality" "Sexuality" NOT NULL,
    "gender" TEXT NOT NULL,
    "race" TEXT NOT NULL,
    "occupation" TEXT NOT NULL DEFAULT 'commoner',
    "age" INTEGER NOT NULL,
    "death_age" INTEGER NOT NULL DEFAULT 80,
    "relationship_status" TEXT NOT NULL,
    "religion" TEXT NOT NULL,
    "criminal_record" JSONB NOT NULL DEFAULT '[]',
    "max_health" INTEGER NOT NULL DEFAULT 100,
    "current_health" INTEGER NOT NULL DEFAULT 100,
    "attack" INTEGER NOT NULL DEFAULT 50,
    "defense" INTEGER NOT NULL DEFAULT 50,
    "speed" INTEGER NOT NULL DEFAULT 50,
    "trauma_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "physical_appearance" TEXT NOT NULL,
    "happiness" INTEGER NOT NULL DEFAULT 50,
    "happiness_base" INTEGER NOT NULL DEFAULT 50,
    "happiness_set_tick" INTEGER NOT NULL DEFAULT 0,
    "trauma_set_tick" INTEGER NOT NULL DEFAULT 0,
    "job_id" TEXT,
    "money" INTEGER NOT NULL DEFAULT 0,
    "money_invested" INTEGER NOT NULL DEFAULT 0,
    "moral_score" INTEGER NOT NULL DEFAULT 0,
    "market_bucket" TEXT NOT NULL DEFAULT 'standard',
    "traits" JSONB NOT NULL DEFAULT '{}',
    "global_scores" JSONB NOT NULL DEFAULT '{}',
    "world_id" UUID NOT NULL,
    "parent_a_id" UUID,
    "parent_b_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancies" (
    "id" UUID NOT NULL,
    "parent_a_id" UUID NOT NULL,
    "parent_b_id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "started_tick" INTEGER NOT NULL,
    "due_tick" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "child_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pregnancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inner_circle_links" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "relation_type" "InnerCircleRelation" NOT NULL,
    "bond_strength" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inner_circle_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_bank" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "event_summary" TEXT NOT NULL,
    "emotional_impact" "EmotionalImpact" NOT NULL,
    "delta_applied" JSONB NOT NULL,
    "magnitude" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "counterparty_id" UUID,
    "tone" "Tone",
    "weight" INTEGER NOT NULL DEFAULT 50,
    "decade_of_life" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world_year" INTEGER,

    CONSTRAINT "memory_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deceased_persons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "age_at_death" INTEGER NOT NULL,
    "world_year" INTEGER NOT NULL,
    "cause" TEXT NOT NULL,
    "final_health" INTEGER NOT NULL,
    "final_money" INTEGER NOT NULL,
    "peak_positive_outcome" TEXT,
    "peak_negative_outcome" TEXT,
    "died_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world_id" UUID NOT NULL,

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
    "tone" "Tone" NOT NULL DEFAULT 'neutral',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world_id" UUID NOT NULL,

    CONSTRAINT "yearly_headlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "religions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "founder_id" UUID,
    "leader_id" UUID,
    "origin" "GroupOrigin" NOT NULL DEFAULT 'emergent',
    "tolerance" INTEGER NOT NULL DEFAULT 10,
    "virus_profile" JSONB NOT NULL DEFAULT '{}',
    "cost_per_tick" INTEGER NOT NULL DEFAULT 0,
    "trait_minimums" JSONB NOT NULL DEFAULT '{}',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "founded_year" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dissolved_year" INTEGER,
    "dissolved_reason" TEXT,
    "disbanded_at" TIMESTAMP(3),
    "world_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "religions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "religion_memberships" (
    "id" UUID NOT NULL,
    "religion_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "joined_year" INTEGER NOT NULL,
    "alignment" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "religion_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "founder_id" UUID,
    "leader_id" UUID,
    "origin" "GroupOrigin" NOT NULL DEFAULT 'emergent',
    "tolerance" INTEGER NOT NULL DEFAULT 10,
    "virus_profile" JSONB NOT NULL DEFAULT '{}',
    "cost_per_tick" INTEGER NOT NULL DEFAULT 0,
    "trait_minimums" JSONB NOT NULL DEFAULT '{}',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "founded_year" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dissolved_year" INTEGER,
    "dissolved_reason" TEXT,
    "disbanded_at" TIMESTAMP(3),
    "split_from_id" UUID,
    "world_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faction_memberships" (
    "id" UUID NOT NULL,
    "faction_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "joined_year" INTEGER NOT NULL,
    "alignment" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "split_pressure_ticks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faction_memberships_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "world_events" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "event_def_id" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "started_tick" INTEGER NOT NULL,
    "started_year" INTEGER NOT NULL,
    "duration_years" INTEGER,
    "years_remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_runs" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'bi_annual_a',
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "year_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_snapshots" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_history" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "event_def_id" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "started_year" INTEGER NOT NULL,
    "ended_year" INTEGER NOT NULL,
    "end_reason" TEXT NOT NULL,
    "duration_actual" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_event_statuses" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_event_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worlds_is_active_idx" ON "worlds"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "cities_world_id_key" ON "cities"("world_id");

-- CreateIndex
CREATE INDEX "persons_world_id_idx" ON "persons"("world_id");

-- CreateIndex
CREATE INDEX "persons_parent_a_id_idx" ON "persons"("parent_a_id");

-- CreateIndex
CREATE INDEX "persons_parent_b_id_idx" ON "persons"("parent_b_id");

-- CreateIndex
CREATE INDEX "pregnancies_world_id_idx" ON "pregnancies"("world_id");

-- CreateIndex
CREATE INDEX "pregnancies_resolved_due_tick_idx" ON "pregnancies"("resolved", "due_tick");

-- CreateIndex
CREATE INDEX "pregnancies_parent_a_id_idx" ON "pregnancies"("parent_a_id");

-- CreateIndex
CREATE INDEX "pregnancies_parent_b_id_idx" ON "pregnancies"("parent_b_id");

-- CreateIndex
CREATE INDEX "inner_circle_links_owner_id_idx" ON "inner_circle_links"("owner_id");

-- CreateIndex
CREATE INDEX "inner_circle_links_target_id_idx" ON "inner_circle_links"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "inner_circle_links_owner_id_target_id_relation_type_key" ON "inner_circle_links"("owner_id", "target_id", "relation_type");

-- CreateIndex
CREATE INDEX "memory_bank_person_id_idx" ON "memory_bank"("person_id");

-- CreateIndex
CREATE INDEX "memory_bank_timestamp_idx" ON "memory_bank"("timestamp");

-- CreateIndex
CREATE INDEX "memory_bank_world_year_idx" ON "memory_bank"("world_year");

-- CreateIndex
CREATE INDEX "memory_bank_counterparty_id_idx" ON "memory_bank"("counterparty_id");

-- CreateIndex
CREATE INDEX "memory_bank_person_id_decade_of_life_idx" ON "memory_bank"("person_id", "decade_of_life");

-- CreateIndex
CREATE INDEX "memory_bank_person_id_weight_idx" ON "memory_bank"("person_id", "weight");

-- CreateIndex
CREATE INDEX "deceased_persons_world_id_idx" ON "deceased_persons"("world_id");

-- CreateIndex
CREATE INDEX "yearly_headlines_year_idx" ON "yearly_headlines"("year");

-- CreateIndex
CREATE INDEX "yearly_headlines_type_idx" ON "yearly_headlines"("type");

-- CreateIndex
CREATE INDEX "yearly_headlines_world_id_idx" ON "yearly_headlines"("world_id");

-- CreateIndex
CREATE UNIQUE INDEX "yearly_headlines_world_id_year_type_category_key" ON "yearly_headlines"("world_id", "year", "type", "category");

-- CreateIndex
CREATE INDEX "religions_founder_id_idx" ON "religions"("founder_id");

-- CreateIndex
CREATE INDEX "religions_leader_id_idx" ON "religions"("leader_id");

-- CreateIndex
CREATE INDEX "religions_is_active_idx" ON "religions"("is_active");

-- CreateIndex
CREATE INDEX "religions_world_id_idx" ON "religions"("world_id");

-- CreateIndex
CREATE INDEX "religion_memberships_religion_id_idx" ON "religion_memberships"("religion_id");

-- CreateIndex
CREATE INDEX "religion_memberships_person_id_idx" ON "religion_memberships"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "religion_memberships_religion_id_person_id_key" ON "religion_memberships"("religion_id", "person_id");

-- CreateIndex
CREATE INDEX "factions_founder_id_idx" ON "factions"("founder_id");

-- CreateIndex
CREATE INDEX "factions_leader_id_idx" ON "factions"("leader_id");

-- CreateIndex
CREATE INDEX "factions_is_active_idx" ON "factions"("is_active");

-- CreateIndex
CREATE INDEX "factions_world_id_idx" ON "factions"("world_id");

-- CreateIndex
CREATE INDEX "faction_memberships_faction_id_idx" ON "faction_memberships"("faction_id");

-- CreateIndex
CREATE INDEX "faction_memberships_person_id_idx" ON "faction_memberships"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "faction_memberships_faction_id_person_id_key" ON "faction_memberships"("faction_id", "person_id");

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
CREATE INDEX "world_events_world_id_idx" ON "world_events"("world_id");

-- CreateIndex
CREATE INDEX "world_events_world_id_is_active_idx" ON "world_events"("world_id", "is_active");

-- CreateIndex
CREATE INDEX "year_runs_world_id_idx" ON "year_runs"("world_id");

-- CreateIndex
CREATE INDEX "year_runs_world_id_status_idx" ON "year_runs"("world_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "world_snapshots_world_id_key" ON "world_snapshots"("world_id");

-- CreateIndex
CREATE INDEX "event_history_world_id_idx" ON "event_history"("world_id");

-- CreateIndex
CREATE INDEX "person_event_statuses_event_id_idx" ON "person_event_statuses"("event_id");

-- CreateIndex
CREATE INDEX "person_event_statuses_person_id_idx" ON "person_event_statuses"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_event_statuses_event_id_person_id_key" ON "person_event_statuses"("event_id", "person_id");

-- AddForeignKey
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_ruleset_id_fkey" FOREIGN KEY ("ruleset_id") REFERENCES "rulesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_parent_a_id_fkey" FOREIGN KEY ("parent_a_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_parent_b_id_fkey" FOREIGN KEY ("parent_b_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_parent_a_id_fkey" FOREIGN KEY ("parent_a_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_parent_b_id_fkey" FOREIGN KEY ("parent_b_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inner_circle_links" ADD CONSTRAINT "inner_circle_links_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inner_circle_links" ADD CONSTRAINT "inner_circle_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_bank" ADD CONSTRAINT "memory_bank_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deceased_persons" ADD CONSTRAINT "deceased_persons_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yearly_headlines" ADD CONSTRAINT "yearly_headlines_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religions" ADD CONSTRAINT "religions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religions" ADD CONSTRAINT "religions_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religions" ADD CONSTRAINT "religions_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religion_memberships" ADD CONSTRAINT "religion_memberships_religion_id_fkey" FOREIGN KEY ("religion_id") REFERENCES "religions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religion_memberships" ADD CONSTRAINT "religion_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_decade_summaries" ADD CONSTRAINT "life_decade_summaries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_memories" ADD CONSTRAINT "world_memories_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tick_jobs" ADD CONSTRAINT "tick_jobs_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yearly_reports" ADD CONSTRAINT "yearly_reports_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_runs" ADD CONSTRAINT "year_runs_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_snapshots" ADD CONSTRAINT "world_snapshots_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_history" ADD CONSTRAINT "event_history_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_event_statuses" ADD CONSTRAINT "person_event_statuses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "world_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_event_statuses" ADD CONSTRAINT "person_event_statuses_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
