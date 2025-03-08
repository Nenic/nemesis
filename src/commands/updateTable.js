import { handleBossTable } from './bosstable.js';
import { getAllBossNames } from '../bossNames.js';

/**
 * Formatuje datę do formatu dd.MM.yyyy.
 * @param {Date} date 
 * @returns {string}
 */
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Normalizuje nazwę bossa – usuwa wszystko od "(" włącznie i zwraca małe litery.
 * Przykładowo "Fleabringer(NW)" → "fleabringer"
 * @param {string} name 
 * @returns {string}
 */
function normalizeBossName(name) {
  return name.split('(')[0].trim().toLowerCase();
}

/**
 * Zwraca przedział czasowy targetInterval:
 * targetStart = dzień poprzedni o 03:00,
 * targetEnd   = dzisiaj o 03:00.
 * Dzięki temu przyjmujemy, że bossy zabite między 03:00 a 03:00 (czyli w okresie poprzedniego dnia od 03:00 do dzisiejszego 03:00) są już zarejestrowane.
 * @param {Date} now 
 * @returns {{start: Date, end: Date}}
 */
function getTargetInterval(now) {
  const start = new Date(now);
  start.setDate(now.getDate() - 1);
  start.setHours(3, 0, 0, 0);
  
  const end = new Date(now);
  end.setHours(3, 0, 0, 0);
  
  return { start, end };
}

/**
 * Zwraca datę dla nowego wpisu – ustawioną na dzień poprzedni o godzinie 15:00.
 * @param {Date} now 
 * @returns {Date}
 */
function getNewAppearanceTime(now) {
  const appearance = new Date(now);
  appearance.setDate(now.getDate() - 1);
  appearance.setHours(15, 0, 0, 0);
  return appearance;
}

/**
 * Główna funkcja handleUpdateTable:
 * 1. Pobiera dane z API.
 * 2. Z listy API wybiera bossy z last_day_killed > 0, które przy normalizacji znajdują się na liście z bossNames.js.
 * 3. Dla każdego takiego bossa sprawdza, czy w bazie danych istnieje już rekord (bez względu na godzinę) w przedziale targetInterval,
 *    czyli od dnia poprzedniego o 03:00 do dzisiejszego o 03:00.
 * 4. Jeśli nie ma takiego wpisu, dodaje nowy rekord z appearanceDate ustawionym na dzień poprzedni o godzinie 15:00.
 * 5. Na końcu pobiera unikalne bossy z bazy, które mają appearanceDate w targetInterval i wysyła komunikat.
 * 
 * @param {object} db - połączenie z bazą danych
 * @param {object} message - obiekt wiadomości Discord, na którym wysyłamy komunikat
 */
export async function handleUpdateTable(db, message) {
  const now = new Date();
  const { start: targetStart, end: targetEnd } = getTargetInterval(now);
  const newAppearanceTime = getNewAppearanceTime(now);
  
  let apiData;
  try {
    const res = await fetch("https://api.tibiadata.com/v4/killstatistics/secura");
    apiData = await res.json();
  } catch (error) {
    console.error("Błąd podczas pobierania danych z API:", error);
    return message.channel.send("Wystąpił błąd podczas pobierania danych z API.");
  }
  
  const entries = apiData?.killstatistics?.entries;
  if (!entries) {
    return message.channel.send("Nie udało się pobrać danych z API.");
  }
  
  // Lista bossów z bossNames.js (normalized)
  const validBosses = getAllBossNames().map(normalizeBossName);
  
  // Z API wybieramy tylko bossy, które mają last_day_killed > 0 i należą do validBosses
  let apiBosses = [];
  for (const entry of entries) {
    let apiBoss = entry.race.trim();
    const kills = entry.last_day_killed;
    if (kills <= 0) continue;
    if (!validBosses.includes(normalizeBossName(apiBoss))) continue;
    // Unikamy duplikatów
    if (!apiBosses.some(b => normalizeBossName(b) === normalizeBossName(apiBoss))) {
      apiBosses.push(apiBoss);
    }
  }
  
  // Dla każdego bossa z listy API sprawdzamy, czy w bazie jest wpis w przedziale targetInterval.
  for (const bossName of apiBosses) {
    const baseName = normalizeBossName(bossName);
    // Pobieramy wszystkie rekordy z bazy, gdzie bossName zaczyna się od baseName (przyjmujemy, że taki rekord ma bazową nazwę na początku)
    const records = await db.all(
      "SELECT appearanceDate, bossName FROM Appearances WHERE lower(bossName) LIKE ? ORDER BY appearanceDate DESC",
      [`${baseName}%`]
    );
    let found = false;
    for (const rec of records) {
      const recDate = new Date(rec.appearanceDate);
      if (recDate >= targetStart && recDate < targetEnd) {
        found = true;
        break;
      }
    }
    if (!found) {
      // Jeśli nie znaleziono wpisu dla tego bossa w targetInterval, dodajemy rekord z newAppearanceTime.
      await db.run(
        "INSERT INTO Appearances (bossName, appearanceDate) VALUES (?, ?)",
        [bossName, newAppearanceTime.toISOString()]
      );
    }
  }
  
  // Pobieramy unikalne bossy, których appearanceDate jest w targetInterval
  const killedBossesRows = await db.all(
    "SELECT DISTINCT bossName FROM Appearances WHERE appearanceDate >= ? AND appearanceDate < ?",
    [targetStart.toISOString(), targetEnd.toISOString()]
  );
  
  // Filtrujemy – pozostawiamy tylko te, których znormalizowana nazwa jest w validBosses.
  const killedBosses = killedBossesRows
    .filter(row => validBosses.includes(normalizeBossName(row.bossName)))
    .map(row => row.bossName)
    .join(", ") || "brak";
  
  // Wyświetlamy komunikat – data z targetStart (dzień poprzedni)
  const formattedDate = formatDate(targetStart);
  await message.channel.send(`Baza danych została zaktualizowana, bosy zabite (${formattedDate}) to: ${killedBosses}`);
}
