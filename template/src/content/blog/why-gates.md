---
title: A passing build, a wrong site
description: The bugs that survive code review are the ones where the code is fine and only the edge, the crawler or the calendar is wrong.
date: 2026-08-17
tags: ["operations", "ci"]
---

A test suite proves your code does what you wrote. It cannot prove your site is *correct*,
because the most expensive failures happen where no code runs.

## The origin is fine and the page is still wrong

A deploy ships new HTML under a cache key that never changed. Every colo keeps serving the
previous build. The origin returns the new page, the deploy reports success, and every
check passes — because the only thing that is wrong is the cache.

Nothing in an ordinary pipeline can see that. You find it when a reader tells you.

## The fact changed and your page did not

Some pages state a number that belongs to somebody else: a fee, a size limit, a tax rate.
You verified it once. The authority changed it later and did not send you an email. Your
build still passes. Your page is now wrong, with your name on it.

## Each half looks correct on its own

A page is `noindex`. It is also in your sitemap. Both are defensible in isolation, which is
exactly why the contradiction survives review — and why it surfaces months later as a
coverage error rather than a build failure.

## What a gate is for

A gate is a check for the class of bug where nothing is broken, nothing throws, and the
page renders. It fails the build so that someone has to look, at the moment they can still
decide differently — instead of a year later, when nobody remembers the file exists.
