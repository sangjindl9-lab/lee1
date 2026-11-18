-- CreateTable
CREATE TABLE "MockPgTx" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderNo" TEXT,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockPgTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MockPgTx_txId_key" ON "MockPgTx"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "MockPgTx_idempotencyKey_key" ON "MockPgTx"("idempotencyKey");
