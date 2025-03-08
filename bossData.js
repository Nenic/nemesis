import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import puppeteer from 'puppeteer';
import schedule from 'node-schedule';
import fetch from 'node-fetch'; // Remove if using Node 18+ (global fetch available)

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

// allBossData holds the complete boss data (both normal and raid)
let allBossData = [];
// globalBossData holds only normal bosses (after filtering out raid bosses)
let globalBossData = [];
// currentRaids holds the raid bosses to be displayed
let currentRaids = [];

// Reference to the message displaying the table
let tableMessage = null;

let db;

// Inicjalizujemy bazę danych, gdy bot jest gotowy
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    db = await initDB();
  });



/**
 * Formats elapsed time from lastReset.
 * - If less than 60 seconds, returns seconds (e.g., "30s")
 * - If between 60 and 3600 seconds, returns minutes (e.g., "5m")
 * - If 3600 seconds or more, returns hours (e.g., "2h")
 */
function formatTime(lastReset) {
  const diffSec = Math.floor((Date.now() - lastReset) / 1000);
  if (diffSec < 60) return diffSec + "s";
  else if (diffSec < 3600) return Math.floor(diffSec / 60) + "m";
  else return Math.floor(diffSec / 3600) + "h";
}

// Funkcja pomocnicza do parsowania daty.
// Jeśli wartość jest niezdefiniowana lub nie jest ciągiem, zwracamy null.
function parseLastAppearance(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      console.error(`Missing or invalid lastAppearance: ${dateStr}`);
      return null;
    }
    // Jeśli ciąg nie zawiera ":" (brak godziny), ustawiamy domyślnie 10:00.
    if (!dateStr.includes(":")) {
      return new Date(dateStr + "T10:00:00");
    }
    return new Date(dateStr);
  }
  
  // Funkcja zwracająca datę z przesunięciem – "dzień" liczony od 10:00
  function getAdjustedTimestamp(dateStr) {
    const d = parseLastAppearance(dateStr);
    return d ? new Date(d.getTime() - 10 * 3600 * 1000) : null;
  }
  
  // Oblicza różnicę w dniach z uwzględnieniem przesunięcia dnia (od 10:00)
  function diffDaysAdjusted(lastAppearance) {
    const now = new Date();
    const adjustedNow = new Date(now.getTime() - 10 * 3600 * 1000);
    const adjustedLast = getAdjustedTimestamp(lastAppearance);
    if (!adjustedLast) return null;
    return (adjustedNow - adjustedLast) / (3600 * 24 * 1000);
  }
  
  export async function calculateBossChance(boss) {
    const { minDays, maxDays, bossName, lastAppearance } = boss;
    // Parsujemy datę – jeśli jest nieprawidłowa, zwracamy "N/A"
    let oldDate = parseLastAppearance(lastAppearance);
    if (!oldDate) {
      console.error(`Invalid lastAppearance for ${bossName}: ${lastAppearance}`);
      return "N/A";
    }
    
    let diff = diffDaysAdjusted(lastAppearance);
    if (diff === null) {
      return "N/A";
    }
    
    let prefix = "";
    let chance = 0;
    
    if (diff < minDays) {
      chance = 0;
    } else if (diff <= maxDays) {
      chance = ((diff - minDays) / (maxDays - minDays)) * 100;
    } else {
      // Dodatkowy krok: jeśli diff jest większa niż maxDays
      const appearances = await db.all(
        "SELECT appearanceDate FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 25",
        [bossName]
      );
      if (appearances.length >= 2) {
        let totalInterval = 0;
        for (let i = 0; i < appearances.length - 1; i++) {
          const d1 = new Date(appearances[i].appearanceDate);
          const d2 = new Date(appearances[i + 1].appearanceDate);
          totalInterval += (d1 - d2) / (3600 * 24 * 1000);
        }
        const avgInterval = totalInterval / (appearances.length - 1);
        // Aktualizujemy datę ostatniego pojawienia, dodając średni interwał
        const newLastAppearance = new Date(oldDate.getTime() + avgInterval * 3600 * 24 * 1000);
        await db.run("UPDATE Bosses SET lastAppearance = ? WHERE bossName = ?", [
          newLastAppearance.toISOString(),
          bossName
        ]);
        diff = diffDaysAdjusted(newLastAppearance.toISOString());
        chance = ((diff - minDays) / (maxDays - minDays)) * 100;
        prefix = "~";
      } else {
        chance = 100;
      }
    }
    
    chance = Math.max(0, Math.min(chance, 100));
    return prefix + chance.toFixed(2) + "%";
  }

/**
 * Separates the complete boss list into normal bosses and raid bosses.
 * Raid bosses are:
 * - "Chizzoron the Distorter" or "Zulazza the Corruptor" → combined as raid "Zzaion"
 * - "Zomba" → raid "Zomba"
 * - "The Blightfather" → raid "Blightfather"
 * - "Grand Mother Foulscale" → raid "Foulscale"
 * Returns an object: { normal, raids }.
 */
export function separateRaidBosses(bosses) {
    const normal = [];
    const raidMap = new Map();
    
    bosses.forEach(boss => {
      // Używamy boss.bossName, jeśli istnieje, inaczej boss.name.
      const bossName = boss.bossName || boss.name;
      if (!bossName) return; // pomijamy rekordy bez nazwy
  
      const nameLower = bossName.toLowerCase();
      if (nameLower === "chizzoron the distorter" || nameLower === "zulazza the corruptor") {
        if (!raidMap.has("Zzaion") || boss.chance > raidMap.get("Zzaion").chance) {
          raidMap.set("Zzaion", { name: "Zzaion", chance: boss.chance });
        }
      } else if (nameLower === "zomba") {
        if (!raidMap.has("Zomba") || boss.chance > raidMap.get("Zomba").chance) {
          raidMap.set("Zomba", { name: "Zomba", chance: boss.chance });
        }
      } else if (nameLower === "the blightfather") {
        if (!raidMap.has("Blightfather") || boss.chance > raidMap.get("Blightfather").chance) {
          raidMap.set("Blightfather", { name: "Blightfather", chance: boss.chance });
        }
      } else if (nameLower === "grand mother foulscale") {
        if (!raidMap.has("Foulscale") || boss.chance > raidMap.get("Foulscale").chance) {
          raidMap.set("Foulscale", { name: "Foulscale", chance: boss.chance });
        }
      } else {
        normal.push(boss);
      }
    });
    
    const raids = Array.from(raidMap.values());
    return { normal, raids };
  }

/**
 * Formats the boss table (code block) with three columns: Name, Checked, and Player.
 * This table shows only normal bosses.
 */
export function formatBossTableWithoutRaids(data) {
    const headerBoss = "Boss Name";
    const headerChecked = "Checked";
    const headerPlayer = "Player";
  
    // Dla każdego bossa wybieramy nazwę z bossName lub name; jeśli obie są niezdefiniowane – ustawiamy "Unknown"
    const rows = data.map(boss => {
      const displayName = boss.bossName || boss.name || "Unknown";
      return {
        name: displayName,
        checked: formatTime(boss.lastReset),
        player: boss.player || ""
      };
    });
    
    let maxNameWidth = headerBoss.length;
    let maxCheckedWidth = headerChecked.length;
    let maxPlayerWidth = headerPlayer.length;
    
    rows.forEach(row => {
      if (row.name.length > maxNameWidth) maxNameWidth = row.name.length;
      if (row.checked.length > maxCheckedWidth) maxCheckedWidth = row.checked.length;
      if (row.player.length > maxPlayerWidth) maxPlayerWidth = row.player.length;
    });
    
    let table = "```" + "\n";
    table += headerBoss.padEnd(maxNameWidth + 2) +
             headerChecked.padEnd(maxCheckedWidth + 2) +
             headerPlayer.padEnd(maxPlayerWidth + 2) + "\n";
    table += "-".repeat(maxNameWidth + 2) +
             "-".repeat(maxCheckedWidth + 2) +
             "-".repeat(maxPlayerWidth + 2) + "\n";
    
    rows.forEach(row => {
      table += row.name.padEnd(maxNameWidth + 2) +
               row.checked.padEnd(maxCheckedWidth + 2) +
               row.player.padEnd(maxPlayerWidth + 2) + "\n";
    });
    table += "```";
    return table;
  }

/**
 * Formats a separate raids line in the form:
 * "Raids: RaidName1 Chance%, RaidName2 Chance%, ..."
 */
export function formatRaidsLine(raids) {
  if (raids.length > 0) {
    return "Raids: " + raids.map(r => `${r.name} ${r.chance.toFixed(2)}%`).join(", ");
  }
  return "";
}

/**
 * Creates buttons for each normal boss.
 * Button label is "Name Chance%" (e.g., "Zomba 78.84%") without parentheses.
 */
export function buildBossButtons(data) {
    const buttons = [];
    data.forEach((boss, index) => {
      // Jeśli boss.chance jest stringiem, usuń znaki ~, spacje i %
      let numericChance;
      if (typeof boss.chance === "string") {
        numericChance = parseInt(boss.chance.replace(/[~\s%]/g, ""));
      } else {
        numericChance = Math.floor(boss.chance);
      }
      // Utwórz etykietę przycisku: nazwa bossa i szansa z procentem
      const label = `${boss.bossName} ${numericChance}%`;
      const button = new ButtonBuilder()
        .setCustomId(`reset_${index}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);
      buttons.push(button);
    });
  
    // Tworzymy wiersze z maksymalnie 5 przyciskami w każdym
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
  }
/**
 * Fetches boss data from GuildStats.
 */
export async function fetchBossData(world = 'Secura') {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(
      `https://guildstats.eu/bosses?rook=0&world=${encodeURIComponent(world)}&bossType=3`,
      { waitUntil: 'networkidle2' }
    );
    
    const bossesToCheck = await page.evaluate(() => {
      const UNINTERESTING_BOSSES = new Set([
        'Apprentice Sheng',
        'Burster',
        'draptors',
        'Dreadful Disruptor',
        'Fernfang',
        'Munster',
        'Teleskor',
        'undead cavebears',
      ]);
      const NAME_MAPPINGS = new Map([
        ['man in the cave', 'Man in the Cave'],
        ['midnight panthers', 'midnight panther'],
        ['yetis', 'yeti'],
      ]);
      
      function toPrettyName(name) {
        const mapped = NAME_MAPPINGS.get(name.toLowerCase()) || name;
        return mapped.replaceAll(' The ', ' the ').replaceAll(' Of ', ' of ');
      }
      
      // This selector will select only rows with a span having "color: green; font-weight: bold"
      const rows = document.querySelectorAll('#myTable tr:has(span[style="color: green; font-weight: bold"])');
      const bosses = [];
      rows.forEach(row => {
        const boldElem = row.querySelector('b');
        if (!boldElem) return;
        const bossName = toPrettyName(boldElem.textContent.trim());
        if (UNINTERESTING_BOSSES.has(bossName)) return;
        
        const chanceCell = row.querySelector('td:has(span[style="color: green; font-weight: bold"]');
        if (!chanceCell) return;
        const chanceText = chanceCell.textContent.trim();
        if (chanceText === 'No') return;
        const match = chanceText.match(/([^%)]+)%/);
        if (!match) return;
        const percentage = Number(match[1]);
        bosses.push({ name: bossName, chance: percentage });
      });
      bosses.sort((a, b) => b.chance - a.chance);
      return bosses;
    });
    
    await browser.close();
    return {
      timestamp: new Date().toISOString(),
      bosses: bossesToCheck || []  // Ensure this is always an array
    };
  }
  

/**
 * Fetches kill statistics from TibiaData API.
 * Expects data in the form:
 * { killstatistics: { world: "Secura", entries: [ { race: ..., last_day_killed: ... }, ... ] } }
 */
export async function fetchKillStats() {
  const response = await fetch("https://api.tibiadata.com/v4/killstatistics/secura");
  const data = await response.json();
  console.log("TibiaData API response:", data);
  
  if (!data.killstatistics || !data.killstatistics.entries) {
    throw new Error("Kill statistics not found in response: " + JSON.stringify(data));
  }
  
  let bossStats = data.killstatistics.entries;
  if (!Array.isArray(bossStats)) {
    bossStats = [bossStats];
  }
  return bossStats;
}

/**
 * Oblicza procentową szansę na pojawienie się bossa dzisiaj.
 *
 * @param {Array} appearances - Tablica rekordów pojawień bossa, gdzie każdy rekord ma właściwość appearanceDate.
 *                                Założenie: rekordy są posortowane malejąco (najświeższy jako pierwszy).
 * @param {number} minDays - Minimalna liczba dni (np. 12).
 * @param {number} maxDays - Maksymalna liczba dni (np. 25).
 * @returns {Object} - Obiekt w postaci { bossName: "Tyrn(Darashia)", chance: "xx.xx" }.
 */
export function getBossSpawnChance(appearances, bossName = "Tyrn(Darashia)", minDays = 12, maxDays = 25) {
    if (!appearances || appearances.length === 0) {
      return { bossName, chance: "0.00" };
    }
    // Zakładamy, że pierwszy rekord zawiera datę ostatniego pojawienia
    const lastSpawnStr = appearances[0].appearanceDate || appearances[0].previousAppearDate;
    const lastSpawnDate = new Date(lastSpawnStr);
    const currentDate = new Date();
    
    // Obliczamy liczbę dni, które upłynęły
    const daysElapsed = Math.floor((currentDate - lastSpawnDate) / (1000 * 60 * 60 * 24));
    
    let chance = 0;
    if (daysElapsed < minDays) {
      chance = 0;
    } else if (daysElapsed >= maxDays) {
      chance = 100;
    } else {
      // Jeśli dni upłynęło pomiędzy minDays a maxDays, zakładamy równomierny rozkład
      chance = (1 / (maxDays - daysElapsed + 1)) * 100;
    }
    
    return { bossName, chance: chance.toFixed(2) };
  }