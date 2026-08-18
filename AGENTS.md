# Agent Instructions

The authoritative project instructions for this repository are in
[`CLAUDE.md`](CLAUDE.md) at the repository root - decided architecture and
tech stack, directory-by-directory code map, infrastructure and deployment,
environment variables, local setup, known issues, and what's actually next.

**Read `CLAUDE.md` before making any change here.** This file exists only
because Codex looks for `AGENTS.md` specifically and won't find `CLAUDE.md`
on its own - it is a pointer, not a second copy. Keeping the real content in
one file, read by name from two different tools, is deliberate: a project
instructions file gets updated often enough that two independently-maintained
copies would drift apart within a few PRs, and the fastest way to end up
acting on stale instructions is to have a stale second copy nobody remembers
to update. If anything below ever contradicts `CLAUDE.md`, `CLAUDE.md` is
right.

For getting a local environment running and shipping a first change,
[`docs/handoff.md`](docs/handoff.md) is the practical, numbered-steps
companion to `CLAUDE.md` - start there for "what do I actually type," and
`CLAUDE.md` for everything else.
