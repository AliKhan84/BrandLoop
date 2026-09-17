/**
 * Tests for thread rendering and publishing.
 *
 * WHY THESE
 *   A thread is the first thing in this codebase where one post has more than
 *   one part, and every part is posted separately. Two failure modes matter and
 *   neither is loud:
 *
 *     • The composer link can only prefill ONE post. If the whole thread were
 *       put in it, X would truncate silently and the user would not know until
 *       after they had clicked.
 *     • Discord's Copy button copies a code block's contents. If the part label
 *       ended up inside the fence, "Part 2 of 3" would be pasted into the tweet.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildThreadCopyBlocks, buildCopyBlock, buildXComposerUrl } from '../src/utils/urlBuilder.js';
import { buildXAssist } from '../src/services/publishing/xPublisher.js';
import { publishPost } from '../src/services/publishing/index.js';
import { PLATFORM } from '../src/config/constants.js';

describe('buildThreadCopyBlocks', () => {
  test('a single segment is a plain block with no label', () => {
    const result = buildThreadCopyBlocks(['Just one post.']);
    assert.equal(result, buildCopyBlock('Just one post.'));
    assert.ok(!result.includes('Part 1 of'));
  });

  test('each part gets its own labelled block', () => {
    const result = buildThreadCopyBlocks(['One', 'Two', 'Three']);
    assert.ok(result.includes('**Part 1 of 3**'));
    assert.ok(result.includes('**Part 2 of 3**'));
    assert.ok(result.includes('**Part 3 of 3**'));
  });

  test('labels sit OUTSIDE the code fence, so Copy does not grab them', () => {
    // The load-bearing detail: Discord's Copy button copies the block contents,
    // so a label inside the fence would be pasted into the tweet.
    // Checked block by block — a whole-string regex cannot express this, because
    // a greedy match spans from the first fence to the last and would "find" a
    // label that actually sits between two blocks.
    const blocks = buildThreadCopyBlocks(['One', 'Two', 'Three']).split('\n\n');

    assert.equal(blocks.length, 3);

    blocks.forEach((block, index) => {
      const label = `**Part ${index + 1} of 3**`;
      assert.ok(block.startsWith(label), `block ${index + 1} should open with its label`);

      // Everything after the label is exactly one fenced body, and the label is
      // not inside it.
      const fenced = block.slice(label.length).trim();
      assert.ok(fenced.startsWith('```') && fenced.endsWith('```'));
      assert.ok(!fenced.includes('Part '));
    });
  });

  test('empty and whitespace-only parts are dropped', () => {
    const result = buildThreadCopyBlocks(['One', '', '   ', 'Two']);
    assert.ok(result.includes('Part 1 of 2'));
    assert.ok(result.includes('Part 2 of 2'));
    assert.ok(!result.includes('Part 3'));
  });

  test('no segments yields an empty string rather than a stray fence', () => {
    assert.equal(buildThreadCopyBlocks([]), '');
    assert.equal(buildThreadCopyBlocks(['', '  ']), '');
  });

  test('a triple backtick in a part cannot break out of its fence', () => {
    const result = buildThreadCopyBlocks(['before ``` after', 'second']);
    // Two opening and two closing fences, no more — nothing escaped.
    assert.equal((result.match(/```/g) ?? []).length, 4);
  });
});

describe('buildXAssist', () => {
  test('a single post is unchanged from before threading existed', () => {
    const payload = buildXAssist({ text: 'A single post.', segments: ['A single post.'] });

    assert.equal(payload.isThread, false);
    assert.equal(payload.copyBlocks, buildCopyBlock('A single post.'));
    assert.equal(payload.linkLabel, 'Open X composer');
    assert.ok(payload.composerUrl.includes(encodeURIComponent('A single post.')));
  });

  test('omitting segments entirely is treated as a single post', () => {
    const payload = buildXAssist({ text: 'A single post.' });
    assert.equal(payload.isThread, false);
    assert.equal(payload.linkLabel, 'Open X composer');
  });

  test('the composer URL carries part 1 ONLY', () => {
    const payload = buildXAssist({
      text: 'Part one.',
      segments: ['Part one.', 'Part two.', 'Part three.'],
    });

    assert.ok(payload.composerUrl.includes(encodeURIComponent('Part one.')));
    // The replies must not be in the link — X cannot prefill more than one post.
    assert.ok(!payload.composerUrl.includes(encodeURIComponent('Part two.')));
    assert.ok(!payload.composerUrl.includes(encodeURIComponent('Part three.')));
  });

  test('the link labels itself as part 1 so the limit is not a surprise', () => {
    const payload = buildXAssist({ text: 'One', segments: ['One', 'Two'] });
    assert.equal(payload.linkLabel, 'Open X composer (part 1)');
    assert.ok(payload.instructions.includes('reply'));
  });

  test('copyBlocks carries every part', () => {
    const payload = buildXAssist({ text: 'One', segments: ['One', 'Two', 'Three'] });
    assert.ok(payload.copyBlocks.includes('Part 1 of 3'));
    assert.ok(payload.copyBlocks.includes('Part 3 of 3'));
  });

  test('copyBlock stays the root, for callers that do not know about threads', () => {
    const payload = buildXAssist({ text: 'One', segments: ['One', 'Two'] });
    assert.equal(payload.copyBlock, buildCopyBlock('One'));
  });
});

describe('publishPost routes threads to X only', () => {
  const threadedPost = {
    platform: PLATFORM.X,
    content: 'Root post.',
    thread: ['Reply one.', 'Reply two.'],
    hashtags: ['#AI'],
    fullText: () => 'Root post.\n\n#AI',
    postSegments: () => ['Root post.\n\n#AI', 'Reply one.', 'Reply two.'],
  };

  test('an X thread reports isThread and keeps the root in the link', () => {
    const payload = publishPost(threadedPost);
    assert.equal(payload.isThread, true);
    assert.ok(payload.composerUrl.includes(encodeURIComponent('Root post.')));
    assert.ok(!payload.composerUrl.includes(encodeURIComponent('Reply one.')));
  });

  test('a LinkedIn post never becomes a thread, even if one is stored', () => {
    const payload = publishPost({
      ...threadedPost,
      platform: PLATFORM.LINKEDIN,
    });

    // LinkedIn has no thread mechanic here; `isThread` must be undefined/falsey
    // so nothing downstream tries to render parts for it.
    assert.ok(!payload.isThread);
  });

  test('a plain object without postSegments still works', () => {
    const payload = publishPost({
      platform: PLATFORM.X,
      content: 'Plain object post.',
      hashtags: [],
    });

    assert.equal(payload.isThread, false);
    assert.ok(payload.composerUrl.includes(encodeURIComponent('Plain object post.')));
  });
});

describe('composer URL limits still apply to a thread root', () => {
  test('an over-long root yields no link rather than a broken one', () => {
    // The existing guarantee must survive: a URL too long to be reliable returns
    // null, and the user falls back to the copy block.
    const huge = 'x'.repeat(3000);
    assert.equal(buildXComposerUrl(huge), null);

    const payload = buildXAssist({ text: huge, segments: [huge, 'short reply'] });
    assert.equal(payload.composerUrl, null);
    assert.equal(payload.prefilled, false);
    assert.ok(payload.warning);
  });
});

describe('LinkedIn links route through the copy-and-open page', () => {
  // LinkedIn's share endpoint cannot prefill post text — it builds the card from
  // the destination page's Open Graph tags. So unlike X, its link has to point
  // somewhere that can put the text on the clipboard first.

  const linkedInPost = {
    _id: '6aabfaae2d92e7db48f43e00',
    platform: PLATFORM.LINKEDIN,
    content: 'A LinkedIn post.',
    thread: [],
    hashtags: [],
    fullText: () => 'A LinkedIn post.',
  };

  test('the LinkedIn link points at the dashboard compose page', () => {
    const payload = publishPost(linkedInPost);

    assert.ok(
      payload.composerUrl.includes('/compose/6aabfaae2d92e7db48f43e00'),
      `got ${payload.composerUrl}`,
    );
    assert.equal(payload.prefilled, false);
  });

  test('the button says it copies, not just opens', () => {
    const payload = publishPost(linkedInPost);
    assert.ok(payload.linkLabel.toLowerCase().includes('copy'));
    assert.ok(payload.instructions.toLowerCase().includes('copies'));
  });

  test('a post with no id falls back to the plain LinkedIn composer', () => {
    // Plain objects turn up in tests and scripts; they must still produce a
    // usable link rather than `/compose/undefined`.
    const payload = publishPost({ ...linkedInPost, _id: undefined });

    assert.ok(payload.composerUrl.startsWith('https://www.linkedin.com/'), `got ${payload.composerUrl}`);
    assert.ok(!payload.composerUrl.includes('undefined'));
    assert.equal(payload.linkLabel, 'Open LinkedIn composer');
  });

  test('X is unaffected — it still prefills directly', () => {
    // The regression guard: routing LinkedIn through a page must not drag X
    // along with it, because X's link genuinely works as-is.
    const payload = publishPost({
      _id: 'abc',
      platform: PLATFORM.X,
      content: 'An X post.',
      thread: [],
      hashtags: [],
      fullText: () => 'An X post.',
    });

    assert.ok(payload.composerUrl.startsWith('https://x.com/intent/post'));
    assert.equal(payload.prefilled, true);
    assert.ok(!payload.composerUrl.includes('/compose/'));
  });
});

describe('a post longer than one Discord message still gets delivered', () => {
  // THE REGRESSION THIS EXISTS FOR: Discord caps message content at 2000
  // characters. A fenced LinkedIn post can reach ~3008, so `channel.send`
  // rejected the whole message with error 50035 and the DM never arrived — for
  // every LinkedIn post over ~1992 characters. X was never affected because 280
  // fits, which made it look like a LinkedIn problem rather than a length one.

  const longBody = 'word '.repeat(600).trim(); // ~2999 characters

  function fakePost(text) {
    return {
      _id: 'abc',
      dayIndex: 1,
      platform: PLATFORM.LINKEDIN,
      type: 'planned',
      theme: 'A theme',
      content: text,
      thread: [],
      hashtags: [],
      status: 'pending_approval',
      imageUrl: null,
      fullText: () => text,
      postSegments: () => [text],
    };
  }

  test('a long LinkedIn post produces content within the Discord limit', async () => {
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');
    const { DISCORD_CONTENT_LIMIT } = await import('../src/config/constants.js');

    const payload = buildApprovalPayload(fakePost(longBody));

    assert.ok(
      payload.content.length <= DISCORD_CONTENT_LIMIT,
      `content was ${payload.content.length}, limit is ${DISCORD_CONTENT_LIMIT}`,
    );
  });

  test('the full text is preserved in the embed description, not truncated away', async () => {
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');
    const { DISCORD_EMBED_DESCRIPTION_LIMIT } = await import('../src/config/constants.js');

    const payload = buildApprovalPayload(fakePost(longBody));
    const embed = payload.embeds[0].toJSON();

    assert.ok(embed.description, 'the post text should have moved into the description');
    assert.ok(embed.description.includes(longBody), 'the whole post should survive');
    assert.ok(embed.description.length <= DISCORD_EMBED_DESCRIPTION_LIMIT);
  });

  test('the approve/reject/edit buttons survive the overflow', async () => {
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');
    const payload = buildApprovalPayload(fakePost(longBody));

    // If the buttons were lost, the post would be undeliverable in a different
    // way — visible but unactionable.
    assert.equal(payload.components.length, 1);
  });

  test('a short post is unchanged: still a code block with its Copy button', async () => {
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');
    const payload = buildApprovalPayload(fakePost('A short LinkedIn post.'));

    assert.ok(payload.content.includes('```'));
    const embed = payload.embeds[0].toJSON();
    assert.ok(!embed.description, 'a short post should not use the description fallback');
  });

  test('a 3000-character post still fits the fallback with room to spare', async () => {
    const { DISCORD_EMBED_DESCRIPTION_LIMIT, LINKEDIN_CHAR_LIMIT } = await import('../src/config/constants.js');

    // The fallback only works if the embed description can hold the largest
    // post the platform allows. If this ever fails, raise the fallback rather
    // than letting delivery break again.
    const maxLinkedIn = Number(LINKEDIN_CHAR_LIMIT ?? 3000);
    assert.ok(
      maxLinkedIn < DISCORD_EMBED_DESCRIPTION_LIMIT,
      `LinkedIn allows ${maxLinkedIn} but the embed description holds ${DISCORD_EMBED_DESCRIPTION_LIMIT}`,
    );
  });
});
