/**
 * Sitemap, generated FROM the pages and posts rather than maintained beside them.
 *
 * This is the whole reason check:discovery can be strict about sitemap/page agreement: a
 * hand-kept list drifts the first time someone renames a route, and the drift is invisible
 * because each half still looks correct on its own.
 *
 * Two exclusions, both load-bearing:
 *   - 404 is served at arbitrary URLs with a non-200 and must never be listed.
 *   - Drafts carry noindex, and a noindex page in a sitemap is a direct contradiction —
 *     asking to be crawled while refusing to be indexed. The gate fails the build on it,
 *     which is how you find out you got this wrong.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { absolute } from '../config';

/** Static pages, discovered rather than listed by hand. */
const staticPages = import.meta.glob('./**/*.astro', { eager: true }) as Record<string, unknown>;

/** `./about.astro` -> `/about/`, `./index.astro` -> `/`, `./blog/index.astro` -> `/blog/`. */
function routeOf(file: string): string {
  const rel = file.replace(/^\.\//, '').replace(/\.astro$/, '');
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) return `/${rel.slice(0, -'/index'.length)}/`;
  return `/${rel}/`;
}

export const GET: APIRoute = async () => {
  const routes = Object.keys(staticPages)
    .filter((f) => !/\/?404\.astro$/.test(f))
    // Dynamic routes ([...slug]) are expanded from the collection below, not the glob.
    .filter((f) => !f.includes('['))
    .map(routeOf);

  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const postEntries = posts
    .map((p) => ({
      loc: `/blog/${p.id}/`,
      lastmod: (p.data.updated ?? p.data.date).toISOString().slice(0, 10),
    }))
    .sort((a, b) => (a.loc < b.loc ? -1 : 1));

  const all = [
    ...routes.sort().map((loc) => ({ loc, lastmod: null as string | null })),
    ...postEntries,
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (u) =>
      `  <url><loc>${absolute(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
