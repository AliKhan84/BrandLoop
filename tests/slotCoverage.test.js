/**
 * Tests for `utils/slotCoverage.js`.
 *
 * WHY THESE
 *   These two functions decide whether a slot is finished. That decision used to
 *   be `generated.length > 0`, which marked a slot complete as soon as *one*
 *   platform succeeded — so a failed LinkedIn post was never retried and the
 *   slot read as done forever. The rule is small, which is exactly why it needs
 *   pinning down: the failure it prevents is invisible from the outside.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { missingPlatforms, isSlotComplete } from '../src/utils/slotCoverage.js';

const BOTH = ['x', 'linkedin'];

describe('missingPlatforms', () => {
  test('reports every platform when nothing exists yet', () => {
    assert.deepEqual(missingPlatforms(BOTH, []), ['x', 'linkedin']);
  });

  test('reports only the gap after a partial failure', () => {
    // The LinkedIn-missing case this whole change exists for.
    assert.deepEqual(missingPlatforms(BOTH, ['x']), ['linkedin']);
  });

  test('reports nothing when the slot is complete', () => {
    assert.deepEqual(missingPlatforms(BOTH, ['x', 'linkedin']), []);
  });

  test('preserves configured order, so generation order is stable', () => {
    assert.deepEqual(missingPlatforms(['linkedin', 'x'], []), ['linkedin', 'x']);
  });

  test('ignores an existing post for a platform the user no longer generates for', () => {
    // Switching a platform off must not make a slot look unfinished forever.
    assert.deepEqual(missingPlatforms(['x'], ['x', 'linkedin']), []);
  });

  test('accepts a Set as well as an array', () => {
    assert.deepEqual(missingPlatforms(BOTH, new Set(['x'])), ['linkedin']);
  });

  test('a user with no platforms configured has nothing to generate', () => {
    assert.deepEqual(missingPlatforms([], ['x']), []);
  });
});

describe('isSlotComplete', () => {
  test('is true only when every configured platform produced a post', () => {
    assert.equal(isSlotComplete(BOTH, ['x', 'linkedin']), true);
  });

  test('is false when one platform is missing', () => {
    // The regression: this was previously treated as complete.
    assert.equal(isSlotComplete(BOTH, ['x']), false);
  });

  test('is false when nothing exists', () => {
    assert.equal(isSlotComplete(BOTH, []), false);
  });

  test('is false for a user with no platforms configured', () => {
    // Deliberately not vacuously true: "nothing expected" is not "all done",
    // or every slot would be marked complete the moment it was created.
    assert.equal(isSlotComplete([], []), false);
  });

  test('is true when the user generates for a single platform and it succeeded', () => {
    assert.equal(isSlotComplete(['x'], ['x']), true);
  });

  test('ignores extra produced platforms', () => {
    assert.equal(isSlotComplete(['x'], ['x', 'linkedin']), true);
  });

  test('accepts a Set as well as an array', () => {
    assert.equal(isSlotComplete(BOTH, new Set(['x', 'linkedin'])), true);
  });
});

describe('the two together describe a slot consistently', () => {
  test('a slot is complete exactly when nothing is missing', () => {
    const cases = [
      { configured: BOTH, produced: [] },
      { configured: BOTH, produced: ['x'] },
      { configured: BOTH, produced: ['x', 'linkedin'] },
      { configured: ['x'], produced: ['x'] },
      { configured: ['x'], produced: [] },
    ];

    for (const { configured, produced } of cases) {
      assert.equal(
        isSlotComplete(configured, produced),
        missingPlatforms(configured, produced).length === 0 &&
          configured.length > 0,
        `configured=${configured} produced=${produced}`,
      );
    }
  });
});
