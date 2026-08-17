/**
 * robots.txt, generated from config.
 *
 * It was a static file in public/ with the domain typed into it. Change your domain and it
 * keeps advertising a sitemap on the old host — silently, because a stale Sitemap line is
 * not an error anywhere. Deriving it from SITE.url means that cannot happen.
 */
import type { APIRoute } from 'astro';
import { absolute } from '../config';

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *
Allow: /

Sitemap: ${absolute('/sitemap.xml')}
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
