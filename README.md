# Astro Production Starter

Astro themes sell **design**. This sells the part that comes after: the operational work
that keeps a site *correct* six months later, when nobody is looking at it.

It is extracted from four sites that have been running these gates in production — not
written as a demo. Every check here exists because something went wrong once, and the
comment above it says what.

> **Status: in development.** No price, no release date. The `ops/` toolkit is being
> extracted module by module; `build-id` is done and tested.

---

## Why this exists

The four sites it came from had accumulated the same ~20 build scripts, copy-pasted into
each repo. Measured before extraction:

| | |
|---|---|
| Core scripts still **byte-identical** across 3 repos | **7 of 12** |
| The other 5 | differed by 1–4 lines — a site name, a path, a threshold |

The logic never diverged. Only the config did. But the copies were drifting anyway,
because a fix landed in whichever repo hit the bug first and the other two kept the
defect. One of them had been carrying a known-broken build id for months after another
repo had already fixed it.

That is the whole thesis: **one maintained implementation, one config file per site.**

## What is in the box

Each gate answers a failure that a normal test suite cannot see, because in every case
the origin is fine and only the edge, the crawler, or the calendar is wrong.

- **Content-hashed build id** — a deploy can never silently serve last week's HTML. ✅ built
- **Freshness watchdogs** — pages that state a fact carry an expiry; CI fails when one goes
  stale instead of leaving a wrong number published. ⏳
- **Performance budgets in CI** — Lighthouse thresholds that block a merge, not a score
  somebody checks by hand after launch. ⏳
- **Discovery wiring** — sitemap, `llms.txt`, `ai.txt`, structured data and IndexNow
  generated from the content, so they cannot drift from it. ⏳
- **Privacy-first defaults** — self-hosted fonts, no third-party CDN in the critical path,
  and a tripwire that fails the build when an external host sneaks in. ⏳

## Install

```bash
npm i -D @acsaven/astro-ops
```

Zero runtime dependencies. It installs into your build pipeline, so every dependency it
carried would become one you inherit — it carries none.

## Quick start

Add the gate to your build and your CI:

```jsonc
// package.json
{
  "scripts": {
    "postbuild": "astro-ops build-id",
    "check": "astro-ops check"
  }
}
```

```yaml
# .github/workflows/ci.yml
- run: npm run build
- run: npm run check          # fails if the committed build id is stale
```

Then use the id in whatever keys your edge cache:

```js
import { BUILD_ID } from './build-id.js';

const key = new URL(request.url);
key.searchParams.set('__build', BUILD_ID);
```

Commit `build-id.js`. That is the point — see below.

## Configuration

Optional. A project with no config file gets the defaults, which are the values that were
actually running in production rather than a neutral guess.

```js
// astro-ops.config.mjs
export default {
  buildId: {
    include: ['dist'],        // hashed — what you DEPLOY, not what you wrote
    out: 'build-id.js',
    constName: 'BUILD_ID',
    length: 16,
  },
};
```

Array options **replace** the defaults rather than merging with them, so you can drop a
default you disagree with and your config file always shows the effective value.

If you have to edit a script inside this package to make it fit your project, that is a
missing config option — please report it. Patching locally puts you straight back in the
copy-drift trap.

---

## The build id, and why it is not a timestamp

This is the module people are most likely to think they can write in five minutes, so it
is worth the detail.

A build id keys your edge cache. Change the id, and every cached page becomes unreachable
at once — that is how you invalidate a CDN that has no purge API worth trusting.

**The trap:** most projects grow a second way to deploy — CI *plus* a manual command, or a
host's git integration *plus* a CLI. That is good; either can ship when the other is down.
But it means the same commit can be deployed by two pipelines, and a random or timestamped
id cannot survive that:

- A git-integration build usually has **no build step**. It uploads the repo as-is, so it
  ships whatever is **committed** in your build-id file.
- A local deploy command rotates that file **on disk**. Unless you commit the result, the
  repo still holds the old value.

Push a content change while the rotated id sits uncommitted, and you ship new HTML under
the **previous** id. The cache key never changed, so every colo keeps serving the old page.
The origin is correct. The deploy "succeeded". Nothing in CI can see it.

That is not hypothetical — it took down a status page for hours on 2026-08-07 in the
project this came from. The origin had the new content; the public URL returned the
pre-change copy.

Hashing the deployed content fixes it at the root:

- Both pipelines compute the **same id for the same commit**, so the committed value is
  always correct.
- Any real change produces a new id, so the cache still busts exactly when it should.
- It is **idempotent** — running it twice is a no-op, so your working tree stops drifting
  and the file stops appearing in unrelated diffs.

A random id also throws away your entire edge cache on every deploy, which is why a long
TTL never seems to pay off. Content hashing keeps the warm cache across deploys that did
not change anything.

**`astro-ops check:build-id` is the half that matters.** Emitting the id is easy to
remember on the day you set it up. The check is what turns "someone forgot to regenerate"
from a silent stale-cache bug into a failed build, a year later, when you have forgotten
this file exists.

### Exit codes

Because these run unattended and the output is all a human sees when one fails at 2am:

| Code | Meaning |
|---|---|
| `0` | Pass |
| `1` | A gate failed — the site has a problem |
| `2` | The tool is misconfigured — a config error must not look like a content failure |

## Development

```bash
cd ops
npm test        # node:test, no test-framework dependency
```

The tests are not incidental. Each one pins a property that the guarantee "both pipelines
compute the same id for the same commit" depends on — stable sort order across platforms,
path-sensitivity so a rename busts the cache, `\0` delimiters so swapping two files'
contents cannot collide, and a `fileCount` of zero surfacing as an error instead of a
constant id forever.
