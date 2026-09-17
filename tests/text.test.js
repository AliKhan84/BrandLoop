/**
 * Tests for `utils/text.js` and `utils/urlBuilder.js`.
 *
 * WHY THESE
 *   `enforcePlatformLimit` is the only thing standing between a long model
 *   response and a post the platform truncates mid-word with no ellipsis. It is
 *   pure, so every branch — sentence cut, word cut, hard cut, no cut — can be
 *   pinned down exactly.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWhitespace,
  countCharacters,
  truncateOnSentence,
  enforcePlatformLimit,
  splitHashtags,
  appendHashtags,
  excerpt,
} from '../src/utils/text.js';

import { buildXComposerUrl, buildCopyBlock, buildComposerLink, buildMediaUrl } from '../src/utils/urlBuilder.js';

import { PLATFORM, PLATFORM_LIMITS } from '../src/config/constants.js';

describe('normalizeWhitespace', () => {
  test('collapses repeated spaces and trims the ends', () => {
    assert.equal(normalizeWhitespace('  hello    world  '), 'hello world');
  });

  test('collapses three or more newlines to a single blank line', () => {
    assert.equal(normalizeWhitespace('a\n\n\n\n\nb'), 'a\n\nb');
  });

  test('preserves a deliberate paragraph break', () => {
    assert.equal(normalizeWhitespace('a\n\nb'), 'a\n\nb');
  });

  test('normalises CRLF to LF', () => {
    assert.equal(normalizeWhitespace('a\r\nb'), 'a\nb');
  });

  test('strips spaces hugging newlines', () => {
    assert.equal(normalizeWhitespace('a   \n   b'), 'a\nb');
  });

  test('returns an empty string for a non-string input', () => {
    assert.equal(normalizeWhitespace(null), '');
    assert.equal(normalizeWhitespace(undefined), '');
  });
});

describe('countCharacters', () => {
  test('counts plain ASCII by length', () => {
    assert.equal(countCharacters('hello'), 5);
  });

  test('counts an emoji as one character, not two', () => {
    // '🙂' is a single code point but two UTF-16 code units. Using .length here
    // would over-count and truncate posts that actually fit.
    assert.equal(countCharacters('🙂'), 1);
    assert.equal('🙂'.length, 2, 'the naive length really is 2 — this is the bug being avoided');
  });

  test('counts a ZWJ emoji sequence by code point, not by UTF-16 unit', () => {
    // 👨‍👩‍👧 is 3 emoji joined by 2 zero-width joiners = 5 code points, but 8
    // UTF-16 units. Counting code points is the documented trade-off: a true
    // grapheme count would report 1, and would need an ICU pass on every check.
    // See the note on countCharacters.
    assert.equal(countCharacters('👨‍👩‍👧'), 5);
    assert.equal('👨‍👩‍👧'.length, 8, 'the naive length really is 8 — this is what is being avoided');
  });

  test('returns 0 for a non-string', () => {
    assert.equal(countCharacters(null), 0);
  });
});

describe('truncateOnSentence', () => {
  test('leaves text at or under the limit untouched', () => {
    const result = truncateOnSentence('Short enough.', 50);
    assert.equal(result.text, 'Short enough.');
    assert.equal(result.truncated, false);
  });

  test('leaves text exactly at the limit untouched', () => {
    const exact = 'a'.repeat(50);
    const result = truncateOnSentence(exact, 50);
    assert.equal(result.truncated, false);
    assert.equal(result.text, exact);
  });

  test('cuts at a sentence boundary when one exists in the back half', () => {
    const text = 'First sentence here. Second sentence here. Third sentence runs on for a while after that.';
    const result = truncateOnSentence(text, 45);

    assert.equal(result.truncated, true);
    assert.ok(result.text.endsWith('.'), `expected a sentence ending, got "${result.text}"`);
    assert.ok(countCharacters(result.text) <= 45);
  });

  test('falls back to a word boundary when no late sentence ending exists', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const result = truncateOnSentence(text, 30);

    assert.equal(result.truncated, true);
    assert.ok(countCharacters(result.text) <= 30);
    // No split words: every token is whole.
    assert.ok(!/\b\w+$/.test(result.text) || result.text.endsWith('…'), 'must not leave a half word');
  });

  test('hard-cuts a single enormous token', () => {
    const text = 'x'.repeat(500);
    const result = truncateOnSentence(text, 20);

    assert.equal(result.truncated, true);
    assert.ok(countCharacters(result.text) <= 20);
  });

  test('ignores a sentence ending that falls too early to be useful', () => {
    // The full stop at character 6 is in the first half of a 100-char window,
    // so cutting there would throw away most of the post.
    const text = 'Short. Then a very long continuation that keeps going and going and going and going and going.';
    const result = truncateOnSentence(text, 100);

    assert.ok(countCharacters(result.text) > 10, 'must not cut at the early full stop');
  });

  test('the result never exceeds the limit', () => {
    const text = 'Sentence one is here. Sentence two is here. Sentence three is here. Sentence four is here.';
    for (let limit = 1; limit <= countCharacters(text); limit += 1) {
      const result = truncateOnSentence(text, limit);
      assert.ok(
        countCharacters(result.text) <= limit,
        `limit ${limit} produced ${countCharacters(result.text)} chars`,
      );
    }
  });

  test('handles a non-string and a zero limit without throwing', () => {
    assert.deepEqual(truncateOnSentence(null, 10), { text: '', truncated: false });
    assert.equal(truncateOnSentence('abc', 0).truncated, true);
  });
});

describe('enforcePlatformLimit', () => {
  test('fits an over-long X post to the 280-character limit', () => {
    const long = 'This sentence is repeated to overflow the limit. '.repeat(20);
    const result = enforcePlatformLimit(long, PLATFORM.X);

    assert.ok(countCharacters(result.text) <= PLATFORM_LIMITS[PLATFORM.X]);
    assert.equal(result.truncated, true);
    assert.equal(result.limit, PLATFORM_LIMITS[PLATFORM.X]);
  });

  test('leaves a short post unchanged', () => {
    const result = enforcePlatformLimit('A short post.', PLATFORM.X);
    assert.equal(result.text, 'A short post.');
    assert.equal(result.truncated, false);
  });

  test('applies the LinkedIn limit, not the X one', () => {
    const text = 'a'.repeat(500);
    const result = enforcePlatformLimit(text, PLATFORM.LINKEDIN);

    assert.equal(result.limit, PLATFORM_LIMITS[PLATFORM.LINKEDIN]);
    assert.equal(result.truncated, false, '500 chars fits inside LinkedIn\'s 3000');
  });

  test('falls back to the strictest limit for an unknown platform', () => {
    const text = 'a'.repeat(500);
    const result = enforcePlatformLimit(text, 'myspace');

    assert.equal(result.limit, Math.min(...Object.values(PLATFORM_LIMITS)));
    assert.ok(countCharacters(result.text) <= result.limit);
  });

  test('normalises whitespace before measuring', () => {
    const result = enforcePlatformLimit('  padded   text  ', PLATFORM.X);
    assert.equal(result.text, 'padded text');
  });

  test('reports the original length so a truncation can be logged', () => {
    const result = enforcePlatformLimit('x'.repeat(400), PLATFORM.X);
    assert.equal(result.originalLength, 400);
  });

  describe('reserve — accounting for a hashtag suffix', () => {
    test('leaves room so the assembled post still fits', () => {
      // The regression: a 280-char body passed the check, then hashtags were
      // appended and the real post came to 305 characters. X truncates that
      // silently, with no ellipsis, so it looked like a broken post.
      const body = 'x'.repeat(280);
      const tags = '#HealthcareAI #HealthTech';
      const suffix = `\n\n${tags}`;

      const fitted = enforcePlatformLimit(body, PLATFORM.X, { reserve: suffix.length });

      assert.ok(
        countCharacters(fitted.text) + suffix.length <= PLATFORM_LIMITS[PLATFORM.X],
        'body plus suffix must fit the platform limit',
      );
      assert.equal(fitted.truncated, true);
    });

    test('reports both the platform limit and the reduced body budget', () => {
      const fitted = enforcePlatformLimit('x'.repeat(500), PLATFORM.X, { reserve: 30 });

      assert.equal(fitted.limit, PLATFORM_LIMITS[PLATFORM.X], 'limit is the platform ceiling');
      assert.equal(fitted.bodyLimit, PLATFORM_LIMITS[PLATFORM.X] - 30, 'bodyLimit is what the body may use');
      assert.equal(fitted.reserved, 30);
    });

    test('a reserve larger than the limit still yields a usable body', () => {
      // Degenerate but reachable if a model returns very long tags. An empty
      // post would be worse than a one-character one.
      const fitted = enforcePlatformLimit('hello world', PLATFORM.X, { reserve: 10_000 });
      assert.ok(countCharacters(fitted.text) >= 1);
    });

    test('a zero reserve behaves exactly as before', () => {
      const plain = enforcePlatformLimit('hello world', PLATFORM.X);
      const zero = enforcePlatformLimit('hello world', PLATFORM.X, { reserve: 0 });
      assert.deepEqual(plain, zero);
    });
  });
});

describe('splitHashtags', () => {
  test('separates trailing hashtags from the body', () => {
    const { body, hashtags } = splitHashtags('Great post about AI.\n\n#AI #Healthcare');
    assert.equal(body, 'Great post about AI.');
    assert.deepEqual(hashtags, ['#AI', '#Healthcare']);
  });

  test('leaves a mid-sentence hashtag in place', () => {
    const { body } = splitHashtags('The #AI market is shifting.');
    assert.equal(body, 'The #AI market is shifting.');
  });

  test('handles text with no hashtags', () => {
    const { body, hashtags } = splitHashtags('No tags here.');
    assert.equal(body, 'No tags here.');
    assert.deepEqual(hashtags, []);
  });
});

describe('appendHashtags', () => {
  test('appends tags with a blank line separator', () => {
    assert.equal(appendHashtags('Body text.', ['#AI']), 'Body text.\n\n#AI');
  });

  test('adds a missing leading hash', () => {
    assert.equal(appendHashtags('Body.', ['AI']), 'Body.\n\n#AI');
  });

  test('does not duplicate a tag the body already carries', () => {
    const result = appendHashtags('Body.\n\n#AI', ['#AI']);
    assert.equal(result, 'Body.\n\n#AI');
  });

  test('de-duplicates case-insensitively', () => {
    assert.equal(appendHashtags('Body.', ['#AI', '#ai', '#Ai']), 'Body.\n\n#AI');
  });

  test('is idempotent', () => {
    const once = appendHashtags('Body.', ['#AI', '#ML']);
    assert.equal(appendHashtags(once, ['#AI', '#ML']), once);
  });

  test('returns just the body when there are no tags', () => {
    assert.equal(appendHashtags('Body.', []), 'Body.');
  });
});

describe('excerpt', () => {
  test('collapses newlines into a single line', () => {
    assert.equal(excerpt('line one\n\nline two'), 'line one line two');
  });

  test('truncates with an ellipsis past the limit', () => {
    const result = excerpt('x'.repeat(100), 20);
    assert.equal(countCharacters(result), 20);
    assert.ok(result.endsWith('…'));
  });
});

describe('urlBuilder', () => {
  test('percent-encodes a post into the X intent URL', () => {
    const url = buildXComposerUrl('Hello & goodbye #AI');
    assert.ok(url.startsWith('https://x.com/intent/post?text='));
    // The ampersand must be encoded, or it would terminate the text parameter
    // and inject a second, bogus query key.
    assert.ok(!url.includes('&goodbye'), 'ampersand must be encoded');
    assert.ok(url.includes('%23AI'), 'hash must be encoded');
  });

  test('encodes spaces as %20 rather than +', () => {
    const url = buildXComposerUrl('two words');
    assert.ok(url.includes('two%20words'));
    assert.ok(!url.includes('+'));
  });

  test('drops the X link when the text would make the URL unreliable', () => {
    assert.equal(buildXComposerUrl('x'.repeat(3000)), null);
  });

  test('returns null for empty text', () => {
    assert.equal(buildXComposerUrl(''), null);
  });

  test('LinkedIn reports that it cannot prefill', () => {
    const link = buildComposerLink(PLATFORM.LINKEDIN, 'text');
    assert.ok(link.composerUrl.includes('linkedin.com'));
    assert.equal(link.prefilled, false, 'LinkedIn cannot prefill without the API — must not claim it can');
  });

  test('X reports that it can prefill', () => {
    assert.equal(buildComposerLink(PLATFORM.X, 'text').prefilled, true);
  });

  test('an unknown platform yields no link rather than a wrong one', () => {
    assert.equal(buildComposerLink('myspace', 'text').composerUrl, null);
  });

  test('a code block wraps the body so Discord can copy it', () => {
    const block = buildCopyBlock('Hello');
    assert.ok(block.startsWith('```'));
    assert.ok(block.endsWith('```'));
  });

  test('a body containing a fence cannot break out of the code block', () => {
    const block = buildCopyBlock('before ``` after');
    // Only the opening and closing fences may remain, or Discord would treat the
    // rest of the message as prose and the Copy button would copy the wrong thing.
    assert.equal(block.split('```').length - 1, 2, 'exactly two fences expected');
  });

  test('a media URL is built from the public base URL', () => {
    assert.ok(buildMediaUrl('abc.jpg').endsWith('/media/abc.jpg'));
  });

  test('a media filename cannot escape the media directory', () => {
    assert.ok(!buildMediaUrl('../../etc/passwd').includes('../'));
  });
});
