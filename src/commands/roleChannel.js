// src/commands/roleChannel.js
import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { bossConfig } from '../bossConfig.js';

/**
 * Funkcja tworzy (lub znajduje) kanał o nazwie "roles" na serwerze oraz wysyła wiadomości
 * z przyciskami pogrupowanymi alfabetycznie według pierwszej litery bazowej nazwy.
 * Dla bossów, których nazwa zawiera nawias – przycisk pokazuje tylko część przed nawiasem.
 * Po kliknięciu przycisku użytkownikowi nadawane (lub usuwane) są role odpowiadające wszystkim bossom,
 * których pełne nazwy zaczynają się od tej bazowej nazwy.
 * Użytkownik otrzymuje prywatny komunikat (DM) z informacją o nadaniu lub usunięciu roli.
 * 
 * @param {Guild} guild – obiekt serwera Discord
 */
export async function setupRoleChannel(guild) {
  // Szukamy kanału "roles" – jeśli nie istnieje, tworzymy go.
  let rolesChannel = guild.channels.cache.find(
    ch => ch.name === 'roles' && ch.type === ChannelType.GuildText
  );
  if (!rolesChannel) {
    rolesChannel = await guild.channels.create({
      name: 'roles',
      type: ChannelType.GuildText,
      reason: 'Kanał do nadawania ról bossów'
    });
  }

  // Grupujemy bossy alfabetycznie według bazowej nazwy (część przed nawiasem)
  // Struktura: { [letter]: { [baseName]: [fullBossName1, fullBossName2, ...] } }
  const groups = {};
  for (const bossName of Object.keys(bossConfig)) {
    const baseName = bossName.split('(')[0].trim();
    const letter = baseName[0].toUpperCase();
    if (!groups[letter]) groups[letter] = {};
    if (!groups[letter][baseName]) groups[letter][baseName] = [];
    groups[letter][baseName].push(bossName);
  }

  // Dla każdej litery tworzymy wiadomość z przyciskami
  for (const letter of Object.keys(groups).sort()) {
    // Budujemy przyciski dla każdej bazowej nazwy w grupie
    const actionRows = [];
    let currentRow = new ActionRowBuilder();
    for (const baseName of Object.keys(groups[letter]).sort()) {
      // Używamy encodeURIComponent, by mieć bezpieczny customId
      const customId = `role_${letter}_${encodeURIComponent(baseName)}`;
      const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(baseName)
        .setStyle(ButtonStyle.Primary);
      if (currentRow.components.length >= 5) {
        actionRows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
      currentRow.addComponents(button);
    }
    if (currentRow.components.length > 0) actionRows.push(currentRow);
    
    // Wysyłamy wiadomość – jej treścią jest litera (nagłówek)
    const msg = await rolesChannel.send({ content: letter, components: actionRows });
    
    // Ustawiamy collector dla przycisków na tej wiadomości
    msg.createMessageComponentCollector().on('collect', async interaction => {
      if (!interaction.isButton()) return;
      
      // Rozbijamy customId: role_{letter}_{encodedBaseName}
      const parts = interaction.customId.split('_');
      const letterFromId = parts[1];
      const baseNameEncoded = parts.slice(2).join('_');
      const baseName = decodeURIComponent(baseNameEncoded);
      
      // Pobieramy listę pełnych nazw bossów odpowiadających tej bazowej nazwie
      const bossNames = groups[letterFromId][baseName];
      if (!bossNames) {
        await interaction.reply({ content: 'Nie znaleziono ról.', ephemeral: true });
        return;
      }
      
      // Pobieramy najnowsze role z serwera (aby nie korzystać ze starego cache)
      const rolesCache = await guild.roles.fetch();
      const member = interaction.member; // GuildMember
      
      const rolesToToggle = [];
      
      // Dla każdej pełnej nazwy sprawdzamy, czy rola istnieje – jeśli nie, tworzymy ją.
      for (const roleName of bossNames) {
        let role = rolesCache.find(r => r.name === roleName);
        if (!role) {
          try {
            role = await guild.roles.create({ name: roleName, reason: 'Rola bossa utworzona automatycznie' });
            // Odświeżamy rolesCache po utworzeniu nowej roli
            rolesCache.set(role.id, role);
          } catch (error) {
            console.error(`Błąd przy tworzeniu roli ${roleName}:`, error);
            continue;
          }
        }
        rolesToToggle.push(role);
      }
      
      const rolesGiven = [];
      const rolesRemoved = [];
      
      // Toggle – jeśli użytkownik posiada rolę, usuwamy, w przeciwnym razie dodajemy
      for (const role of rolesToToggle) {
        if (member.roles.cache.has(role.id)) {
          try {
            await member.roles.remove(role);
            rolesRemoved.push(role.name);
          } catch (error) {
            console.error(`Błąd przy usuwaniu roli ${role.name}:`, error);
          }
        } else {
          try {
            await member.roles.add(role);
            rolesGiven.push(role.name);
          } catch (error) {
            console.error(`Błąd przy nadawaniu roli ${role.name}:`, error);
          }
        }
      }
      
      let replyMsg = '';
      if (rolesGiven.length > 0) replyMsg += `Nadano rolę: ${rolesGiven.join(', ')}`;
      if (rolesRemoved.length > 0) replyMsg += (replyMsg ? '\n' : '') + `Usunięto rolę: ${rolesRemoved.join(', ')}`;
      
      try {
        await interaction.user.send(replyMsg);
      } catch (err) {
        console.error('Błąd przy wysyłaniu DM:', err);
      }
      await interaction.deferUpdate();
    });
  }
}
