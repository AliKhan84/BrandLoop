/**
 * Tests for `services/ai/imageGenerator.js` and the image side of delivery.
 *
 * WHY THESE
 *   Two things here fail quietly. A prompt built without the style suffix still
 *   produces an image — just one that does not match the account's other posts,
 *   and nothing errors. And a mis-classified failure reports "the request
 *   failed" where the truth is "the model refused the art direction", which
 *   changes both what the user is told and whether an operator goes looking for
 *   a bug. Both are pure functions, so both can be pinned down exactly.
 *
 *   The delivery tests cover the case that has no error path at all: a post
 *   that points at an image whose file is not on disk. Checking for that is the
 *   difference between a text-only draft and a message Discord rejects for
 *   referencing something that is not there.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import {
  buildImagePrompt,
  classifyImageError,
  imageFilenameFor,
  imageFilePathFor,
  IMAGE_SKIP_NOTES,
} from '../src/services/ai/imageGenerator.js';
import { estimateCostUsd } from '../src/services/usageLogger.js';
import { IMAGE_STYLE_SUFFIX, MEDIA_DIR, PLATFORM } from '../src/config/constants.js';

describe('buildImagePrompt', () => {
  const post = { imagePrompt: 'A lighthouse at dusk, seen from the water.' };

  test('returns null when the post carries no art direction', () => {
    // Null is the signal for "nothing to illustrate", which is not an error —
    // only a failure to honour a request is.
    assert.equal(buildImagePrompt({ imagePrompt: null }), null);
    assert.equal(buildImagePrompt({ imagePrompt: '' }), null);
    assert.equal(buildImagePrompt({ imagePrompt: '   ' }), null);
    assert.equal(buildImagePrompt({}), null);
  });

  test('includes the model\'s art direction', () => {
    assert.ok(buildImagePrompt(post).includes(post.imagePrompt));
  });

  test('ends with the style suffix, so the brand constraints are read last', () => {
    const prompt = buildImagePrompt(post);
    assert.ok(prompt.endsWith(IMAGE_STYLE_SUFFIX));
  });

  test('the suffix is what carries the no-text instruction', () => {
    // The model is asked never to describe text in an image (PostDraftSchema),
    // and this is the backstop when it does anyway.
    assert.match(IMAGE_STYLE_SUFFIX, /do not include any text/i);
  });

  test('mentions the niche when the user has one', () => {
    const prompt = buildImagePrompt(post, { niche: 'AI in healthcare' });
    assert.ok(prompt.includes('AI in healthcare'));
  });

  test('omits the niche line when there is no niche', () => {
    const withUser = buildImagePrompt(post, { niche: '' });
    assert.equal(withUser, buildImagePrompt(post));
  });
});

describe('classifyImageError', () => {
  test('recognises a moderation block and keeps the provider detail', () => {
    // The shape OpenAI throws: the refusal code on the error, the categories
    // and the stage inside the parsed response body.
    const failure = classifyImageError({
      code: 'moderation_blocked',
      status: 400,
      error: {
        code: 'moderation_blocked',
        moderation_details: {
          categories: { violence: true, sexual: false },
          moderation_stage: 'generation',
        },
      },
    });

    assert.equal(failure.reason, 'moderation_blocked');
    assert.equal(failure.statusCode, 422);
    assert.deepEqual(failure.detail.categories, { violence: true, sexual: false });
    assert.equal(failure.detail.stage, 'generation');
  });

  test('recognises the mirrored code from the Gemini refusal path', () => {
    // gemini.js sets the same `code` on an IMAGE_SAFETY refusal so there is one
    // vocabulary to match on. No body, so the detail is simply absent.
    const failure = classifyImageError({ code: 'moderation_blocked' });

    assert.equal(failure.reason, 'moderation_blocked');
    assert.equal(failure.detail.categories, null);
    assert.equal(failure.detail.stage, null);
  });

  test('treats an abort as a timeout, not as an unknown failure', () => {
    // A DOMException's numeric `code` is not an HTTP status; the name is the
    // reliable signal. Getting this wrong is what made slow Gemini calls look
    // like non-retryable 4xx responses (plan amendment A8).
    const abort = new Error('aborted');
    abort.name = 'AbortError';

    assert.equal(classifyImageError(abort).reason, 'timeout');
    assert.equal(classifyImageError({ name: 'TimeoutError' }).reason, 'timeout');
    assert.equal(classifyImageError({ status: 408 }).reason, 'timeout');
  });

  test('everything else is a plain failure, with the upstream status kept', () => {
    const failure = classifyImageError({ status: 500, message: 'server error' });

    assert.equal(failure.reason, 'failed');
    assert.equal(failure.statusCode, 502);
    assert.equal(failure.detail.status, 500);
  });

  test('survives a non-object throw', () => {
    assert.equal(classifyImageError('boom').reason, 'failed');
    assert.equal(classifyImageError(undefined).reason, 'failed');
  });
});

describe('image storage layout', () => {
  test('the filename is the post id with a jpg extension', () => {
    assert.equal(imageFilenameFor('6aabfaae2d92e7db48f43e00'), '6aabfaae2d92e7db48f43e00.jpg');
  });

  test('the path is inside the media directory', () => {
    const path = imageFilePathFor('abc123');
    assert.ok(path.includes(MEDIA_DIR), `expected a path under ${MEDIA_DIR}, got ${path}`);
    assert.ok(path.endsWith('abc123.jpg'));
  });
});

describe('IMAGE_SKIP_NOTES', () => {
  test('covers every reason the pipeline can store', () => {
    for (const reason of ['quota', 'moderation_blocked', 'timeout', 'failed']) {
      assert.ok(IMAGE_SKIP_NOTES[reason], `missing a note for "${reason}"`);
    }
  });

  test('no note claims an image exists', () => {
    for (const note of Object.values(IMAGE_SKIP_NOTES)) {
      assert.match(note, /^Not generated/);
    }
  });
});

describe('image cost estimation', () => {
  test('estimates a gpt-image-1 image from its token usage', () => {
    // Measured live: one 1024x1024 medium image was 31 input / 1,056 output
    // tokens. The point is that the row is not null in the cost report.
    const cost = estimateCostUsd({ model: 'gpt-image-1', inputTokens: 31, outputTokens: 1056 });

    assert.ok(cost !== null, 'an image model must have a rate, or the report understates spend');
    assert.ok(cost > 0.02 && cost < 0.08, `expected roughly $0.04, got ${cost}`);
  });

  test('an unknown model reports null rather than guessing', () => {
    assert.equal(estimateCostUsd({ model: 'some-future-model', inputTokens: 10, outputTokens: 10 }), null);
  });
});

describe('approval payload carries the image', () => {
  // A real file is written into the gitignored media directory so the
  // attachment path is genuinely exercised, then removed.
  const postId = 'test-image-attachment-0001';

  function fakePost({ imageUrl }) {
    return {
      _id: postId,
      dayIndex: 1,
      platform: PLATFORM.LINKEDIN,
      type: 'planned',
      theme: 'A theme',
      content: 'A short post.',
      thread: [],
      hashtags: [],
      status: 'pending_approval',
      needsImage: true,
      imageUrl,
      imageSkipReason: null,
      fullText: () => 'A short post.',
      postSegments: () => ['A short post.'],
    };
  }

  /** Creates the image file the payload expects, so the attachment path runs. */
  async function writePlaceholderImage() {
    const file = imageFilePathFor(postId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff]));
    return file;
  }

  test('a post with an image on disk attaches the file and links the download', async () => {
    const file = await writePlaceholderImage();

    try {
      const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');

      const payload = buildApprovalPayload(fakePost({ imageUrl: `http://localhost:8080/media/${postId}.jpg` }));

      assert.equal(payload.files.length, 1, 'the image should ride along with the message');
      assert.equal(payload.files[0].name, `${postId}.jpg`);

      const embed = payload.embeds[0].toJSON();
      const imageField = embed.fields.find((field) => field.name === 'Image');
      assert.ok(imageField, 'the download link should still be present');
      assert.ok(imageField.value.includes(`${postId}.jpg`));
    } finally {
      await rm(file, { force: true });
    }
  });

  test('an image URL with no file on disk degrades to the link alone', async () => {
    // The fresh-clone and cleanup case: the post still references the image,
    // the media directory does not have it, and the message must still send.
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');

    const payload = buildApprovalPayload(fakePost({ imageUrl: 'http://localhost:8080/media/missing.jpg' }));

    assert.equal(payload.files.length, 0);
    const embed = payload.embeds[0].toJSON();
    assert.ok(embed.fields.find((field) => field.name === 'Image'), 'the link is still better than nothing');
  });

  test('a re-render re-attaches the file, because an edit otherwise drops it', async () => {
    // Verified live, and this is the regression guard: re-rendering a message
    // WITHOUT the file left it with no attachment at all, because Discord does
    // not preserve attachments across an edit. The tempting "optimisation" of
    // not re-uploading on refresh silently strips the image.
    const file = await writePlaceholderImage();

    try {
      const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');

      const post = fakePost({ imageUrl: `http://localhost:8080/media/${postId}.jpg` });
      const payload = buildApprovalPayload(post);

      assert.equal(payload.files.length, 1, 'an edited message must carry the image again');
    } finally {
      await rm(file, { force: true });
    }
  });

  test('a skipped image explains itself in the embed', async () => {
    const { buildApprovalPayload } = await import('../src/services/discord/approvalQueue.js');

    const post = {
      ...fakePost({ imageUrl: null }),
      imageSkipReason: IMAGE_SKIP_NOTES.moderation_blocked,
    };

    const embed = buildApprovalPayload(post).embeds[0].toJSON();
    const imageField = embed.fields.find((field) => field.name === 'Image');

    assert.ok(imageField);
    assert.equal(imageField.value, IMAGE_SKIP_NOTES.moderation_blocked);
  });

  describe('the approved message keeps the image', () => {
    // The Approve handler edits the approval message into the published layout.
    // Because Discord drops attachments on an edit unless they are re-sent, an
    // approved post would otherwise lose its image at exactly the moment the
    // user needs it for the manual publish.

    test('the published payload re-attaches the file', async () => {
      const file = await writePlaceholderImage();

      try {
        const { buildPublishedPayload } = await import('../src/services/discord/interactions.js');
        const { publishPost } = await import('../src/services/publishing/index.js');

        const post = fakePost({ imageUrl: `http://localhost:8080/media/${postId}.jpg` });
        const payload = buildPublishedPayload(post, publishPost(post));

        assert.equal(payload.files.length, 1, 'the image must survive approval');
        assert.equal(payload.files[0].name, `${postId}.jpg`);
      } finally {
        await rm(file, { force: true });
      }
    });

    test('a text-only post adds no files', async () => {
      const { buildPublishedPayload } = await import('../src/services/discord/interactions.js');
      const { publishPost } = await import('../src/services/publishing/index.js');

      const post = { ...fakePost({ imageUrl: null }), needsImage: false };
      const payload = buildPublishedPayload(post, publishPost(post));

      assert.equal(payload.files.length, 0);
    });
  });
});
