import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function columnExists(db, tableName, columnName) {
  const info = await db.all(`PRAGMA table_info(${tableName});`);
  return info.some(col => col.name === columnName);
}

export async function initDB() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  // Tworzymy tabelę Bosses z kolumnami: bossName, minimalDays, maximalDays, lastChecked oraz lastChecker
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Bosses (
      bossName TEXT PRIMARY KEY,
      minimalDays INTEGER,
      maximalDays INTEGER,
      lastChecked INTEGER,
      lastChecker TEXT
    );
  `);

  // Dodajemy kolumny, jeśli nie istnieją
  if (!await columnExists(db, 'Bosses', 'minimalDays')) {
    await db.exec(`ALTER TABLE Bosses ADD COLUMN minimalDays INTEGER;`);
  }
  if (!await columnExists(db, 'Bosses', 'maximalDays')) {
    await db.exec(`ALTER TABLE Bosses ADD COLUMN maximalDays INTEGER;`);
  }
  if (!await columnExists(db, 'Bosses', 'lastChecked')) {
    await db.exec(`ALTER TABLE Bosses ADD COLUMN lastChecked INTEGER;`);
  }
  if (!await columnExists(db, 'Bosses', 'lastChecker')) {
    await db.exec(`ALTER TABLE Bosses ADD COLUMN lastChecker TEXT;`);
  }

  // Tworzymy tabelę Appearances do przechowywania zapisów pojawień bossa
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Appearances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bossName TEXT NOT NULL,
      appearanceDate TEXT NOT NULL,
      FOREIGN KEY (bossName) REFERENCES Bosses(bossName)
    );
  `);

  return db;
}

export async function upsertBoss(db, bossName, minimalDays, maximalDays) {
  await db.run(
    `INSERT INTO Bosses (bossName, minimalDays, maximalDays)
     VALUES (?, ?, ?)
     ON CONFLICT(bossName) DO UPDATE SET
       minimalDays = excluded.minimalDays,
       maximalDays = excluded.maximalDays;`,
    [bossName, minimalDays, maximalDays]
  );
}

export async function addAppearance(db, bossName, appearanceDate) {
  await db.run(
    `INSERT INTO Appearances (bossName, appearanceDate)
     VALUES (?, ?)`,
    [bossName, appearanceDate]
  );
}

export async function getLast25Appearances(db, bossName) {
  const rows = await db.all(
    `SELECT * FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 25`,
    [bossName]
  );
  return rows;
}

export async function deleteDataForBoss(db, bossName) {
  await db.run("DELETE FROM Appearances WHERE bossName = ?", [bossName]);
  await db.run("DELETE FROM Bosses WHERE bossName = ?", [bossName]);
}
