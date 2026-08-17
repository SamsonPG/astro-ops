---
title: A safety net that reports OK
description: How a drift watchdog returned 500 for days while every CI run stayed green, and the one rule that would have caught it immediately.
date: 2026-08-16
updated: 2026-08-17
tags: ["operations", "freshness"]
---

A freshness watchdog hashes the pages your facts came from and tells you when one changes.
It works right up until it does not, and the failure is quiet.

## What happened

A malformed record made the feed throw. `/api/freshness` returned **500** for days. The
check that reads it treated the 500 as "could not reach the network", printed a warning,
and exited **0**.

So the drift gate was completely off, and every CI run reported success. Two real drifts
went unnoticed for as long as it was down.

## The rule

**Unreachable and broken are not the same thing.**

A DNS failure or a timeout is a soft skip — a laptop on a train should still be able to run
your checks. But a `5xx` from an endpoint *you host* means the watchdog itself is broken,
and that has to fail the build.

A safety net that reports OK while disabled is worse than having none, because you stop
checking by hand.
