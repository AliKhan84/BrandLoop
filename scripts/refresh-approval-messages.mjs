// Re-renders existing Discord messages in place, so a change to the link a
// publisher emits reaches messages that were already sent. Edits the existing
// message rather than sending a new one, so nothing is duplicated in the DM.
import 'dotenv/config';
import mongoose from 'mongoose';

import { refreshApprovalMessage } from '../src/services/discord/approvalQueue.js';
import { startDiscord, stopDiscord } from '../src/services/discord/client.js';
import { publishPost } from '../src/services/publishing/index.js';

const emailIndex = process.argv.indexOf('--email');
const EMAIL = emailIndex >= 0 ? process.argv[emailIndex + 1] : null;

if (!EMAIL) {
  console.error('Usage: node scripts/refresh-approval-messages.mjs --email you@example.com');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME ?? 'brandloop',
});
const db = mongoose.connection.db;

const user = await db.collection('users').findOne({ email: EMAIL });
if (!user) {
  console.error(`No user with email ${EMAIL}`);
  process.exit(1);
}

// Every post with a message still in the DM.
const posts = await db
  .collection('posts')
  .find({ userId: user._id, discordMessageId: { $ne: null } })
  .sort({ dayIndex: 1, platform: 1 })
  .toArray();

console.log(`${EMAIL}: ${posts.length} message(s) to re-render`);
for (const p of posts) console.log(`  day ${p.dayIndex} ${p.platform} (${p.status})`);

if (posts.length === 0) {
  await mongoose.disconnect();
  process.exit(0);
}

const { Post } = await import('../src/models/Post.js');
const { User } = await import('../src/models/User.js');
const { buildPublishedPayload } = await import('../src/services/discord/interactions.js');
const { getDiscordClient } = await import('../src/services/discord/client.js');

console.log('');
console.log('connecting to Discord…');
await startDiscord();

let ok = 0;
let failed = 0;

for (const raw of posts) {
  const post = await Post.findById(raw._id);
  const owner = await User.findById(post.userId);

  // WHICH PAYLOAD DEPENDS ON THE POST'S STATE, and getting it wrong would revert
  // the message: an approved post has already been actioned, so re-rendering it
  // as an approval prompt would put the buttons back and invite a second
  // publish. Approved posts get the published layout; everything else gets the
  // approval prompt.
  const isActioned = post.status === 'approved';
  const payload = isActioned
    ? buildPublishedPayload(post, publishPost(post))
    : null;

  let done = false;
  try {
    if (payload) {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(post.discordChannelId);
      const message = await channel.messages.fetch(post.discordMessageId);
      await message.edit(payload);
      done = true;
    } else {
      done = await refreshApprovalMessage(post, owner);
    }
  } catch (err) {
    console.log(`   error: ${err.message}`);
  }

  if (done) {
    ok += 1;
    console.log(`  REFRESHED  day ${post.dayIndex} ${post.platform} (${post.status})`);
  } else {
    failed += 1;
    console.log(`  FAILED     day ${post.dayIndex} ${post.platform}`);
  }
}

console.log('');
console.log(`refreshed ${ok}, failed ${failed}`);

await stopDiscord();
await mongoose.disconnect();

