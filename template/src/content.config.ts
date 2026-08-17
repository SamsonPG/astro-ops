/**
 * Blog content collection.
 *
 * The schema is strict on purpose. A missing description or a malformed date fails the
 * BUILD, with the file and field named — rather than rendering an empty `<meta
 * description>` that `astro-ops check:discovery` then has to catch after the fact.
 *
 * Two gates that overlap here, deliberately: this schema stops a bad post being written,
 * and check:discovery stops a bad page being shipped. The first gives a better error; the
 * second still catches anything that reaches the output another way.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { SITE } from './config';

/**
 * How many characters a post title actually gets.
 *
 * The rendered <title> is "Post — Site", so the suffix spends part of a fixed budget. This
 * schema used to allow 70 while check:discovery enforced 60 on the FINAL string, so a post
 * could pass authoring and fail the build — two limits disagreeing about the same thing.
 *
 * Deriving it from the suffix means the error arrives when you write the post, naming the
 * file and the field, instead of as a gate failure minutes later.
 *
 * If this feels tight, the other real option is to stop appending the suffix on articles —
 * set `titleSuffix: ''` in config.ts. Plenty of sites do; search engines often rewrite the
 * suffix away regardless. What you must not do is raise `maxTitle` past what results
 * actually display, which only moves the truncation somewhere you cannot see it.
 */
const TITLE_BUDGET = 60 - (SITE.titleSuffix ? SITE.titleSuffix.length + 3 : 0);

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z
      .string()
      .max(
        TITLE_BUDGET,
        `Max ${TITLE_BUDGET} chars — "${SITE.titleSuffix}" is appended, and the full title has to fit in 60`,
      ),
    description: z
      .string()
      .min(50, 'Too short to be useful as a search snippet')
      .max(160, 'Descriptions over 160 chars get truncated in search results'),
    date: z.coerce.date(),
    /** Set when a post is materially revised. Shown to readers and emitted in schema. */
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    /** Keeps a post out of the sitemap and adds noindex. Drafts are excluded from lists. */
    draft: z.boolean().default(false),
    /** Per-post social image; falls back to the site default. */
    ogImage: z.string().optional(),
  }),
});

export const collections = { blog };
