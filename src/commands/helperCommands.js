// src/commands/helperCommands.js
import { handleBossTable } from './bosstable.js';

/**
 * Komenda !showLast <bossName>
 * Pobiera z bazy trzy ostatnie pojawienia się danego bossa
 * i wysyła je jako wiadomość.
 *
 * Użycie: !showLast BossName
 *
 * @param {object} db - połączenie z bazą danych
 * @param {object} message - obiekt wiadomości Discord
 */
export async function showLastCommand(db, message) {
  const args = message.content.split(" ");
  if (args.length < 2) {
    return message.channel.send("Poprawne użycie: !showLast <bossName>");
  }
  const bossName = args.slice(1).join(" ");
  try {
    // Pobieramy ostatnie 3 pojawienia się
    const rows = await db.all(
      "SELECT * FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 3",
      [bossName]
    );
    if (!rows || rows.length === 0) {
      return message.channel.send(`Brak zapisanych pojawień dla bossa ${bossName}.`);
    }
    const response = rows
      .map(row => `ID: ${row.id} - Data: ${row.appearanceDate}`)
      .join("\n");
    return message.channel.send(`Ostatnie 3 pojawienia się bossa ${bossName}:\n${response}`);
  } catch (error) {
    console.error("Błąd przy pobieraniu pojawień:", error);
    return message.channel.send("Wystąpił błąd przy pobieraniu danych.");
  }
}

/**
 * Komenda !revertKill <bossName>
 * Usuwa ostatnie pojawienie się bossa i wymusza odświeżenie tabeli.
 *
 * Użycie: !revertKill <bossName>
 *
 * @param {object} db - połączenie z bazą danych
 * @param {object} message - obiekt wiadomości Discord
 */
export async function revertKillCommand(db, message) {
  const args = message.content.split(" ");
  if (args.length < 2) {
    return message.channel.send("Poprawne użycie: !revertKill <bossName>");
  }
  const bossName = args.slice(1).join(" ");
  try {
    // Pobieramy ostatni rekord pojawienia się bossa
    const row = await db.get(
      "SELECT id, appearanceDate FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 1",
      [bossName]
    );
    if (!row) {
      return message.channel.send(`Brak zapisanych pojawień dla bossa ${bossName}.`);
    }
    // Usuwamy rekord o danym id
    await db.run("DELETE FROM Appearances WHERE id = ?", [row.id]);
    await message.channel.send(`Usunięto ostatnie pojawienie się bossa ${bossName} (data: ${row.appearanceDate}).`);
  } catch (error) {
    console.error("Błąd przy usuwaniu pojawienia:", error);
    return message.channel.send("Wystąpił błąd podczas usuwania pojawienia.");
  }
}

/**
 * Komenda !deleteData <bossName>
 * Usuwa wszystkie rekordy dotyczące podanego bossa – zarówno z tabeli Appearances, jak i Bosses.
 *
 * Użycie: !deleteData BossName
 *
 * @param {object} db - połączenie z bazą danych
 * @param {object} message - obiekt wiadomości Discord
 */
export async function deleteDataCommand(db, message) {
    const args = message.content.split(" ");
    if (args.length < 2) {
      return message.channel.send("Poprawne użycie: !deleteData <bossName>");
    }
    const bossName = args.slice(1).join(" ").trim();
    
    try {
      // Usuwamy wszystkie pojawienia się bossa
      await db.run("DELETE FROM Appearances WHERE bossName = ?", [bossName]);
      // Usuwamy bossa z tabeli Bosses (opcjonalnie – zależy czy chcemy usunąć również konfigurację bossa)
      await db.run("DELETE FROM Bosses WHERE bossName = ?", [bossName]);
      message.channel.send(`Dane dla bossa "${bossName}" zostały usunięte.`);
    } catch (error) {
      console.error("Błąd podczas usuwania danych:", error);
      message.channel.send("Wystąpił błąd podczas usuwania danych.");
    }
  }

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
 * Komenda !addAppearance <bossName> [yyyy-MM-dd]
 * Dodaje pojawienie się bossa do bazy danych.
 * Jeśli data nie zostanie podana lub ostatni argument nie jest datą w formacie yyyy-MM-dd,
 * użyta zostanie bieżąca data z ustawioną godziną 15:00.
 *
 * Przykład:
 *   !addAppearance Battlemaster Zunzu(East) 2025-03-06
 *   !addAppearance Dharalion
 *
 * @param {object} db - połączenie z bazą danych
 * @param {object} message - obiekt wiadomości Discord
 */
export async function addAppearanceCommand(db, message) {
    const args = message.content.split(" ").slice(1); // usuwamy komendę
    
    if (args.length === 0) {
      return message.channel.send("Poprawne użycie: !addAppearance <bossName> [yyyy-MM-dd]");
    }
    
    // Sprawdzamy, czy ostatni argument pasuje do formatu yyyy-MM-dd
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    let dateArg = null;
    if (datePattern.test(args[args.length - 1])) {
      dateArg = args.pop();
    }
    
    // Pozostałe argumenty łączymy jako nazwa bossa (zachowujemy spacje i ewentualne nawiasy)
    const bossName = args.join(" ").trim();
    
    // Jeśli data nie została podana, używamy bieżącej daty
    let appearanceDate = dateArg ? new Date(dateArg + "T00:00:00") : new Date();
    
    if (isNaN(appearanceDate.getTime())) {
      return message.channel.send("Nieprawidłowy format daty. Użyj formatu yyyy-MM-dd.");
    }
    
    // Ustawiamy godzinę domyślną na 15:00
    appearanceDate.setHours(15, 0, 0, 0);
    
    try {
      await db.run(
        "INSERT INTO Appearances (bossName, appearanceDate) VALUES (?, ?)",
        [bossName, appearanceDate.toISOString()]
      );
      message.channel.send(`Dodano pojawienie się bossa "${bossName}" z datą ${appearanceDate.toISOString().slice(0,10)}`);
    } catch (error) {
      console.error("Błąd podczas dodawania pojawienia:", error);
      message.channel.send("Wystąpił błąd podczas dodawania pojawienia.");
    }
  }