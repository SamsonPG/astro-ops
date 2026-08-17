/**
 * One source of truth for everything about this site.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before it, the site URL was written in three places — `astro.config.mjs`, `robots.txt`
 * and `llms.txt` — and nothing connected them. Change your domain and two of the three
 * keep pointing at the old one, silently, because none of them is wrong on its own. That
 * is the same class of bug the gates exist to catch, sitting in the starter itself.
 *
 * Everything derived from here: canonicals, Open Graph, the sitemap, RSS, robots.txt,
 * llms.txt, ai.txt and the structured data. Change a value once and the whole site
 * follows, because none of those files is hand-maintained.
 *
 * Edit this file first when you clone the starter. It is the only place you have to.
 */

export const SITE = {
  /** No trailing slash. Everything appends its own path. */
  url: 'https://example.com',
  name: 'Astro Production Starter',
  /** Used as the default meta description and in RSS. Keep it under 160 characters. */
  description:
    'An Astro starter for what happens after the site looks right: build ids, freshness watchdogs, budgets, discovery checks and a third-party tripwire.',
  /** Appended to page titles as "Page — Site". Set to '' to disable. */
  titleSuffix: 'Astro Production Starter',
  lang: 'en',
  locale: 'en_US',
  author: {
    name: 'Your Name',
    email: 'you@example.com',
    url: 'https://example.com/about/',
  },
  /**
   * Social / canonical profiles. These populate `sameAs` in the Organization schema,
   * which is how a search engine connects this site to the accounts that represent it.
   * Delete the ones you do not have — an empty array is better than a dead link.
   */
  sameAs: [] as string[],
  /**
   * Default social preview image, relative to the site root.
   * A per-page `ogImage` overrides it.
   */
  ogImage: '/og-default.svg',
  nav: [
    { href: '/', label: 'Home' },
    { href: '/blog/', label: 'Blog' },
    { href: '/about/', label: 'About' },
  ],
} as const;

/** Absolute URL for a root-relative path. Used everywhere a full URL is required. */
export function absolute(path: string): string {
  return new URL(path, SITE.url).href;
}
