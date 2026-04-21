-- DropIndex
DROP INDEX "yearly_headlines_year_type_category_key";

-- AlterTable
ALTER TABLE "worlds" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "name" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;
