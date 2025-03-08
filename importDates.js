// importDates.js

// Import funkcji do obsługi bazy danych
import { initDB, upsertBoss, addAppearance, getLast25Appearances } from './src/database.js';
// Import konfiguracji bossów
import { bossConfig } from './src/bossConfig.js';

// Przykładowa lista dat (każda data jako ciąg znaków)
const dates = [
  "2025-02-22 17:51",
  "2025-02-07 05:11",
  "2025-01-25 01:42",
  "2025-01-10 23:30",
  "2024-12-27 02:21",
  "2024-12-11 20:03",
  "2024-11-28 14:54",
  "2024-11-14 23:38",
  "2024-10-29 19:50",
  "2024-10-17 17:20",
  "2024-10-04 04:18",
  "2024-09-18 15:05",
  "2024-09-04 12:45",
  "2024-08-19 14:28",
  "2024-08-05 21:10",
  "2024-07-21 06:53",
  "2024-07-06 18:09",
  "2024-06-24 05:26",
  "2024-06-12 01:44",
  "2024-05-30 12:14",
  "2024-05-17 07:50",
  "2024-05-03 10:26"
  ];
  
  

(async () => {
  // Inicjalizuj połączenie z bazą
  const db = await initDB();
  
  // Wybierz bossa – przykładowo "Tyrn(Darashia)"
  const bossName = "Rotworm Queen(Liberty Bay)";
  
  // Pobierz konfigurację dla tego bossa z bossConfig.js lub ustaw domyślne wartości
  const config = bossConfig[bossName] || { minDays: 1, maxDays: 17 };

  // Uaktualnij lub wstaw rekord bossa z konfiguracją (upsert)
  await upsertBoss(db, bossName, config.minDays, config.maxDays);
  console.log(`Zaktualizowano konfigurację dla bossa "${bossName}": minDays = ${config.minDays}, maxDays = ${config.maxDays}.`);
  
  // Dodaj wszystkie daty pojawień bossa do tabeli Appearances
  for (const date of dates) {
    await addAppearance(db, bossName, date);
  }
  console.log(`Dodano ${dates.length} rekordów pojawień dla bossa "${bossName}".`);

  // Opcjonalnie: pobierz ostatnie 25 pojawień i wypisz je w konsoli
  const last25 = await getLast25Appearances(db, bossName);
  console.log(`Ostatnie pojawienia bossa "${bossName}":`);
  last25.forEach(record => console.log(record.appearanceDate));
  
  await db.close();
})();
