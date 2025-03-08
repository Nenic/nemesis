// roleCommands.js
import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { getAllBossNames } from './src/bossNames.js';

/**
 * Creates roles for all bosses using boss names.
 * Command: !addBossRoles
 */
export async function handleAddBossRoles(message) {
  try {
    const bossNames = getAllBossNames();
    for (const bossName of bossNames) {
      let role = message.guild.roles.cache.find(r => r.name === bossName);
      if (!role) {
        role = await message.guild.roles.create({
          name: bossName,
          reason: "Role created based on boss names from GuildStats"
        });
        console.log('Created role: ${role.name}');
      } else {
        console.log('Role already exists: ${role.name}');
      }
    }
    await message.reply("Roles for all bosses have been added to the server.");
  } catch (error) {
    console.error("Error in !addBossRoles:", error);
    await message.reply("An error occurred while adding boss roles.");
  }
}

/**
 * Creates a "roles" channel and posts role assignment buttons grouped by first letter.
 * Command: !addRolesRoom
 */
export async function handleAddRolesRoom(message) {
  try {
    // Find or create a text channel named "roles" (case-insensitive)
    let rolesChannel = message.guild.channels.cache.find(ch => ch.name.toLowerCase() === "roles" && ch.type === ChannelType.GuildText);
    if (!rolesChannel) {
      rolesChannel = await message.guild.channels.create({
        name: "roles",
        type: ChannelType.GuildText,
        reason: "Creating Roles channel for role assignment buttons"
      });
    }
    const bossNames = getAllBossNames();
    // Group roles by first letter
    const groups = {};
    for (const bossName of bossNames) {
      const role = message.guild.roles.cache.find(r => r.name === bossName);
      if (!role) continue;
      const letter = bossName.charAt(0).toUpperCase();
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(role);
    }
    // For each group, create buttons (max 5 per row)
    for (const letter of Object.keys(groups).sort()) {
      const rolesForLetter = groups[letter];
      const buttons = rolesForLetter.map(role => new ButtonBuilder()
        .setCustomId('role_${role.id}')
        .setLabel(role.name)
        .setStyle(ButtonStyle.Secondary));
      
      // Split buttons into rows of 5
      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }
      await rolesChannel.send('{ content: **${letter}**, components: rows }');
    }
    await message.reply("Roles channel has been created/updated with role assignment buttons grouped by letter.");
  } catch (error) {
    console.error("Error in !addRolesRoom:", error);
    await message.reply("An error occurred while creating the roles channel.");
  }
}

export async function handleFoundCommand(message) {
  // Try to find the channel named "bosses" (case-insensitive)
  const bossesChannel = message.guild.channels.cache.find(ch => ch.name.toLowerCase() === "bosses" && ch.type === ChannelType.GuildText);
  if (!bossesChannel) {
    await message.reply("The 'bosses' channel was not found.");
    return;
  }
  
  // Check if a role mention is provided in the command
  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) {
    // Send the found notification to the bosses channel
    const content = `Nemezis ${mentionedRole} has been found`;
    const button = new ButtonBuilder()
      .setCustomId(`found_x_${mentionedRole.id}`)
      .setLabel("Killed")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(button);
    await bossesChannel.send({ content, components: [row] });
  } else {
    // If no role is mentioned, send a select menu with role suggestions
    const bossNames = getAllBossNames();
    const options = [];
    for (const bossName of bossNames) {
      const role = message.guild.roles.cache.find(r => r.name === bossName);
      if (!role) continue;
      options.push(new StringSelectMenuOptionBuilder()
        .setLabel(role.name)
        .setValue(role.id));
    }
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("found_select")
      .setPlaceholder("Select a role")
      .addOptions(options.slice(0, 25)); // maximum 25 options per menu
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await bossesChannel.send({ content: "Please select a role:", components: [row] });
  }
}
