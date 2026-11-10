-- CreateTable
CREATE TABLE "Score" (
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "outOf" INTEGER NOT NULL,
    "comment" TEXT,
    "projectMtime" TEXT,
    "scoredById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "projectId"),
    CONSTRAINT "Score_userId_projectId_fkey" FOREIGN KEY ("userId", "projectId") REFERENCES "Project" ("userId", "localId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_scoredById_fkey" FOREIGN KEY ("scoredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Score_scoredById_idx" ON "Score"("scoredById");

