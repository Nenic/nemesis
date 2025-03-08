// src/commands/foundBoss.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { addAppearance } from '../database.js'; // Twoja funkcja dodająca pojawienie
import { handleBossTable } from './bosstable.js';

/**
 * Funkcja obsługująca komendę !found @rola.
 * Wyszukuje wzmiankowaną rolę, wysyła na kanale "bosses" wiadomość:
 * "Nemesis @rola has been found!" z trzema przyciskami.
 * Po kliknięciu przycisku wiadomość aktualizuje się, a odpowiedni wpis
 * zostaje dodany do bazy danych. Następnie odświeżana jest tabela.
 *
 * @param {object} db - Połączenie z bazą danych.
 * @param {object} message - Obiekt wiadomości Discord (komenda !found).
 */
export async function handleFoundCommand(db, message) {
  // Sprawdzamy, czy komenda zawiera wzmiankę roli
  const roleMention = message.mentions.roles.first();
  if (!roleMention) {
    return message.reply("Podaj wzmiankę roli, np. `!found @BossRole`");
  }
  
  const roleName = roleMention.name; // Używamy tylko nazwy (bez wzmianki)
  
  // Szukamy kanału "bosses" – jeśli nie istnieje, tworzymy go
  let bossesChannel = message.guild.channels.cache.find(ch => ch.name === 'bosses' && ch.type === ChannelType.GuildText);
  if (!bossesChannel) {
    bossesChannel = await message.guild.channels.create({
      name: 'bosses',
      type: ChannelType.GuildText,
      reason: 'Kanał do ogłaszania znalezionych bossów'
    });
  }
  
  // Wysyłamy wiadomość na kanale "bosses"
  const initialContent = `Nemesis ${roleMention} has been found!`;
  
  // Tworzymy trzy przyciski:
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`found_killed_${encodeURIComponent(roleName)}`)
      .setLabel("Killed")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`found_ks_${encodeURIComponent(roleName)}`)
      .setLabel("KS")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`found_puff_${encodeURIComponent(roleName)}`)
      .setLabel("PUFF")
      .setStyle(ButtonStyle.Secondary)
  );
  
  const foundMessage = await bossesChannel.send({ content: initialContent, components: [actionRow] });
  
  // Ustawiamy collector dla przycisków na 1 godzinę
  const collector = foundMessage.createMessageComponentCollector({ time: 3600000 });
  
  collector.on("collect", async interaction => {
    if (!interaction.isButton()) return;
    const customId = interaction.customId;
    let actionText = "";
    if (customId.startsWith("found_killed_")) {
      actionText = "Killed";
    } else if (customId.startsWith("found_ks_")) {
      actionText = "KS'ed";
    } else if (customId.startsWith("found_puff_")) {
      actionText = "Poofed";
    }
    
    // Nowa treść wiadomości – zamiast wzmianki, tylko nazwa roli
    const newContent = `Nemesis ${roleName} has been ${actionText}!`;
    
    // Dodajemy wpis w bazie danych z datą kliknięcia
    const now = new Date();
    try {
      await addAppearance(db, roleName, now.toISOString());
    } catch (error) {
      console.error("Błąd przy dodawaniu pojawienia w bazie:", error);
    }
    
    // Aktualizujemy wiadomość interakcją – wywołujemy update zamiast deferUpdate
    await interaction.update({ content: newContent, components: [] });
  });
  
  collector.on("end", () => {
    // Opcjonalnie: kolektor kończy się po 1 godzinie, ale wiadomość pozostaje zaktualizowana
  });
}
