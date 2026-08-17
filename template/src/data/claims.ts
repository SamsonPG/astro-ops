/**
 * Facts on this site that belong to somebody else.
 *
 * Anything here is a number, a limit or a date that an outside authority controls and can
 * change without telling you. `astro-ops check:freshness` reads this file — by regex, not
 * by importing it, so it works on TypeScript without a build step.
 *
 * Two rules that decide whether the watchdog can actually protect you:
 *
 *   1. `lastVerified` means A HUMAN OPENED THE SOURCE AND LOOKED. It is not the date you
 *      edited the file. Bumping it without checking disarms the only gate that covers
 *      claims nothing else can verify.
 *
 *   2. `officialSourceUrl` is what makes drift detection possible at all. A claim without
 *      one is invisible to it and relies entirely on someone remembering. Set
 *      `freshness.requireSourceUrl: true` in astro-ops.config.mjs to make that a hard
 *      failure — recommended once you have more than a handful.
 */
export type Claim = {
  slug: string;
  name: string;
  /** The value being published. Keep it here so the page and the check cannot disagree. */
  amount: string;
  /** ISO date a human last confirmed this against the source. */
  lastVerified: string;
  /** Optional override for the default recheck window. */
  recheckBy?: string;
  /** The page the figure came from. */
  officialSourceUrl: string;
};

export const CLAIMS: Claim[] = [
  {
    slug: 'example-fee',
    name: 'Example application fee',
    amount: '£25.00',
    lastVerified: '2026-08-17',
    officialSourceUrl: 'https://www.gov.uk/',
  },
];
