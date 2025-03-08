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
 * Formatuje upływ czasu od lastChecked do teraz:
 * - <60 sek: Xsec
 * - <60 min: Ymin
 * - <24h: Zh
 * - >=24h: Nd
 * Jeśli lastChecked nie jest ustawione, traktujemy, że minęło 24h.
 * @param {number|null} lastChecked - timestamp
 * @returns {string}
 */
function formatElapsed(lastChecked) {
  const effective = lastChecked ? lastChecked : Date.now() - (24 * 60 * 60 * 1000);
  const diffSec = Math.floor((Date.now() - effective) / 1000);
  if (diffSec < 60) return `${diffSec}sec`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

/**
 * Buduje tekst tabeli z listą bossów.
 * Wyświetla: nazwa bossa, czas upływu od ostatniego kliknięcia oraz klikalną wzmiankę lastChecker.
 * Legenda została usunięta.
 */
function buildTable(bossData) {
  let tableStr = "";
  bossData.forEach(boss => {
    const namePadded = boss.bossName.padEnd(18, ' ');
    const elapsed = formatElapsed(boss.lastChecked);
    const checker = boss.lastChecker ? ` <@${boss.lastChecker}>` : "";
    tableStr += `${namePadded}  ${elapsed}${checker}\n`;
  });
  return tableStr;
}

/**
 * Buduje przyciski dla danej grupy bossów.
 */
function buildButtonsForGroup(groupData) {
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

/**
 * Funkcja loadBossData pobiera stan z bazy i buduje tablicę bossData.
 * Oblicza % szansy na pojawienie się dla każdego bossa.
 * Dane lastChecked oraz lastChecker pobierane są z tabeli Bosses.
 * Jeśli liczba dni od ostatniego pojawienia przekracza boss.maximalDays,
 * pobieramy ostatnie 10 pojawień, obliczamy średni interwał i używamy tej średniej (predykcji),
 * dodając tilde "~" przed procentem.
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
          d1.setHours(0,0,0,0);
          d2.setHours(0,0,0,0);
          sumDiff += daysBetween(d1, d2);
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
    if (chancePercentage > 0) {
      bossData.push({
        bossName: boss.bossName,
        chance: flagTilde ? `~${chancePercentage}` : `${chancePercentage}`,
        lastChecked: boss.lastChecked || null,
        lastChecker: boss.lastChecker || null
      });
    }
  }
  // Sortujemy bossData – najdłuższy czas (czyli najwyższa wartość lastChecked) na górze,
  // a jeśli nie ma lastChecked, traktujemy to jako 24h temu.
  bossData.sort((a, b) => {
    const aTime = a.lastChecked ? a.lastChecked : (Date.now() - 24 * 60 * 60 * 1000);
    const bTime = b.lastChecked ? b.lastChecked : (Date.now() - 24 * 60 * 60 * 1000);
    // Chcemy, aby boss z dłuższym czasem (starszy click) był wyżej
    return aTime - bTime;
  });
  return bossData;
}

/**
 * Główna funkcja handleBossTable:
 * - Pobiera stan z bazy (loadBossData) i wysyła interfejs (tabelę oraz przyciski).
 * - Grupuje dane według zone (PACC i FACC) i wysyła osobne wiadomości z przyciskami.
 * - Ustawia interwał co 20 sekund, który pobiera stan z bazy i odświeża interfejs.
 * - Collector przycisków aktualizuje stan w bazie (lastChecked, lastChecker) i odświeża interfejs.
 *
 * @param {object} db - połączenie z bazą danych.
 * @param {object} message - obiekt wiadomości Discord.
 */
export async function handleBossTable(db, message) {
  let bossData = await loadBossData(db);
  
  // Aktualizacja tabeli – jedna wiadomość tekstowa
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
  
  // Grupujemy bossData według zone
  const groups = { PACC: [], FACC: [] };
  bossData.forEach(boss => {
    const config = bossConfig[boss.bossName];
    if (config && config.zone === "PACC") groups.PACC.push(boss);
    else if (config && config.zone === "FACC") groups.FACC.push(boss);
  });
  
  // Aktualizacja przycisków dla PACC
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
  
  // Aktualizacja przycisków dla FACC
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
  
  // Ustawiamy interwał co 20 sekund – pobieramy stan z bazy i odświeżamy interfejs
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async () => {
    try {
      bossData = await loadBossData(db);
      if (tableMessage) await tableMessage.edit({ content: buildTable(bossData) });
      const groups = { PACC: [], FACC: [] };
      bossData.forEach(boss => {
        const config = bossConfig[boss.bossName];
        if (config && config.zone === "PACC") groups.PACC.push(boss);
        else if (config && config.zone === "FACC") groups.FACC.push(boss);
      });
      if (buttonMessagePACC) await buttonMessagePACC.edit({ content: "", components: buildButtonsForGroup(groups.PACC) });
      if (buttonMessageFACC) await buttonMessageFACC.edit({ content: "", components: buildButtonsForGroup(groups.FACC) });
    } catch (error) {
      console.error("Błąd podczas aktualizacji interfejsu:", error);
    }
  }, 20000);
  
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
        const index = bossData.findIndex(b => b.bossName === bossName);
        if (index !== -1) {
          const boss = bossData.splice(index, 1)[0];
          boss.lastChecked = Date.now();
          boss.lastChecker = interaction.user.id;
          await db.run("UPDATE Bosses SET lastChecked = ?, lastChecker = ? WHERE bossName = ?", [boss.lastChecked, boss.lastChecker, boss.bossName]);
          try {
            if (tableMessage) await tableMessage.edit({ content: buildTable(bossData) });
            // Po kliknięciu ponownie pobieramy stan grup z bazy
            const groups = { PACC: [], FACC: [] };
            bossData.forEach(b => {
              const config = bossConfig[b.bossName];
              if (config && config.zone === "PACC") groups.PACC.push(b);
              else if (config && config.zone === "FACC") groups.FACC.push(b);
            });
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
