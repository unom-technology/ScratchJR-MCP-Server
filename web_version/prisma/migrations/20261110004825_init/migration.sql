-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    "idCursor" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "userId" INTEGER NOT NULL,
    "localId" INTEGER NOT NULL,
    "ctime" TEXT,
    "mtime" TEXT,
    "altmd5" TEXT,
    "pos" INTEGER,
    "name" TEXT,
    "json" TEXT,
    "thumbnail" TEXT,
    "owner" TEXT,
    "gallery" TEXT,
    "deleted" TEXT,
    "version" TEXT,
    "isgift" INTEGER,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "localId"),
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shape" (
    "userId" INTEGER NOT NULL,
    "localId" INTEGER NOT NULL,
    "ctime" TEXT,
    "md5" TEXT,
    "altmd5" TEXT,
    "width" TEXT,
    "height" TEXT,
    "ext" TEXT,
    "name" TEXT,
    "owner" TEXT,
    "scale" TEXT,
    "version" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "localId"),
    CONSTRAINT "Shape_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Background" (
    "userId" INTEGER NOT NULL,
    "localId" INTEGER NOT NULL,
    "ctime" TEXT,
    "md5" TEXT,
    "altmd5" TEXT,
    "width" TEXT,
    "height" TEXT,
    "ext" TEXT,
    "owner" TEXT,
    "version" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "localId"),
    CONSTRAINT "Background_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "name"),
    CONSTRAINT "MediaFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
