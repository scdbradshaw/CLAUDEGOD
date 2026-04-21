-- DropForeignKey
ALTER TABLE "factions" DROP CONSTRAINT "factions_founder_id_fkey";

-- DropForeignKey
ALTER TABLE "religions" DROP CONSTRAINT "religions_founder_id_fkey";

-- AlterTable
ALTER TABLE "factions" ALTER COLUMN "founder_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "religions" ALTER COLUMN "founder_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "religions" ADD CONSTRAINT "religions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factions" ADD CONSTRAINT "factions_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
