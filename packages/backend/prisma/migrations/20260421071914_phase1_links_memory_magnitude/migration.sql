-- CreateEnum
CREATE TYPE "InnerCircleRelation" AS ENUM ('parent', 'child', 'sibling', 'spouse', 'lover', 'close_friend', 'rival', 'enemy');

-- AlterTable
ALTER TABLE "memory_bank" ADD COLUMN     "counterparty_id" UUID,
ADD COLUMN     "magnitude" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

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

-- CreateIndex
CREATE INDEX "inner_circle_links_owner_id_idx" ON "inner_circle_links"("owner_id");

-- CreateIndex
CREATE INDEX "inner_circle_links_target_id_idx" ON "inner_circle_links"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "inner_circle_links_owner_id_target_id_relation_type_key" ON "inner_circle_links"("owner_id", "target_id", "relation_type");

-- CreateIndex
CREATE INDEX "memory_bank_counterparty_id_idx" ON "memory_bank"("counterparty_id");

-- AddForeignKey
ALTER TABLE "inner_circle_links" ADD CONSTRAINT "inner_circle_links_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inner_circle_links" ADD CONSTRAINT "inner_circle_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
