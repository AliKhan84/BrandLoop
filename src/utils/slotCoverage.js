/**
 * Platform coverage for a plan slot.
 *
 * RESPONSIBILITY
 *   Decide which platforms a slot still needs, and whether it is finished.
 *
 * WHY THIS IS ITS OWN MODULE
 *   These two questions used to be answered inline in `generateSlot` by
 *   `generated.length > 0`, which was wrong: one platform succeeding marked the
 *   slot complete and the other was never retried. The rule is small but it is
 *   the difference between a half-delivered slot being recoverable and being
 *   permanently stuck, so it is isolated here where it can be tested directly
 *   without standing up the model, the database and Discord.
 *
 * DOES NOT OWN: generating anything (`planService`) or what a post contains.
 */

/**
 * Which configured platforms have no post yet.
 *
 * @param {string[]} configured - Platforms the user generates for.
 * @param {Iterable<string>} existing - Platforms that already have a post.
 * @returns {string[]} The platforms still to generate, in configured order.
 * @sideeffect none (pure)
 */
export function missingPlatforms(configured, existing) {
  const have = new Set(existing);
  return configured.filter((platform) => !have.has(platform));
}

/**
 * Whether every configured platform has produced a post.
 *
 * An empty `configured` list reports false rather than true: a user with no
 * platforms configured has not finished anything, and treating "nothing
 * expected" as "all done" would mark slots complete that will never be filled.
 *
 * @param {string[]} configured - Platforms the user generates for.
 * @param {Iterable<string>} produced - Platforms that have a post.
 * @returns {boolean} True when nothing is outstanding.
 * @sideeffect none (pure)
 */
export function isSlotComplete(configured, produced) {
  if (configured.length === 0) return false;
  const have = new Set(produced);
  return configured.every((platform) => have.has(platform));
}

export default { missingPlatforms, isSlotComplete };
