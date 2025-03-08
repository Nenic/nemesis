// src/nemesis.mjs
import { Client, GatewayIntentBits } from 'discord.js';
import { initDB } from './database.js';
import { handleBossTable } from './commands/bosstable.js';
import { handleUpdateTable } from './commands/updateTable.js';
import { setupRoleChannel } from './commands/roleChannel.js';
import { handleFoundCommand } from './commands/foundBoss.js';
import { showLastCommand, revertKillCommand } from './commands/helperCommands.js';
import { deleteDataCommand, addAppearanceCommand } from './commands/helperCommands.js';
import cron from 'node-cron';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let db;

client.once('ready', async () => {
  console.log(`Bot zalogowany jako ${client.user.tag}`);
  db = await initDB();

  // Harmonogram wykonania codziennego updateTable o 3:30 (czas serwera)
  cron.schedule('30 3 * * *', async () => {
    // Wybierz kanał, w którym ma być wyświetlona aktualizacja (podmień 'YOUR_CHANNEL_ID')
    const channel = client.channels.cache.get('YOUR_CHANNEL_ID');
    if (channel && db) {
      const msg = await channel.send("Aktualizacja tabeli na podstawie statystyk z API...");
      await handleUpdateTable(db, msg);
    }
  });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Komenda !bosstable
  if (message.content.startsWith('!bosstable')) {
    await handleBossTable(db, message);
  }

  // Komenda !updateTable – ręczna aktualizacja
  if (message.content.startsWith('!updateTable')) {
    await handleUpdateTable(db, message);
  }

  if (message.content === '!createRoles') {
    // Upewnij się, że komenda jest wykonywana na serwerze
    if (!message.guild) return;
    await setupRoleChannel(message.guild);
    message.reply('Kanał roles został utworzony/zaaktualizowany.');
  }

    // Obsługa komendy !found
    if (message.content.startsWith('!found')) {
      await handleFoundCommand(db, message);
    }

    if (message.content.startsWith('!showLast')) {
      await showLastCommand(db, message);
    }
    
    if (message.content.startsWith('!revertKill')) {
      await revertKillCommand(db, message);
    }

    if (message.content.startsWith('!deleteData')) {
      await deleteDataCommand(db, message);
    }

    if (message.content.startsWith('!addAppearance')) {
      await addAppearanceCommand(db, message);
    }
    
});

// Zastąp 'TWÓJ_TOKEN_DISCORDA' właściwym tokenem bota lub użyj zmiennych środowiskowych
client.login('MTM0NjU3OTMwODQ5NTI0MTIzNg.GMcsfs.0K8WwbS5Ibw2k1M7GrXcAFfV0sBDQzZocK2OcU');
