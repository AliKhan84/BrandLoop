/**
 * Assisted publishing — LinkedIn.
 *
 * RESPONSIBILITY
 *   Produce everything the user needs to publish an approved post to LinkedIn:
 *   a composer link, and the copyable text block that carries the actual post.
 *
 * ## The honest limitation
 *
 * Unlike X, LinkedIn has **no** supported way to prefill post text without the
 * Community Management API (PRD §2). There is no query parameter that seeds the
 * composer. So this module deliberately does not pretend otherwise:
 *
 *   • `prefilled` is always `false`, so the Discord message words the
 *     instruction correctly instead of promising something that will not happen.
 *   • The copy block carries the text, and the link opens the composer.
 *   • **No browser automation.** Driving a real browser session to paste on the
 *     user's behalf would breach LinkedIn's terms and would put the *user's own
 *     account* at risk of a ban — not ours. That trade is not worth a saved
 *     paste, and PRD §2 rules it out explicitly.
 *
 * This is the module that changes when Phase 2 (Community Management API
 * access) lands: the branch target swaps, and nothing above it moves.
 *
 * DOES NOT OWN: the copy block (in `urlBuilder`), or the decision to publish.
 */

import { PLATFORM, PLATFORM_LIMITS } from '../../config/constants.js';
import { buildLinkedInComposerUrl, buildCopyBlock } from '../../utils/urlBuilder.js';
import { countCharacters } from '../../utils/text.js';

/**
 * Builds the assisted-publish payload for a LinkedIn post.
 *
 * ## Why the link goes to BrandLoop first
 *
 * LinkedIn cannot prefill post text, so the composer always opens empty and the
 * user has to paste. Sending them straight there means finding the text, copying
 * it, switching back, and pasting — and for a long post the text lives in the
 * embed description, where there is not even a Copy button.
 *
 * When a `composePageUrl` is available the link points at BrandLoop's own page
 * instead. That page shows the text and offers one button which puts it on the
 * clipboard *and* opens LinkedIn. So the sequence becomes: click, paste.
 *
 * The clipboard write has to happen in the page because a Discord bot cannot
 * reach the user's clipboard — the code-block Copy button is Discord's own
 * feature, and it does not exist for text longer than one message.
 *
 * @param {object} params
 * @param {string} params.text - The full post text, hashtags included.
 * @param {string|null} [params.composePageUrl] - BrandLoop's copy-and-open page
 *   for this post. Falls back to linking LinkedIn directly when absent, which is
 *   the pre-existing behaviour and still works, just with more steps.
 * @returns {{platform: string, instructions: string, composerUrl: string|null,
 *   prefilled: boolean, linkLabel: string, copyBlock: string, warning: string|null}}
 *   The same shape `xPublisher` returns.
 * @sideeffect none (pure)
 */
export function buildLinkedInAssist({ text, composePageUrl = null }) {
  const length = countCharacters(text);
  const limit = PLATFORM_LIMITS[PLATFORM.LINKEDIN];

  const warning = length > limit
    // Unreachable in practice — `enforcePlatformLimit` runs first — but a
    // silent overflow would be a worse failure than a visible warning.
    ? `${length}/${limit} characters — over the LinkedIn limit, please trim.`
    : null;

  return {
    platform: PLATFORM.LINKEDIN,
    // States the reality plainly. The alternative — implying the link will carry
    // the text — produces a user who opens the composer, finds it empty, and
    // assumes the tool is broken.
    instructions: composePageUrl
      ? 'LinkedIn cannot prefill post text, so this is two steps: the button below copies the text and opens the composer. Paste, then post.'
      : 'LinkedIn cannot prefill post text without the API, so this is two steps: ' +
        'copy the text below, then open the composer and paste it.',
    composerUrl: composePageUrl ?? buildLinkedInComposerUrl(),
    prefilled: false,
    linkLabel: composePageUrl ? 'Copy text & open LinkedIn' : 'Open LinkedIn composer',
    copyBlock: buildCopyBlock(text),
    warning,
  };
}

export default { buildLinkedInAssist };
