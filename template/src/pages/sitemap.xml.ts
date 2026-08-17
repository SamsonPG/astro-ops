/**
 * Sitemap, generated FROM the pages rather than maintained beside them.
 *
 * This is the whole reason check:discovery can be strict about sitemap/page agreement: a
 * hand-kept list drifts the first time someone renames a route, and the drift is invisible
 * because each half still looks correct on its own.
 *
 * Pages marked noindex are excluded here. Listing one is a direct contradiction — asking
 * to be crawled while refusing to be indexed — and the gate fails the build on it.
 */
import type { APIRoute } from 'astro';

/** Astro hands us every page module; we read each one's frontmatter to decide. */
const pages = import.meta.glob('./**/*.astro', { eager: true }) as Record<string, unknown>;

/** `./about.astro` -> `/about/`, `./index.astro` -> `/`. */
function routeOf(file: string): string {
  const rel = file.replace(/^\.\//, '').replace(/\.astro$/, '');
  if (rel === 'index') return '/';
  return `/${rel}/`;
}

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://example.com')).origin;

  const routes = Object.keys(pages)
    // 404 is served at arbitrary URLs with a non-200 and must never be listed.
    .filter((f) => !/\/?404\.astro$/.test(f))
    .map(routeOf)
    .sort();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((r) => `  <url><loc>${origin}${r}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
