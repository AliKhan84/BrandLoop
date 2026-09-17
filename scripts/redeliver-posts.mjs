// Re-delivers posts that were generated but never reached Discord.
//
// This is the recovery for the 50035 failure: the posts exist and are worth
// keeping, so re-sending them is correct where regenerating would spend a model
// call on text that was already written.
//
// SCOPED TO ONE ACCOUNT ON PURPOSE. A bare "every undelivered post" query also
// picks up fixture rows from test runs, and those must not be sent to a real
// Discord account. Pass the email to redeliver for.
//
// Usage:
//   node scripts/redeliver-posts.mjs --email you@example.com --dry-run
//   node scripts/redeliver-posts.mjs --email you@example.com
import 'dotenv/config';
import mongoose from 'mongoose';

import { queuePostForApproval } from '../src/services/discord/approvalQueue.js';
import { startDiscord, stopDiscord } from '../src/services/discord/client.js';

const DRY_RUN = process.argv.includes('--dry-run');
const emailIndex = process.argv.indexOf('--email');
const EMAIL = emailIndex >= 0 ? process.argv[emailIndex + 1] : null;

if (!EMAIL) {
  console.error('Refusing to run without --email. See the note at the top of this file.');
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

if (!user.discordUserId) {
  console.error(`${EMAIL} has no linked Discord account — nothing can be delivered.`);
  process.exit(1);
}

const undelivered = await db
  .collection('posts')
  .find({
    userId: user._id,
    $or: [{ discordMessageId: null }, { discordMessageId: { $exists: false } }],
  })
  .sort({ dayIndex: 1, platform: 1 })
  .toArray();

console.log(`${EMAIL}: ${undelivered.length} undelivered post(s)`);
for (const post of undelivered) {
  const len = (post.content ?? '').length + (post.hashtags?.length ? post.hashtags.join(' ').length + 2 : 0);
  console.log(`  day ${post.dayIndex} | ${post.platform} | ${post.status} | ${len} chars`);
}

if (undelivered.length === 0) {
  await mongoose.disconnect();
  process.exit(0);
}

if (DRY_RUN) {
  console.log('');
  console.log('dry run — nothing sent.');
  await mongoose.disconnect();
  process.exit(0);
}

// The Post model needs to be loaded for `save()` to work on these documents.
const { Post } = await import('../src/models/Post.js');
const { User } = await import('../src/models/User.js');

console.log('');
console.log('connecting to Discord…');
await startDiscord();

let sent = 0;
let failed = 0;

for (const raw of undelivered) {
  const post = await Post.findById(raw._id);
  const owner = await User.findById(post.userId);

  const result = await queuePostForApproval(post, owner);

  if (result.sent) {
    sent += 1;
    console.log(`  SENT    day ${post.dayIndex} ${post.platform} -> ${result.messageId}`);
  } else {
    failed += 1;
    console.log(`  FAILED  day ${post.dayIndex} ${post.platform} -> ${result.reason}`);
  }
}

console.log('');
console.log(`delivered ${sent}, failed ${failed}`);

await stopDiscord();
await mongoose.disconnect();
process.exit(failed === 0 ? 0 : 1);

