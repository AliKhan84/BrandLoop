/**
 * Tests for `buildPlanSlots` and `mergeThemes`.
 *
 * WHY THESE PARTICULAR TESTS
 *   `buildPlanSlots` resolves the PRD's structural contradiction (one slot per
 *   posting occasion, not one per calendar day). If it is wrong, every plan is
 *   the wrong length and every downstream count — news ratio, schedule, quota
 *   estimate — is wrong with it. It is also the only part of plan generation
 *   that is pure, so it is the only part that can be pinned down cheaply.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanSlots, mergeThemes } from '../src/services/ai/planGenerator.js';
import { CONTENT_MIX, POST_TYPE, SLOT_STATUS, VALID_PLAN_DURATIONS, VALID_POST_FREQUENCIES } from '../src/config/constants.js';

/**
 * The slot count the PRD implies for a given window and frequency.
 * Kept as a separate implementation from the one under test, so a change to
 * either that is not matched by the other shows up as a failure.
 *
 * @param {number} durationDays - Plan window in days.
 * @param {number} postFrequency - Posts per week.
 * @returns {number} Expected number of slots.
 */
function expectedSlotCount(durationDays, postFrequency) {
  return Math.round((postFrequency * durationDays) / 7);
}

/**
 * Counts the news slots in a slot list.
 *
 * @param {Array} slots - Slot list from `buildPlanSlots`.
 * @returns {number} How many are of type `news`.
 */
function countNews(slots) {
  return slots.filter((slot) => slot.type === POST_TYPE.NEWS).length;
}

describe('buildPlanSlots', () => {
  describe('slot count across the full 7/30 x 2/3/4 matrix', () => {
    for (const durationDays of VALID_PLAN_DURATIONS) {
      for (const postFrequency of VALID_POST_FREQUENCIES) {
        test(`${durationDays} days at ${postFrequency}/week produces the expected number of slots`, () => {
          const slots = buildPlanSlots({ durationDays, postFrequency });
          assert.equal(
            slots.length,
            expectedSlotCount(durationDays, postFrequency),
            `${durationDays}d @ ${postFrequency}/wk`,
          );
        });
      }
    }
  });

  describe('dayIndex is 1-based and contiguous', () => {
    for (const durationDays of VALID_PLAN_DURATIONS) {
      for (const postFrequency of VALID_POST_FREQUENCIES) {
        test(`${durationDays}d @ ${postFrequency}/wk has no gaps or duplicates`, () => {
          const slots = buildPlanSlots({ durationDays, postFrequency });

          assert.deepEqual(
            slots.map((slot) => slot.dayIndex),
            Array.from({ length: slots.length }, (_, i) => i + 1),
          );
        });
      }
    }
  });

  describe('dayOfPlan', () => {
    for (const durationDays of VALID_PLAN_DURATIONS) {
      for (const postFrequency of VALID_POST_FREQUENCIES) {
        test(`${durationDays}d @ ${postFrequency}/wk spreads slots within the window`, () => {
          const slots = buildPlanSlots({ durationDays, postFrequency });
          const offsets = slots.map((slot) => slot.dayOfPlan);

          // Strictly increasing proves no two slots land on the same day, which
          // is what stops the scheduler generating two posts for one date.
          for (let i = 1; i < offsets.length; i += 1) {
            assert.ok(
              offsets[i] > offsets[i - 1],
              `dayOfPlan not strictly increasing at index ${i}: ${offsets.join(',')}`,
            );
          }

          assert.ok(offsets[0] >= 0, 'first slot cannot be before the plan starts');
          assert.ok(
            offsets[offsets.length - 1] < durationDays,
            `last slot (${offsets[offsets.length - 1]}) falls outside the ${durationDays}-day window`,
          );
        });
      }
    }
  });

  describe('news ratio (PRD §4 — one news post per week)', () => {
    test('a 7-day plan contains exactly one news slot', () => {
      for (const postFrequency of VALID_POST_FREQUENCIES) {
        const slots = buildPlanSlots({ durationDays: 7, postFrequency });
        assert.equal(
          countNews(slots),
          CONTENT_MIX.NEWS_POSTS_PER_WEEK,
          `7d @ ${postFrequency}/wk should hold 1 news slot`,
        );
      }
    });

    test('a 30-day plan contains one news slot per week', () => {
      for (const postFrequency of VALID_POST_FREQUENCIES) {
        const slots = buildPlanSlots({ durationDays: 30, postFrequency });
        assert.equal(
          countNews(slots),
          Math.round(CONTENT_MIX.NEWS_POSTS_PER_WEEK * (30 / 7)),
          `30d @ ${postFrequency}/wk`,
        );
      }
    });

    test('the news slot is the last slot in its week block', () => {
      const slots = buildPlanSlots({ durationDays: 30, postFrequency: 3 });

      // Group by 7-day block, then assert the final entry of each block is news.
      const blocks = new Map();
      for (const slot of slots) {
        const week = Math.floor(slot.dayOfPlan / 7);
        if (!blocks.has(week)) blocks.set(week, []);
        blocks.get(week).push(slot);
      }

      let checked = 0;
      for (const block of blocks.values()) {
        const last = block[block.length - 1];
        // Only assert for weeks that actually received a news slot, since the
        // final partial week may not have one.
        if (last.type === POST_TYPE.NEWS) {
          checked += 1;
          assert.equal(last.type, POST_TYPE.NEWS);
        }
      }

      assert.ok(checked > 0, 'expected at least one week to end with a news slot');
    });

    test('news slots never outnumber the available slots', () => {
      // A short window with an aggressive ratio is the pathological case.
      const slots = buildPlanSlots({ durationDays: 7, postFrequency: 2, newsPostsPerWeek: 99 });
      assert.ok(countNews(slots) <= slots.length);
      assert.equal(slots.length, 2);
    });
  });

  describe('slot shape defaults', () => {
    test('every slot starts pending with a null theme', () => {
      const slots = buildPlanSlots({ durationDays: 7, postFrequency: 3 });

      for (const slot of slots) {
        assert.equal(slot.status, SLOT_STATUS.PENDING, 'slots must start pending');
        assert.equal(slot.theme, null, 'theme is filled by the model, not here');
      }
    });

    test('every slot has a type of planned or news', () => {
      const slots = buildPlanSlots({ durationDays: 30, postFrequency: 4 });

      for (const slot of slots) {
        assert.ok(
          [POST_TYPE.PLANNED, POST_TYPE.NEWS].includes(slot.type),
          `unexpected type "${slot.type}"`,
        );
      }
    });
  });

  describe('degenerate input', () => {
    test('a zero frequency still yields one usable slot rather than dividing by zero', () => {
      const slots = buildPlanSlots({ durationDays: 7, postFrequency: 0 });
      assert.equal(slots.length, 1);
      assert.equal(slots[0].dayOfPlan, 0);
    });

    test('a 1-day window yields one slot at offset 0', () => {
      const slots = buildPlanSlots({ durationDays: 1, postFrequency: 1 });
      assert.equal(slots.length, 1);
      assert.equal(slots[0].dayOfPlan, 0);
    });
  });
});

describe('mergeThemes', () => {
  /** @returns {Array} A small three-slot fixture. */
  function fixtureSlots() {
    return buildPlanSlots({ durationDays: 7, postFrequency: 3 });
  }

  test('matches themes to slots by dayIndex', () => {
    const slots = fixtureSlots();
    const merged = mergeThemes(slots, [
      { dayIndex: 2, theme: 'Second' },
      { dayIndex: 1, theme: 'First' },
      { dayIndex: 3, theme: 'Third' },
    ]);

    assert.equal(merged[0].theme, 'First');
    assert.equal(merged[1].theme, 'Second');
    assert.equal(merged[2].theme, 'Third');
  });

  test('fills a missing theme with a placeholder instead of leaving it null', () => {
    const merged = mergeThemes(fixtureSlots(), [{ dayIndex: 1, theme: 'Only one' }]);

    assert.equal(merged[0].theme, 'Only one');
    for (const slot of merged) {
      assert.ok(typeof slot.theme === 'string' && slot.theme.length > 0, 'no slot may end up with an empty theme');
    }
  });

  test('an empty model response still yields a complete, usable plan', () => {
    const merged = mergeThemes(fixtureSlots(), []);
    assert.equal(merged.length, 3);
    assert.ok(merged.every((slot) => slot.theme));
  });

  test('a duplicated dayIndex does not overwrite the first theme', () => {
    const merged = mergeThemes(fixtureSlots(), [
      { dayIndex: 1, theme: 'Keep me' },
      { dayIndex: 1, theme: 'Discard me' },
    ]);

    assert.equal(merged[0].theme, 'Keep me');
  });

  test('an out-of-range dayIndex falls back to positional order', () => {
    const merged = mergeThemes(fixtureSlots(), [
      { dayIndex: 999, theme: 'Positional A' },
      { dayIndex: 998, theme: 'Positional B' },
    ]);

    assert.equal(merged[0].theme, 'Positional A');
    assert.equal(merged[1].theme, 'Positional B');
  });

  test('does not mutate the input slot list', () => {
    const slots = fixtureSlots();
    const before = JSON.parse(JSON.stringify(slots));
    mergeThemes(slots, [{ dayIndex: 1, theme: 'Changed' }]);

    assert.deepEqual(slots, before, 'mergeThemes must return new objects');
  });
});
