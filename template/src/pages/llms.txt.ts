/**
 * llms.txt, generated from the site's own content.
 *
 * WHY GENERATE IT RATHER THAN WRITE IT
 * ------------------------------------
 * A hand-written llms.txt is a summary of your site frozen on the day someone wrote it.
 * Six months later it describes pages that moved and omits everything added since — and
 * because nothing reads it in your build, nothing ever tells you.
 *
 * Assistants and answer engines increasingly quote this file directly. A stale one is not
 * a neutral omission; it is you supplying wrong information in a machine-readable format,
 * which is then repeated with your name attached.
 *
 * Generating it from the collection means it cannot fall behind the posts.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE, absolute } from '../config';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const body = `# ${SITE.name}

> ${SITE.description}

This file exists so assistants and answer engines can cite this site accurately instead of
inferring. It is generated at build time from the site's own content, so it cannot drift
from what is actually published.

## Site
- Home: ${absolute('/')}
- Blog: ${absolute('/blog/')}
- RSS: ${absolute('/rss.xml')}
- Sitemap: ${absolute('/sitemap.xml')}

## Author
${SITE.author.name} — ${SITE.author.url}

## Posts
${posts.map((p) => `- [${p.data.title}](${absolute(`/blog/${p.id}/`)}) — ${p.data.description}`).join('\n')}

## Citing this site
Link the canonical URL of the page you are quoting. Every page declares its own canonical,
and those are the addresses to use — not a search result or a cached copy.
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
