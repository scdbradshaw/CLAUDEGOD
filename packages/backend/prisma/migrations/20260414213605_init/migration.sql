-- CreateEnum
CREATE TYPE "Sexuality" AS ENUM ('HETEROSEXUAL', 'HOMOSEXUAL', 'BISEXUAL', 'ASEXUAL', 'PANSEXUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "EmotionalImpact" AS ENUM ('traumatic', 'negative', 'neutral', 'positive', 'euphoric');

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sexuality" "Sexuality" NOT NULL,
    "gender" TEXT NOT NULL,
    "race" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "lifespan" INTEGER NOT NULL DEFAULT 80,
    "relationship_status" TEXT NOT NULL,
    "religion" TEXT NOT NULL,
    "criminal_record" JSONB NOT NULL DEFAULT '[]',
    "health" INTEGER NOT NULL DEFAULT 100,
    "morality" INTEGER NOT NULL DEFAULT 50,
    "happiness" INTEGER NOT NULL DEFAULT 50,
    "reputation" INTEGER NOT NULL DEFAULT 50,
    "influence" INTEGER NOT NULL DEFAULT 0,
    "intelligence" INTEGER NOT NULL DEFAULT 50,
    "physical_appearance" TEXT NOT NULL,
    "wealth" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_bank" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "event_summary" TEXT NOT NULL,
    "emotional_impact" "EmotionalImpact" NOT NULL,
    "delta_applied" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_bank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_bank_person_id_idx" ON "memory_bank"("person_id");

-- CreateIndex
CREATE INDEX "memory_bank_timestamp_idx" ON "memory_bank"("timestamp");

-- AddForeignKey
ALTER TABLE "memory_bank" ADD CONSTRAINT "memory_bank_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
