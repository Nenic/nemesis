// bot.mjs
import { Client, GatewayIntentBits } from 'discord.js';
import schedule from 'node-schedule';
import { fetchBossData, formatBossTableWithoutRaids, buildBossButtons, formatRaidsLine, separateRaidBosses, fetchKillStats, getBossSpawnChance, calculateBossChance  } from './bossData.js';
import { getAllBossNames } from './bossNames.js';
import { handleAddBossRoles, handleAddRolesRoom, handleFoundCommand } from './roleCommands.js';
import { initDB, addAppearance, getLast25Appearances, upsertBoss, deleteDataForBoss } from './src/database.js';
import { getBossSpawnChanceUpdated } from './spawnChance.js';
import { bossConfig } from './bossConfig.js';
import puppeteer from 'puppeteer';


console.log("Starting bot...");

const TOKEN = 'MTM0NjU3OTMwODQ5NTI0MTIzNg.GMcsfs.0K8WwbS5Ibw2k1M7GrXcAFfV0sBDQzZocK2OcU';

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


/* ------------------ Command Handlers ------------------ */

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // !bosstable: fetch boss data and display the table
  if (message.content.startsWith('!bosstable')) {
	// Usuń wiadomość użytkownika, aby nie była widoczna
	message.delete().catch(err => console.error("Failed to delete message:", err));
  
	await message.channel.send(`Fetching boss data...`);
	try {
	  // Pobieramy wszystkie bossy z bazy danych (bez filtrowania po świecie)
	  const bosses = await db.all("SELECT * FROM Bosses");
	  
	  // Ustawiamy dla każdego bossa aktualny czas jako lastReset i czyścimy pole player
	  allBossData = bosses.map(b => ({ ...b, lastReset: Date.now(), player: "" }));
	  
	  // Rozdzielamy bossy na normalne i raidowe – funkcja separateRaidBosses używa bossName lub name
	  const { normal, raids } = separateRaidBosses(allBossData);
	  globalBossData = normal;
	  
	  // Dla każdego bossa pobieramy ostatnie 25 pojawień oraz obliczamy spawn chance,
	  // używając funkcji getLast25Appearances i getBossSpawnChanceUpdated (analogicznie do komendy !spawnChance)
	  await Promise.all(globalBossData.map(async (boss, index) => {
		// Upewnij się, że używasz właściwej nazwy bossa
		const bossName = boss.bossName || boss.name;
		const lastAppearances = await getLast25Appearances(db, bossName);
		const spawnResult = await getBossSpawnChanceUpdated(db, bossName, lastAppearances);
		// Przypisujemy wynik do pola chance – jest to string np. "~68.50%" lub "45.00%"
		globalBossData[index].chance = spawnResult.chance;
	  }));
	  
	  // Filtrujemy tylko bossy, które mają szansę większą niż 0%
	  globalBossData = globalBossData.filter(boss => {
		if (!boss.chance || boss.chance === "N/A") return false;
		const numericChance = parseFloat(boss.chance.replace("~", "").replace("%", ""));
		return numericChance > 0;
	  });
	  
	  // Formatowanie tabeli z bossami normalnymi oraz wiersza z bossami raidowymi
	  const tableText = formatBossTableWithoutRaids(globalBossData);
	  const raidsLine = formatRaidsLine(raids);
	  const finalMessage = tableText + "\n" + raidsLine;
	  
	  // Budujemy przyciski dla bossów normalnych
	  const components = buildBossButtons(globalBossData);
	  
	  tableMessage = await message.channel.send({ content: finalMessage, components });
	} catch (error) {
	  console.error("Error in !bosstable:", error);
	  await message.channel.send("An error occurred while fetching boss data from the database.");
	}
  }
  
  if (message.content.startsWith('!killed')) {
    // Delete the triggering message so it isn’t visible in chat
    await handleKilledCommand(message);
  }

  if (message.content.startsWith('!updateKillStats')) {
	await updateTableKillStats(db, message);
  }

  // Command format: !fetchRespawn monsterName
  if (message.content.startsWith('!fetchRespawn')) {
    const args = message.content.split(' ');
    if (args.length < 2) {
      await message.channel.send("Please provide a monster name. Example: `!fetchRespawn Diblis The Fair`");
      return;
    }
    
    // Build the monster name and URL (note: URL-encode the monster name)
    const monsterName = encodeURIComponent(args.slice(1).join(' '));
    const url = `https://guildstats.eu/bosses?world=Secura&monsterName=${monsterName}`;
    
    try {
      const respawnDates = await fetchRespawnHistory(url);
      // Log the first 3 dates to the console
      console.log("Fetched respawn dates for monster:", args.slice(1).join(' '));
      console.log("First 3 dates:", respawnDates.slice(0, 3));
      await message.channel.send("Fetched respawn dates. Check your console for the first 3 dates.");
    } catch (error) {
      console.error("Error fetching respawn history:", error);
      await message.channel.send("An error occurred while fetching the respawn history.");
    }
  }
  
  // !addBossRoles: create roles for all bosses using names from bossNames.js
  if (message.content.startsWith('!addBossRoles')) {
	message.delete().catch(err => console.error("Failed to delete message:", err));

    await handleAddBossRoles(message);
  }
  
  // !addRolesRoom: create a "roles" channel and post role assignment buttons
  if (message.content.startsWith('!addRolesRoom')) {
	message.delete().catch(err => console.error("Failed to delete message:", err));

    await handleAddRolesRoom(message);
  }
  
  // !found: found a boss (or show suggestions) and send a notification with a red X button
  if (message.content.startsWith('!found')) {
	message.delete().catch(err => console.error("Failed to delete message:", err));

    await handleFoundCommand(message);
  }
  
  // !updateTable: update table (if needed; not implemented in this example)
  if (message.content.startsWith('!updateTable')) {
	message.delete().catch(err => console.error("Failed to delete message:", err));

    await updateTable()
  }

    // Komenda: !spawnChance <bossName>
	if (message.content.startsWith('!spawnChance')) {
		const args = message.content.split(' ');
		if (args.length < 2) {
		  await message.channel.send("Użycie: `!spawnChance <bossName>`");
		  return;
		}
		const bossName = args.slice(1).join(' ');
		try {
		  // Pobierz ostatnie 25 pojawień dla danego bossa z bazy
		  const lastAppearances = await getLast25Appearances(db, bossName);
		  // Wylicz spawn chance (funkcja może dodać nowy rekord, jeśli przekroczono maxDays)
		  const result = await getBossSpawnChanceUpdated(db, bossName, lastAppearances);
		  await message.channel.send(`${result.bossName} ma ${result.chance}% szans na pojawienie się dzisiaj.`);
		} catch (error) {
		  console.error("Błąd przy wyliczaniu spawn chance:", error);
		  await message.channel.send("Wystąpił błąd przy wyliczaniu szans na pojawienie się bossa.");
		}
	  }

	  if (message.content.startsWith('!checkDatabase')) {
		try {
		  // Pobieramy wszystkie rekordy z tabeli Bosses
		  const rows = await db.all("SELECT bossName FROM Bosses");
		  // Mapujemy do tablicy nazw bossów
		  const bossNames = rows.map(row => row.bossName);
		  // Tworzymy komunikat – oddzielone przecinkami lub w nowej linii
		  const output = bossNames.join("\n");
		  await message.channel.send(`Aktualnie zapisane bossy w bazie danych:\n${output}`);
		} catch (error) {
		  console.error("Błąd przy pobieraniu danych z bazy:", error);
		  await message.channel.send("Wystąpił błąd przy pobieraniu danych z bazy.");
		}
	  }

	  

	    // Komenda: !deleteData <bossName>
  if (message.content.startsWith('!deleteData')) {
    const args = message.content.split(' ');
    if (args.length < 2) {
      await message.channel.send("Użycie: `!deleteData <bossName>`");
      return;
    }
    const bossName = args.slice(1).join(' ');
    try {
      await deleteDataForBoss(db, bossName);
      await message.channel.send(`Usunięto wszystkie dane dla bossa "${bossName}".`);
    } catch (error) {
      console.error("Błąd podczas usuwania danych:", error);
      await message.channel.send("Wystąpił błąd podczas usuwania danych dla tego bossa.");
    }
  }

    // Command: !lastShow bossName
	if (message.content.startsWith('!lastShow')) {
		// Delete the triggering message
		message.delete().catch(err => console.error("Failed to delete message:", err));
		
		const args = message.content.split(' ');
		if (args.length < 2) {
		  await message.channel.send("Usage: `!lastShow <bossName>`");
		  return;
		}
		const bossName = args.slice(1).join(' ');
		
		try {
		  const appearances = await getLastAppearances(db, bossName, 3);
		  if (appearances.length === 0) {
			await message.channel.send(`No appearance records found for ${bossName}.`);
		  } else {
			// Format the appearance dates (adjust the formatting as needed)
			const text = appearances
			  .map(a => a.appearanceDate)
			  .join("\n");
			await message.channel.send(`Last 3 appearances for **${bossName}**:\n${text}`);
		  }
		} catch (err) {
		  console.error("Error in !lastShow:", err);
		  await message.channel.send("Error retrieving appearance records.");
		}
	  }
	
	  // Command: !revertKill bossName
	  if (message.content.startsWith('!revertKill')) {
		message.delete().catch(err => console.error("Failed to delete message:", err));
		
		const args = message.content.split(' ');
		if (args.length < 2) {
		  await message.channel.send("Usage: `!revertKill <bossName>`");
		  return;
		}
		const bossName = args.slice(1).join(' ');
		
		try {
		  const deletedRecord = await revertLastAppearance(db, bossName);
		  await message.channel.send(`Reverted kill for **${bossName}**. Removed appearance record from ${new Date(deletedRecord.appearanceDate).toLocaleString()}.`);
		} catch (err) {
		  console.error("Error in !revertKill:", err);
		  await message.channel.send("Error reverting kill. No appearance record found for that boss.");
		}
	  }

  

// Example command: !addBossAppeareance <bossName> <yyyy-mm-dd[ hh:mm]>
if (message.content.startsWith('!addBossAppeareance')) {
	const args = message.content.split(' ');
	if (args.length < 3) {
	  await message.channel.send("Użycie: `!addBossAppeareance <bossName> <yyyy-mm-dd[ hh:mm]>`");
	  return;
	}
	
	// Assume that the date is the last argument and the boss name is everything in between.
	const dateInput = args[args.length - 1].trim(); // e.g. "2025-02-07" or "2025-02-07 14:30"
	const bossName = args.slice(1, args.length - 1).join(' ').trim();
	
	// Validate the date by trying to create a Date object.
	let appearanceDate = new Date(dateInput);
	if (isNaN(appearanceDate.getTime())) {
	  await message.channel.send(`Data "${dateInput}" jest niepoprawna. Użyj formatu "yyyy-mm-dd" lub "yyyy-mm-dd hh:mm".`);
	  return;
	}
	
	if (dateInput.length === 10) {
	 appearanceDate = new Date(dateInput + " 10:00");
	 }
  
	// Look up boss configuration (ensure bossName exactly matches one of your keys)
	const config = bossConfig[bossName];
	if (!config) {
	  await message.channel.send(`Nie znaleziono konfiguracji dla bossa "${bossName}". Upewnij się, że nazwa jest poprawna.`);
	  return;
	}
	
	try {
	  // Update (or insert) boss record with config values
	  await upsertBoss(db, bossName, config.minDays, config.maxDays);
	  // Add an appearance with the provided (or defaulted) date
	  // (You may pass appearanceDate.toISOString() if your addAppearance expects an ISO string)
	  await addAppearance(db, bossName, appearanceDate.toISOString());
	  
	  await message.channel.send(
		`Dodano pojawienie bossa "${bossName}" z datą ${appearanceDate.toISOString()}. Ustawiono min: ${config.minDays} dni, max: ${config.maxDays} dni.`
	  );
	} catch (error) {
	  console.error("Błąd przy dodawaniu pojawienia:", error);
	  await message.channel.send("Wystąpił błąd podczas dodawania pojawienia się.");
	}
  }

  if (message.content.startsWith('!lastDayKills')) {
	try {
	  const { start, end } = getPreviousDayWindow();
	  const startIso = start.toISOString();
	  const endIso = end.toISOString();
	  const rows = await db.all(
		`SELECT DISTINCT bossName FROM Appearances WHERE appearanceDate >= ? AND appearanceDate < ?`,
		[startIso, endIso]
	  );
	  if (rows.length === 0) {
		await message.channel.send("Brak zarejestrowanych zabójstw z poprzedniego dnia.");
	  } else {
		const bossList = rows.map(r => r.bossName).join("\n");
		await message.channel.send("Bossy zabite poprzedniego dnia:\n" + bossList);
	  }
	} catch (error) {
	  console.error(error);
	  await message.channel.send("Błąd przy pobieraniu danych z bazy.");
	}
  }
});

export async function getAllBossesFromDatabase(db) {
	const rows = await db.all("SELECT * FROM Bosses");
	return rows;
  }
  
  export async function updateTableKillStats(db, message) {
	const killStats = await fetchKillStats();
	const now = new Date();
	let killDate = new Date(now);
	if (now.getHours() < 10) {
	  killDate.setDate(now.getDate() - 1);
	}
	killDate.setHours(0, 0, 0, 0);
	const killDateStr = killDate.toISOString().split("T")[0];
	let killedBosses = [];
	for (const stat of killStats) {
	  if (stat.last_day_killed > 0) {
		const bossName = stat.race;
		const existing = await getAppearanceByBossAndDate(db, bossName, killDateStr);
		if (!existing) {
		  await addAppearance(db, bossName, killDateStr);
		  killedBosses.push(bossName);
		}
	  }
	}
	const allBosses = await getAllBossesFromDatabase(db);
	const bossNamesSet = new Set(allBosses.map(b => b.bossName));
	killedBosses = killedBosses.filter(bossName => /^[A-Z]/.test(bossName) && bossNamesSet.has(bossName));
	
	if (killedBosses.length > 0) {
	  await message.channel.send("Bosses killed yesterday: " + killedBosses.join(", "));
	}
	const bosses = await getAllBossesFromDatabase(db);
	const tableText = formatBossTableWithoutRaids(bosses);
	const { raids } = separateRaidBosses(bosses);
	const raidsLine = formatRaidsLine(raids);
	const components = buildBossButtons(bosses);
	if (global.tableMessage) {
	  await global.tableMessage.edit({ content: tableText + "\n" + raidsLine, components });
	} else {
	  global.tableMessage = await message.channel.send({ content: tableText + "\n" + raidsLine, components });
	}
  }

  export async function getAppearanceByBossAndDate(db, bossName, dateStr) {
	const query = "SELECT * FROM Appearances WHERE bossName = ? AND appearanceDate LIKE ?";
	const likeDate = `${dateStr}%`;
	return await db.get(query, [bossName, likeDate]);
  }

function getPreviousDayWindow() {
	const now = new Date();
	let start, end;
	if (now.getHours() < 10) {
	  start = new Date(now);
	  start.setDate(now.getDate() - 2);
	  start.setHours(10, 0, 0, 0);
	  end = new Date(now);
	  end.setDate(now.getDate() - 1);
	  end.setHours(10, 0, 0, 0);
	} else {
	  start = new Date(now);
	  start.setDate(now.getDate() - 1);
	  start.setHours(10, 0, 0, 0);
	  end = new Date(now);
	  end.setHours(10, 0, 0, 0);
	}
	return { start, end };
  }
  
  async function getBossAppearancesPreviousDay(db, bossName) {
	const { start, end } = getPreviousDayWindow();
	const startIso = start.toISOString();
	const endIso = end.toISOString();
	const query = `
	  SELECT *
	  FROM Appearances
	  WHERE bossName = ? AND appearanceDate >= ? AND appearanceDate < ?
	`;
	return await db.all(query, [bossName, startIso, endIso]);
  }
/**
 * Zwraca sformatowaną datę w formacie "yyyy-MM-dd hh:mm".
 * Jeśli przekazany ciąg (dateString) nie zawiera informacji o czasie,
 * dołączany jest aktualny czas (godzina:minuta) z systemu.
 * Jeśli nie podano żadnego ciągu, używany jest bieżący czas.
 */
function getKillTimestamp(dateString) {
	let date;
	if (dateString) {
	  // Jeśli ciąg nie zawiera dwukropka (czyli prawdopodobnie nie ma czasu),
	  // dołączamy aktualny czas.
	  if (!dateString.includes(":")) {
		const now = new Date();
		// Pobieramy aktualny czas w formacie hh:mm
		const currentTime = now.toTimeString().split(" ")[0].slice(0, 5);
		date = new Date(dateString + " " + currentTime);
	  } else {
		date = new Date(dateString);
	  }
	} else {
	  date = new Date();
	}
	// Formatowanie daty: yyyy-MM-dd hh:mm
	const yyyy = date.getFullYear();
	const MM = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
  }

// appearanceHelpers.js
// These functions assume you're using an async SQLite API (like sqlite3 with Promises)
// Adjust the API calls according to your database library.

export async function getLastAppearances(db, bossName, limit = 3) {
	const sql = `
	  SELECT id, appearanceDate
	  FROM Appearances
	  WHERE bossName = ?
	  ORDER BY appearanceDate DESC
	  LIMIT ?
	`;
	// db.all returns an array of rows
	const records = await db.all(sql, [bossName, limit]);
	return records;
  }

  async function handleKilledCommand(message) {
	// Usuń wiadomość użytkownika
	message.delete().catch(err => console.error("Nie udało się usunąć wiadomości:", err));
  
	const args = message.content.split(" ");
	if (args.length < 2) {
	  await message.reply("Użycie: `!killed <bossName>`");
	  return;
	}
	const bossName = args.slice(1).join(" ");
  
	// Pobierz aktualny czas w formacie yyyy-MM-dd hh:mm (jeśli np. użytkownik nie podał innego)
	const timestamp = getKillTimestamp(); // lub getKillTimestamp(userProvidedDate) jeśli data jest podana
  
	try {
	  // Tutaj wykonujesz logikę usuwania bossa z listy (przycisków i tabeli) 
	  // oraz dodajesz rekord do bazy danych – pamiętaj, żeby przekazać bossName oraz timestamp
  
	  // Przykładowo:
	  await addAppearance(db, bossName, timestamp); // funkcja, która INSERTuje do tabeli Appearances
  
	  // Usuń bossa z globalBossData i zaktualizuj interfejs (tabelę i przyciski)
	  globalBossData = globalBossData.filter(b => b.bossName.toLowerCase() !== bossName.toLowerCase());
	  const tableText = formatBossTableWithoutRaids(globalBossData);
	  const raidsLine = formatRaidsLine(currentRaids);
	  const components = buildBossButtons(globalBossData);
	  if (tableMessage) {
		await tableMessage.edit({ content: tableText + "\n" + raidsLine, components });
	  }
	  await message.channel.send(`Dodano wpis o pojawieniu się bossa **${bossName}** z czasem: **${timestamp}**.`);
	} catch (error) {
	  console.error("Błąd w !killed:", error);
	  await message.reply("Wystąpił błąd przy przetwarzaniu komendy !killed.");
	}
  }
  
  export async function revertLastAppearance(db, bossName) {
	// Get the most recent appearance record for the boss
	const sqlSelect = `
	  SELECT id, appearanceDate
	  FROM Appearances
	  WHERE bossName = ?
	  ORDER BY appearanceDate DESC
	  LIMIT 1
	`;
	const record = await db.get(sqlSelect, [bossName]);
	if (!record) {
	  throw new Error("No appearance record found for this boss.");
	}
	// Delete that record
	const sqlDelete = `
	  DELETE FROM Appearances
	  WHERE id = ?
	`;
	await db.run(sqlDelete, [record.id]);
	return record;
  }


/**
 * Updates the table by fetching kill statistics and then filtering out normal bosses
 * that have been killed in the last day.
 * Raid bosses are separated (but not removed) and displayed in a separate line.
 * Sends a message listing the removed bosses and updates the table message.
 */
// Ustalanie przedziału czasowego, który uznajemy za "dzień spawnu" – od poprzedniego dnia o 10:00 do dzisiejszego o 10:00
function getAppearanceTimeWindow() {
	const current = new Date();
	let start, end;
	if (current.getHours() < 10) {
	  const yesterday = new Date(current);
	  yesterday.setDate(current.getDate() - 1);
	  yesterday.setHours(10, 0, 0, 0);
	  start = yesterday;
	  const today = new Date(current);
	  today.setHours(10, 0, 0, 0);
	  end = today;
	} else {
	  const today = new Date(current);
	  today.setHours(10, 0, 0, 0);
	  start = today;
	  const tomorrow = new Date(current);
	  tomorrow.setDate(current.getDate() + 1);
	  tomorrow.setHours(10, 0, 0, 0);
	  end = tomorrow;
	}
	return { start, end };
  }
  
  // Funkcja sprawdzająca, czy w bazie (tabela Appearances) istnieje już rekord dla danego bossa 
  // w przedziale czasu od poprzedniego dnia 10:00 do dzisiejszego 10:00.
  async function checkAppearanceExists(db, bossName) {
	const { start, end } = getAppearanceTimeWindow();
	const startIso = start.toISOString();
	const endIso = end.toISOString();
	const query = "SELECT COUNT(*) as count FROM Appearances WHERE bossName = ? AND appearanceDate >= ? AND appearanceDate < ?";
	const row = await db.get(query, [bossName, startIso, endIso]);
	return row.count > 0;
  }

  // Fragment kodu, który możesz wykorzystać w funkcji updateTable (lub w innej funkcji obsługującej zabójstwa),
  // by sprawdzić, czy dla każdego usuniętego bossa istnieje już rekord (w określonym przedziale). Jeśli nie – dodaj rekord.
  export async function updateAppearancesForRemovedBosses(db, removedBossNames) {
	const { start, end } = getAppearanceTimeWindow();
	const startIso = start.toISOString();
	const endIso = end.toISOString();
	for (const bossName of removedBossNames) {
	  const exists = await checkAppearanceExists(db, bossName);
	  if (!exists) {
		const appearanceDate = new Date().toISOString();
		await addAppearanceUpdate(db, bossName, appearanceDate);
	  }
	}
  }
  

  let removedBossNames = [];

  export function markBossAsRemoved(bossName) {
	removedBossNames.push(bossName);
  }
  
  export function getRemovedBossNames() {
	const names = [...removedBossNames];
	removedBossNames = [];
	return names;
  }

  async function addAppearanceUpdate(db, bossName, dateStr) {
	const query = "INSERT INTO Appearances (bossName, appearanceDate) VALUES (?, ?)";
	await db.run(query, [bossName, dateStr]);
  }

  // Przykładowe użycie w updateTable (fragment funkcji updateTable):
  export async function updateTable(db, tableMessage) {
	try {
	  const removedBosses = getRemovedBossNames();
	  await updateAppearancesForRemovedBosses(db, removedBosses);
	  const tableText = formatBossTableWithoutRaids(globalBossData);
	  const raidsLine = formatRaidsLine(currentRaids);
	  const finalMessage = tableText + "\n" + raidsLine;
	  const components = buildBossButtons(globalBossData);
	  if (tableMessage) {
		await tableMessage.edit({ content: finalMessage, components });
	  }
	} catch (error) {
	  console.error("Error updating table:", error);
	}
  }


/* ------------------ Interaction Handlers ------------------ */

// Handler for role assignment buttons in the roles channel
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const customId = interaction.customId;
  
  // For role toggling in Roles channel
  if (customId.startsWith("role_")) {
    const roleId = customId.slice("role_".length);
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.channel.send({ content: "Role not found.", ephemeral: true });
      return;
    }
    const member = interaction.member;
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role);
      await interaction.channel.send({ content: `Role **${role.name}** removed.`, ephemeral: true });
    } else {
      await member.roles.add(role);
      await interaction.channel.send({ content: `Role **${role.name}** added.`, ephemeral: true });
    }
  }
});

/* ------------------ Found Command Interaction ------------------ */

// Handler for the select menu in !found command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId === "found_select") {
    const selectedRoleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(selectedRoleId);
    if (!role) {
      await interaction.channel.send({ content: "Role not found.", ephemeral: true });
      return;
    }
    const content = `Nemezis ${role} has been found`;
    const button = new ButtonBuilder()
      .setCustomId(`found_x_${role.id}`)
      .setLabel("X")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(button);
    await interaction.channel.send({ content, components: [row] });
  }
});


// Handler for the found button ("found_x_...")
client.on('interactionCreate', async (interaction) => {
	if (!interaction.isButton()) return;
	const customId = interaction.customId;
	if (customId.startsWith("found_x_")) {
	  const roleId = customId.slice("found_x_".length);
	  const role = interaction.guild.roles.cache.get(roleId);
	  if (!role) {
		await interaction.channel.send({ content: "Role not found.", ephemeral: true });
		return;
	  }
	  const bossName = role.name;
	  // Simulate !killed bossName: remove the boss from globalBossData if it exists
	  const index = globalBossData.findIndex(b => b.name.toLowerCase() === bossName.toLowerCase());
	  if (index !== -1) {
		globalBossData.splice(index, 1);
	  }
	  const content = `Nemezis ${bossName} has been killed`;
	  await interaction.update({ content, components: [] });
	  
	  // Optionally update the boss table message if it exists:
	  if (tableMessage) {
		const tableText = formatBossTableWithoutRaids(globalBossData);
		const { raids } = separateRaidBosses(allBossData);
		const finalMessage = tableText + "\n" + formatRaidsLine(raids);
		const components = buildBossButtons(globalBossData);
		await tableMessage.edit({ content: finalMessage, components });
	  }
	}
  });


// Button interaction – "reset_X" resets the timer and saves the player's nick (non-clickable)
client.on('interactionCreate', async (interaction) => {
	if (!interaction.isButton()) return;
	const customId = interaction.customId;
	if (customId.startsWith("reset_")) {
	  const index = parseInt(customId.split("_")[1], 10);
	  if (isNaN(index) || index >= globalBossData.length) {
		await interaction.channel.send({ content: "Invalid button.", ephemeral: true });
		return;
	  }
	  globalBossData[index].lastReset = Date.now();
	  globalBossData[index].player = interaction.member ? interaction.member.displayName : interaction.user.username;
	  const tableText = formatBossTableWithoutRaids(globalBossData);
	  const { raids } = separateRaidBosses(allBossData); // use allBossData for raid info
	  currentRaids = raids;
	  const finalMessage = tableText + "\n" + formatRaidsLine(currentRaids);
	  const components = buildBossButtons(globalBossData);
	  if (tableMessage) {
		await tableMessage.edit({ content: finalMessage, components });
	  }
	}
  });

  
// Przykład aktualizacji tabeli, wykonywanej co jakiś czas:
setInterval(async () => {
	if (!tableMessage) return; // jeśli referencja jest pusta, nic nie robimy
	
	try {
	  // Przygotuj nowy tekst i komponenty
	  const tableText = formatBossTableWithoutRaids(globalBossData);
	  const { raids } = separateRaidBosses(allBossData);
	  const raidsLine = formatRaidsLine(raids);
	  const finalMessage = tableText + "\n" + raidsLine;
	  const components = buildBossButtons(globalBossData);
	  
	  // Próba edycji wiadomości
	  await tableMessage.edit({ content: finalMessage, components });
	} catch (error) {
	  if (error.code === 10008) {
		// 10008 = Unknown Message: wiadomość została usunięta
		console.error("Tabela została usunięta, przerywam aktualizację.");
		tableMessage = null;
	  } else {
		console.error("Błąd podczas aktualizacji tabeli:", error);
	  }
	}
  }, 1000);
  
  // Schedule updateTable to run automatically every day at 10:30
  schedule.scheduleJob('30 10 * * *', async () => {
	console.log("Automatic table update at 10:30");
	await updateTable();
  });

client.on('error', error => {
  console.error("Client error:", error);
});

process.on('unhandledRejection', error => {
  console.error("Unhandled promise rejection:", error);
});

client.login(TOKEN);
