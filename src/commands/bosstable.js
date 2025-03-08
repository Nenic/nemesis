// src/commands/bosstable.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { bossConfig } from '../bossConfig.js';

let tableMessage = null;
let buttonMessagePACC = null;
let buttonMessageFACC = null;
let updateInterval = null;
let buttonCollectorPACC = null;
let buttonCollectorFACC = null;

/**
 * Zwraca efektywną datę wg reguły:
 * jeśli godzina < 10, odejmujemy jeden dzień i ustawiamy czas na 00:00.
 */
function getEffectiveDate(date) {
  const effective = new Date(date);
  if (effective.getHours() < 10) {
    effective.setDate(effective.getDate() - 1);
  }
  effective.setHours(0, 0, 0, 0);
  return effective;
}

/**
 * Oblicza liczbę pełnych dni między dwiema datami.
 */
function daysBetween(date1, date2) {
  const diffMs = date1 - date2;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Zwraca emoji wskaźnika w zależności od czasu, który upłynął od lastChecked.
 * Przyjmujemy:
 *   <1 min → 🟩, 1-5 min → ⬜, 5-15 min → 🟨, 15-30 min → 🟧, 30 min-1h → 🟥, 1h+ → 🌸.
 */
function getStatusIndicator(lastChecked) {
  if (!lastChecked) return "🌸";
  const diffMinutes = (Date.now() - lastChecked) / 60000;
  if (diffMinutes < 1) return "🟩";
  else if (diffMinutes < 5) return "⬜";
  else if (diffMinutes < 15) return "🟨";
  else if (diffMinutes < 30) return "🟧";
  else if (diffMinutes < 60) return "🟥";
  else return "🌸";
}

/**
 * Buduje tekst tabeli z listą bossów oraz legendą.
 */
function buildTable(bossData) {
  let tableStr = "";
  bossData.forEach(boss => {
    const namePadded = boss.bossName.padEnd(18, ' ');
    const status = getStatusIndicator(boss.lastChecked);
    const checker = boss.lastChecker ? ` <@${boss.lastChecker}>` : "";
    tableStr += `${namePadded}  ${status}${checker}\n`;
  });
  tableStr += "\nLegenda:\n";
  tableStr += "🟩 <1min | ⬜ 1-5min | 🟨 5-15min | 🟧 15-30min | 🟥 30min-1h | 🌸 1h+ lub nie sprawdzony\n";
  return tableStr;
}

/**
 * Buduje przyciski na podstawie podanej grupy bossów.
 */
function buildButtonsForGroup(groupBossData) {
  let actionRows = [];
  let currentRow = new ActionRowBuilder();
  groupBossData.forEach((boss, index) => {
    const button = new ButtonBuilder()
      .setCustomId(`reset_${boss.bossName}`)
      .setLabel(`${boss.bossName} ${boss.chance}%`)
      .setStyle(ButtonStyle.Primary);
    currentRow.addComponents(button);
    if ((index + 1) % 5 === 0) {
      actionRows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });
  if (currentRow.components.length > 0) actionRows.push(currentRow);
  // Ograniczenie do 5 wierszy (max 25 przycisków)
  if (actionRows.length > 5) {
    actionRows = actionRows.slice(0, 5);
  }
  return actionRows;
}

/**
 * Grupuje bossData według strefy na podstawie konfiguracji z bossConfig.
 * Zwraca obiekt: { PACC: [...], FACC: [...] }.
 */
function groupByZone(bossData) {
  const groups = { PACC: [], FACC: [] };
  bossData.forEach(boss => {
    const config = bossConfig[boss.bossName];
    if (config && config.zone === "PACC") groups.PACC.push(boss);
    else if (config && config.zone === "FACC") groups.FACC.push(boss);
  });
  return groups;
}

/**
 * Funkcja loadBossData pobiera stan z bazy i buduje tablicę bossData.
 * Dla każdego bossa oblicza % szansy – jeśli daysElapsed > boss.maximalDays,
 * pobiera ostatnie 10 pojawień, oblicza średni interwał i ustawia flagę tilde.
 * Informacje o lastChecked oraz lastChecker są odczytywane z tabeli Bosses.
 *
 * @param {object} db - połączenie z bazą danych.
 * @returns {Promise<Array>} - tablica obiektów bossData.
 */
async function loadBossData(db) {
  const now = new Date();
  const effectiveToday = getEffectiveDate(now);
  const bosses = await db.all("SELECT * FROM Bosses");
  let bossData = [];
  for (const boss of bosses) {
    const lastAppearanceRow = await db.get(
      "SELECT appearanceDate FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 1",
      [boss.bossName]
    );
    if (!lastAppearanceRow) continue;
    const appearanceDate = new Date(lastAppearanceRow.appearanceDate);
    const effectiveAppearance = getEffectiveDate(appearanceDate);
    let daysElapsed = daysBetween(effectiveToday, effectiveAppearance);
    let flagTilde = false;
    if (daysElapsed > boss.maximalDays) {
      const lastTen = await db.all(
        "SELECT appearanceDate FROM Appearances WHERE bossName = ? ORDER BY appearanceDate DESC LIMIT 10",
        [boss.bossName]
      );
      if (lastTen.length > 1) {
        let sumDiff = 0;
        let countDiff = 0;
        for (let i = 0; i < lastTen.length - 1; i++) {
          let d1 = new Date(lastTen[i].appearanceDate);
          let d2 = new Date(lastTen[i+1].appearanceDate);
          d1.setHours(0, 0, 0, 0);
          d2.setHours(0, 0, 0, 0);
          let diff = daysBetween(d1, d2);
          sumDiff += diff;
          countDiff++;
        }
        if (countDiff > 0) {
          let avgInterval = sumDiff / countDiff;
          let lastApp = new Date(lastTen[0].appearanceDate);
          let predictedDate = new Date(lastApp);
          predictedDate.setDate(predictedDate.getDate() + avgInterval);
          let predictedDays = daysBetween(predictedDate, effectiveToday);
          daysElapsed = predictedDays;
          flagTilde = true;
          // Wstawiamy predicted record, jeśli jeszcze nie ma wpisu dla effectiveToday
          const targetDateStr = effectiveToday.toISOString().slice(0,10);
          const countPred = await db.get(
            "SELECT COUNT(*) as count FROM Appearances WHERE bossName = ? AND appearanceDate LIKE ?",
            [boss.bossName, `${targetDateStr}%`]
          );
          if (countPred.count === 0) {
            await db.run(
              "INSERT INTO Appearances (bossName, appearanceDate) VALUES (?, ?)",
              [boss.bossName, predictedDate.toISOString()]
            );
          }
        }
      }
    }
    let chancePercentage = 0;
    if (boss.maximalDays === boss.minimalDays) {
      chancePercentage = 100;
    } else {
      chancePercentage = ((daysElapsed - boss.minimalDays + 1) / (boss.maximalDays - boss.minimalDays + 1)) * 100;
      chancePercentage = Math.round(chancePercentage);
    }
    if(chancePercentage >0){
    bossData.push({
      bossName: boss.bossName,
      chance: flagTilde ? `~${chancePercentage}` : `${chancePercentage}`,
      lastChecked: boss.lastChecked || null,
      lastChecker: boss.lastChecker || null
    });
  }
}
  return bossData;
}

/**
 * Główna funkcja handleBossTable:
 * - Pobiera stan z bazy (loadBossData) i aktualizuje interfejs (tabela i przyciski).
 * - Ustawia interwał co minutę, który pobiera najnowsze dane z bazy i odświeża interfejs.
 * - Przy kliknięciu przycisku aktualizuje stan w bazie (lastChecked, lastChecker) i odświeża interfejs.
 *
 * @param {object} db - połączenie z bazą danych.
 * @param {object} message - obiekt wiadomości Discord.
 */
export async function handleBossTable(db, message) {
  let bossData = await loadBossData(db);
  
  // Aktualizacja tabeli (jedna wiadomość tekstowa)
  const tableContent = buildTable(bossData);
  if (tableMessage) {
    try {
      await tableMessage.edit({ content: tableContent });
    } catch (error) {
      if (error.code === 10008) {
        tableMessage = await message.channel.send({ content: tableContent });
      }
    }
  } else {
    tableMessage = await message.channel.send({ content: tableContent });
  }
  
  // Grupujemy bossData według zone (PACC i FACC)
  const groups = { PACC: [], FACC: [] };
  bossData.forEach(boss => {
    const config = bossConfig[boss.bossName];
    if (config) {
      if (config.zone === "PACC") groups.PACC.push(boss);
      else if (config.zone === "FACC") groups.FACC.push(boss);
    }
  });
  
  // Aktualizacja przycisków – osobne wiadomości dla PACC i FACC
  // Dla PACC
  const buttonsPACC = buildButtonsForGroup(groups.PACC);
  if (buttonMessagePACC) {
    try {
      await buttonMessagePACC.edit({ content: "", components: buttonsPACC });
    } catch (error) {
      if (error.code === 10008) {
        buttonMessagePACC = await message.channel.send({ content: "", components: buttonsPACC });
        startCollector("PACC");
      }
    }
  } else {
    buttonMessagePACC = await message.channel.send({ content: "", components: buttonsPACC });
    startCollector("PACC");
  }
  // Dla FACC
  const buttonsFACC = buildButtonsForGroup(groups.FACC);
  if (buttonMessageFACC) {
    try {
      await buttonMessageFACC.edit({ content: "", components: buttonsFACC });
    } catch (error) {
      if (error.code === 10008) {
        buttonMessageFACC = await message.channel.send({ content: "", components: buttonsFACC });
        startCollector("FACC");
      }
    }
  } else {
    buttonMessageFACC = await message.channel.send({ content: "", components: buttonsFACC });
    startCollector("FACC");
  }
  
  // Ustawiamy interwał – co minutę pobieramy stan z bazy i odświeżamy interfejs
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async () => {
    try {
      bossData = await loadBossData(db);
      if (tableMessage) await tableMessage.edit({ content: buildTable(bossData) });
      const groups = { PACC: [], FACC: [] };
      bossData.forEach(boss => {
        const config = bossConfig[boss.bossName];
        if (config) {
          if (config.zone === "PACC") groups.PACC.push(boss);
          else if (config.zone === "FACC") groups.FACC.push(boss);
        }
      });
      if (buttonMessagePACC) await buttonMessagePACC.edit({ content: "", components: buildButtonsForGroup(groups.PACC) });
      if (buttonMessageFACC) await buttonMessageFACC.edit({ content: "", components: buildButtonsForGroup(groups.FACC) });
    } catch (error) {
      console.error("Błąd podczas aktualizacji interfejsu:", error);
    }
  }, 60000);
  
  // Funkcja budująca przyciski dla danej grupy bossów
  function buildButtonsForGroup(groupData) {
    if (!groupData || groupData.length === 0) return [];
    let actionRows = [];
    let currentRow = new ActionRowBuilder();
    groupData.forEach((boss, index) => {
      const button = new ButtonBuilder()
        .setCustomId(`reset_${boss.bossName}`)
        .setLabel(`${boss.bossName} ${boss.chance}%`)
        .setStyle(ButtonStyle.Primary);
      currentRow.addComponents(button);
      if ((index + 1) % 5 === 0) {
        actionRows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
    });
    if (currentRow.components.length > 0) actionRows.push(currentRow);
    if (actionRows.length > 5) {
      actionRows = actionRows.slice(0, 5);
    }
    return actionRows;
  }
  
  // Funkcja startCollector – uruchamia collector przycisków dla konkretnej strefy ("PACC" lub "FACC")
  function startCollector(zone) {
    let targetMessage;
    if (zone === "PACC") targetMessage = buttonMessagePACC;
    else if (zone === "FACC") targetMessage = buttonMessageFACC;
    if (!targetMessage) return;
    const collector = targetMessage.createMessageComponentCollector({ time: 3600000 });
    collector.on("collect", async interaction => {
      if (!interaction.isButton()) return;
      const customId = interaction.customId;
      if (customId.startsWith("reset_")) {
        const bossName = customId.substring(6);
        // Aktualizujemy stan danego bossa
        const index = bossData.findIndex(b => b.bossName === bossName);
        if (index !== -1) {
          const boss = bossData.splice(index, 1)[0];
          boss.lastChecked = Date.now();
          boss.lastChecker = interaction.user.id;
          // Zapisujemy do bazy
          await db.run("UPDATE Bosses SET lastChecked = ?, lastChecker = ? WHERE bossName = ?", [boss.lastChecked, boss.lastChecker, boss.bossName]);
          // Aktualizujemy interfejs – kolejne pobranie danych nastąpi przy kolejnym interwale, ale natychmiast aktualizujemy lokalnie
          try {
            if (tableMessage) await tableMessage.edit({ content: buildTable(bossData) });
            if (zone === "PACC" && buttonMessagePACC) await buttonMessagePACC.edit({ content: "", components: buildButtonsForGroup(groups.PACC) });
            if (zone === "FACC" && buttonMessageFACC) await buttonMessageFACC.edit({ content: "", components: buildButtonsForGroup(groups.FACC) });
          } catch (error) {
            console.error("Błąd przy aktualizacji po kliknięciu:", error);
          }
        }
        try {
          await interaction.deferUpdate();
        } catch (error) {
          console.error("Błąd podczas deferUpdate:", error);
        }
      }
    });
    collector.on("end", () => {
      startCollector(zone);
    });
    if (zone === "PACC") buttonCollectorPACC = collector;
    else if (zone === "FACC") buttonCollectorFACC = collector;
  }
}
