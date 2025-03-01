require("dotenv").config();
const mongoose = require("mongoose");

const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const warningMsg = `---------------
!!! WARNING !!!
---------------
This script will migrate your database from v4 to v5. This script is still a work in progress and irreversible.
Please make sure you have a backup of your database before proceeding.
Do you want to continue? (y/n): `;

rl.question(warningMsg, async function (name) {
  try {
    if (name.toLowerCase() === "y") {
      console.log("ðŸš€ Starting migration (v4 to v5)");
      await migration();
      console.log("âš¡ Migration complete");
      process.exit(0);
    } else {
      console.log("Migration cancelled");
      process.exit(0);
    }
  } catch (ex) {
    console.log(ex);
    process.exit(1);
  }
});

async function migration() {
  // Connect to database
  await mongoose.connect(process.env.MONGO_CONNECTION, { keepAlive: true });
  console.log("ðŸ”Œ Database connection established");

  // Get all collections
  const collections = await mongoose.connection.db.collections();
  console.log(`ðŸ”Ž Found ${collections.length} collections`);

  await migrateGuilds(collections);
  await migrateModLogs(collections);
  await migrateTranslateLogs(collections);
  await migrateSuggestions(collections);
  await migrateMemberStats(collections);
  await migrateMembers(collections);
  await migrateUsers(collections);
  await migrateMessages(collections);
}

const clearAndLog = (message) => {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  console.log(message);
};

/**
 * Migrate mod-logs collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateGuilds = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'guilds' collection ");
  try {
    const guildsC = collections.find((c) => c.collectionName === "guilds");
    const toUpdate = await guildsC
      .find({
        $or: [
          { "data.owner": { $type: "object" } },
          { "automod.strikes": 5 },
          { "automod.action": "MUTE" },
          { "automod.anti_scam": { $exists: true } },
          { "max_warn.strikes": 5 },
          { ranking: { $exists: true } },
        ],
      })
      .toArray();

    if (toUpdate.length > 0) {
      for (const doc of toUpdate) {
        if (typeof doc.data.owner === "object") doc.data.owner = doc.data.owner.id;
        if (typeof doc.automod === "object") {
          if (doc.automod.strikes === 5) doc.automod.strikes = 10;
          if (doc.automod.action === "MUTE") doc.automod.action = "TIMEOUT";
          doc.automod.anti_spam = doc.automod.anti_scam || false;
        }
        if (typeof doc.max_warn === "object") {
          if (doc.max_warn.action === "MUTE") doc.automod.action = "TIMEOUT";
          if (doc.max_warn.action === "BAN") doc.automod.action = "KICK";
        }
        if (typeof doc.stats !== "object") doc.stats = {};
        if (doc.ranking?.enabled) doc.stats.enabled = true;
        await guildsC.updateOne({ _id: doc._id }, { $set: doc });

        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(
          `ðŸ“¦ Migrating 'guilds' collection | Completed - ${Math.round(
            (toUpdate.indexOf(doc) / toUpdate.length) * 100
          )}%`
        );
      }

      await guildsC.updateMany(
        {},
        {
          $unset: {
            "automod.anti_scam": "",
            "automod.max_mentions": "",
            "automod.max_role_mentions": "",
            ranking: "",
          },
        }
      );

      clearAndLog(`ðŸ“¦ Migrating 'guilds' collection | âœ… Updated: ${toUpdate.length}`);
    } else {
      clearAndLog("ðŸ“¦ Migrating 'guilds' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'guilds' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate mod-logs collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateModLogs = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'mod-logs' collection ");
  try {
    const modLogs = collections.find((c) => c.collectionName === "mod-logs");
    const stats = await modLogs.updateMany({}, { $unset: { expires: "" } });
    await modLogs.updateMany({ type: "MUTE" }, { $set: { type: "TIMEOUT" } });
    await modLogs.updateMany({ type: "UNMUTE" }, { $set: { type: "UNTIMEOUT" } });
    console.log(`| âœ… ${stats.modifiedCount > 0 ? `Updated: ${stats.modifiedCount}` : "No updates required"}`);
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'mod-logs' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate translate-logs collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateTranslateLogs = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'translate-logs' collection ");
  console.log("| âœ… No updates required");
};

/**
 * Migrate suggestions collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateSuggestions = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'suggestions' collection ");
  try {
    const suggestionsC = collections.find((c) => c.collectionName === "suggestions");

    const toUpdate = await suggestionsC
      .find({ $or: [{ channel_id: { $exists: false } }, { createdAt: { $exists: true } }] })
      .toArray();

    if (toUpdate.length > 0) {
      // cache all guilds
      const guilds = await collections
        .find((c) => c.collectionName === "guilds")
        .find({})
        .toArray();
      const cache = new Map();
      for (const guild of guilds) cache.set(guild._id, guild);

      for (const doc of toUpdate) {
        const guildDb = cache.get(doc.guild_id);
        await suggestionsC.updateOne(
          { _id: doc._id },
          {
            $set: { channel_id: guildDb.suggestions.channel_id },
            $rename: { createdAt: "created_at", updatedAt: "updated_at" },
          }
        );
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(
          `ðŸ“¦ Migrating 'suggestions' collection | Completed - ${Math.round(
            (toUpdate.indexOf(doc) / toUpdate.length) * 100
          )}%`
        );
      }

      clearAndLog(`ðŸ“¦ Migrating 'suggestions' collection | âœ… Updated: ${toUpdate.length}`);
    } else {
      clearAndLog("ðŸ“¦ Migrating 'suggestions' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'suggestions' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate member-stats collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateMemberStats = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'member-stats' collection ");
  try {
    const membersC = collections.find((c) => c.collectionName === "members");
    if (!collections.find((c) => c.collectionName === "member-stats")) {
      const memberStatsC = await mongoose.connection.db.createCollection("member-stats");

      const toUpdate = await membersC
        .find({ $or: [{ xp: { $exists: true } }, { level: { $exists: true } }] })
        .toArray();
      if (toUpdate.length > 0) {
        for (const doc of toUpdate) {
          await memberStatsC.insertOne({
            guild_id: doc.guild_id,
            member_id: doc.member_id,
            xp: doc.xp,
            level: doc.level,
          });
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          process.stdout.write(
            `ðŸ“¦ Migrating 'member-stats' collection | Completed - ${Math.round(
              (toUpdate.indexOf(doc) / toUpdate.length) * 100
            )}%`
          );
        }

        clearAndLog(`ðŸ“¦ Migrating 'member-stats' collection | âœ… Updated: ${toUpdate.length}`);
      } else {
        clearAndLog("ðŸ“¦ Migrating 'member-stats' collection | âœ… No updates required");
      }
    } else {
      clearAndLog("ðŸ“¦ Migrating 'member-stats' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'member-stats' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate members collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateMembers = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'members' collection ");
  try {
    const membersC = collections.find((c) => c.collectionName === "members");
    const toUpdate = await membersC.find({ $or: [{ xp: { $exists: true } }, { level: { $exists: true } }] }).toArray();
    if (toUpdate.length > 0) {
      const stats = await membersC.updateMany({}, { $unset: { xp: "", level: "", mute: "" } });
      clearAndLog(`ðŸ“¦ Migrating 'members' collection | âœ… Updated: ${stats.modifiedCount}`);
    } else {
      clearAndLog("ðŸ“¦ Migrating 'members' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'members' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate users collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateUsers = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'users' collection ...");
  try {
    const usersC = collections.find((c) => c.collectionName === "users");

    const toUpdate = await usersC
      .find({ $or: [{ username: { $exists: false } }, { discriminator: { $exists: false } }] })
      .toArray();

    if (toUpdate.length > 0) {
      const { Client, GatewayIntentBits } = require("discord.js");
      const client = new Client({ intents: [GatewayIntentBits.Guilds] });
      await client.login(process.env.BOT_TOKEN);

      let success = 0,
        failed = 0;

      for (const doc of toUpdate) {
        try {
          const user = await client.users.fetch(doc._id);
          await usersC.updateOne(
            { _id: doc._id },
            { $set: { username: user.username, discriminator: user.discriminator } }
          );
          success++;
        } catch (e) {
          failed++;
        }

        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(
          `ðŸ“¦ Migrating 'users' collection | Completed - ${Math.round(
            (toUpdate.indexOf(doc) / toUpdate.length) * 100
          )}%`
        );
      }

      clearAndLog(`ðŸ“¦ Migrating 'users' collection | âœ… Updated: ${success} | âŒ Failed: ${failed}`);
    } else {
      clearAndLog("ðŸ“¦ Migrating 'users' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'users' collection | âŒ Error occurred");
    console.log(ex);
  }
};

/**
 * Migrate messages collection from v4 to v5
 * @param {mongoose.Collection<mongoose.Document>[]} collections
 */
const migrateMessages = async (collections) => {
  process.stdout.write("ðŸ“¦ Migrating 'messages' collection ");
  try {
    if (
      !collections.find((c) => c.collectionName === "v4-ticket-backup") &&
      !collections.find((c) => c.collectionName === "reaction-roles") &&
      collections.find((c) => c.collectionName === "messages")
    ) {
      const rrolesC = await mongoose.connection.db.createCollection("reaction-roles");
      const ticketsC = await mongoose.connection.db.createCollection("v4-ticket-backup");
      const messagesC = collections.find((c) => c.collectionName === "messages");

      const rrToUpdate = await messagesC.find({ roles: { $exists: true, $ne: [] } }).toArray();
      const tToUpdate = await messagesC.find({ ticket: { $exists: true } }).toArray();

      if (rrToUpdate.length > 0 || tToUpdate.length > 0) {
        await rrolesC.insertMany(
          rrToUpdate.map((doc) => ({
            guild_id: doc.guild_id,
            channel_id: doc.channel_id,
            message_id: doc.message_id,
            roles: doc.roles,
          }))
        );

        await ticketsC.insertMany(
          tToUpdate.map((doc) => ({
            guild_id: doc.guild_id,
            channel_id: doc.channel_id,
            message_id: doc.message_id,
            ticket: doc.ticket,
          }))
        );

        await mongoose.connection.db.dropCollection("messages");

        clearAndLog(
          `ðŸ“¦ Migrating 'messages' collection | Completed - Updated: ${rrToUpdate.length + tToUpdate.length}`
        );
      } else {
        await mongoose.connection.db.dropCollection("messages");
        clearAndLog("ðŸ“¦ Migrating 'messages' collection | âœ… No updates required");
      }
    } else {
      clearAndLog("ðŸ“¦ Migrating 'messages' collection | âœ… No updates required");
    }
  } catch (ex) {
    clearAndLog("ðŸ“¦ Migrating 'messages' collection | âŒ Error occurred");
    console.log(ex);
  }
};
