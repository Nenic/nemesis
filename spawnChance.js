import { bossConfig } from './src/bossConfig.js';
import { addAppearance } from './src/database.js';

/**
 * Oblicza średni interwał (w dniach) między kolejnymi pojawieniami bossa
 * na podstawie listy appearanceRecords (posortowanych malejąco – najnowszy pierwszy).
 *
 * @param {Array} appearanceRecords - tablica rekordów, gdzie każdy rekord zawiera appearanceDate
 * @returns {number} - średnia liczba dni między kolejnymi pojawieniami
 */

// Funkcja pomocnicza do parsowania daty bossa.
// Jeśli data nie zawiera godziny lub godzina jest pusta, ustawiamy domyślnie "T10:00:00".
// Przykładowa funkcja parsująca datę.
// Jeśli data nie zawiera znaku "T" (czyli nie jest w formacie ISO),
// to zakładamy, że jest w formacie "yyyy-MM-dd" lub "yyyy-MM-dd hh:mm"
// i odpowiednio ją modyfikujemy, aby ustawić domyślny czas (10:00)
function parseBossDate(dateStr) {
    if (!dateStr) {
      console.error("Brak daty wejściowej");
      return new Date();
    }
    dateStr = dateStr.trim();
    if (!dateStr.includes("T")) {
      // Jeśli mamy tylko datę (np. "2025-02-19")
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        dateStr = dateStr + "T10:00:00";
      }
      // Jeśli mamy datę i godzinę oddzielone spacją (np. "2025-02-19 09:00")
      else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(dateStr)) {
        dateStr = dateStr.replace(/\s+/, "T");
      }
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      console.error("Nie można sparsować daty:", dateStr);
    }
    return d;
  }
  
  // Funkcja, która koryguje datę – jeśli godzina jest przed 10:00, odejmujemy jeden dzień
  // i ustawiamy godzinę na 10:00
  function adjustBossDate(d) {
    if (d.getHours() < 10) {
      d.setDate(d.getDate() - 1);
      d.setHours(10, 0, 0, 0);
    }
    return d;
  }
  
  // Funkcja obliczająca średni interwał (w dniach) między kolejnymi pojawieniami bossa
  function calculateAverageInterval(lastAppearances) {
    if (!lastAppearances || lastAppearances.length < 2) return 0;
    let intervals = [];
    for (let i = 0; i < lastAppearances.length - 1; i++) {
      const d1 = parseBossDate(lastAppearances[i].appearanceDate);
      const d2 = parseBossDate(lastAppearances[i + 1].appearanceDate);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        intervals.push((d1 - d2) / (1000 * 60 * 60 * 24));
      }
    }
    if (intervals.length === 0) return 0;
    const sum = intervals.reduce((acc, cur) => acc + cur, 0);
    return sum / intervals.length;
  }
  
  export async function getBossSpawnChanceUpdated(db, bossName, lastAppearances) {
    // Pobieramy konfigurację z bossConfig; jeśli nie ma wpisu, używamy domyślnych wartości
    const config = bossConfig[bossName] || { minDays: 12, maxDays: 25 };
    const { minDays, maxDays } = config;
  
    if (!lastAppearances || lastAppearances.length === 0) {
      console.error("Brak danych o pojawieniach dla", bossName);
      return { bossName, chance: "0%" };
    }
  
    let lastAppearanceStr = lastAppearances[0].appearanceDate;
    if (!lastAppearanceStr) {
      console.error("Brak appearanceDate dla", bossName, lastAppearances[0]);
      return { bossName, chance: "0%" };
    }
  
    let lastAppearance = parseBossDate(lastAppearanceStr);
    lastAppearance = adjustBossDate(lastAppearance);
  
    const now = new Date();
    // Obliczamy, ile dni minęło (wliczając dzisiejszy dzień)
    let daysElapsed = Math.floor((now - lastAppearance) / (1000 * 60 * 60 * 24));
    console.log(`Boss: ${bossName}, ostatnie pojawienie: ${lastAppearance.toISOString()}, dni: ${daysElapsed}`);
  
    // Jeśli dni przekraczają maxDays, obliczamy średni interwał i aktualizujemy rekord
    if (daysElapsed > maxDays) {
      const avgInterval = calculateAverageInterval(lastAppearances);
      const effectiveInterval = (!avgInterval || avgInterval <= 0 || isNaN(avgInterval)) ? maxDays : avgInterval;
      const newExpected = new Date(lastAppearance.getTime() + effectiveInterval * 24 * 60 * 60 * 1000);
      console.log(`Aktualizacja pojawienia dla ${bossName}: nowa oczekiwana data: ${newExpected.toISOString()}`);
      await addAppearance(db, bossName, newExpected.toISOString());
      lastAppearance = newExpected;
      daysElapsed = Math.floor((now - lastAppearance) / (1000 * 60 * 60 * 24));
    }
  
    // Obliczamy szansę na pojawienie – jeśli dni są mniejsze niż minDays, szansa = 0,
    // jeśli dni >= maxDays, szansa = 100, w przeciwnym razie obliczamy wzorem
    let chance = 0;
    if (daysElapsed < minDays) {
      chance = 0;
    } else if (daysElapsed >= maxDays) {
      chance = 100;
    } else {
      chance = (1 / (maxDays - daysElapsed + 1)) * 100;
    }
  
    if (isNaN(chance)) {
      console.error(`Błąd przy obliczaniu szansy dla ${bossName}: daysElapsed=${daysElapsed}, minDays=${minDays}, maxDays=${maxDays}`);
      chance = 0;
    }
  
    // Zwracamy wynik jako procent bez miejsc po przecinku i z "%" na końcu
    return { bossName, chance: chance.toFixed(0) + "%" };
  }