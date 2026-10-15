-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('general_question', 'technical_question', 'refund_request');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "category" "TicketCategory";
