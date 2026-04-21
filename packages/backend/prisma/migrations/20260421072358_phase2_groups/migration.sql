-- CreateEnum
CREATE TYPE "GroupOrigin" AS ENUM ('emergent', 'player', 'event');

-- CreateTable
CREATE TABLE "religions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "founder_id" UUID NOT NULL,
    "origin" "GroupOrigin" NOT NULL DEFAULT 'emergent',
    "tolerance" INTEGER NOT NULL DEFAULT 10,
    "virus_profile" JSONB NOT NULL DEFAULT '{}',
    "founded_year" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dissolved_year" INTEGER,
    "dissolved_reason" TEXT,
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
    "founder_id" UUID NOT NULL,
    "leader_id" UUID,
    "origin" "GroupOrigin" NOT NULL DEFAULT 'emergent',
    "tolerance" INTEGER NOT NULL DEFAULT 10,
    "virus_profile" JSONB NOT NULL DEFAULT '{}',
    "founded_year" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dissolved_year" INTEGER,
    "dissolved_reason" TEXT,
    "split_from_id" UUID,
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

-- CreateIndex
CREATE INDEX "religions_founder_id_idx" ON "religions"("founder_id");

-- CreateIndex
CREATE INDEX "religions_is_active_idx" ON "religions"("is_active");

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
CREATE INDEX "faction_memberships_faction_id_idx" ON "faction_memberships"("faction_id");

-- CreateIndex
CREATE INDEX "faction_memberships_person_id_idx" ON "faction_memberships"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "faction_memberships_faction_id_person_id_key" ON "faction_memberships"("faction_id", "person_id");

-- AddForeignKey
ALTER TABLE "religions" ADD CONSTRAINT "religions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religion_memberships" ADD CONSTRAINT "religion_memberships_religion_id_fkey" FOREIGN KEY ("religion_id") REFERENCES "religions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "religion_memberships" ADD CONSTRAINT "religion_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_faction_id_fkey" FOREIGN KEY ("faction_id") REFERENCES "factions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
