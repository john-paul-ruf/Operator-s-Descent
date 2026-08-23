# Operator's Descent

> **I did not write a single line of code.**
 
This entire repo was a stress test for three AI agents that were used to translate all feature requests, bug reports, and other inputs into actual code.

---

## About the Game

An infinite-depth cyberpunk-themed rogue-like with glitchy retro visuals, hosted on a GitHub Pages page, with saves that can be exported via URL to other devices.

---

## Feedback Requested

- Is it fun?
- Is it broken?
- Are the glitchy retro visuals too much?
  - Did you adjust them in settings?
- Are there any enhancements you would like to request?
- How do you like the infinite music generator?
  - Did you adjust the mix in settings?
- Is there too much loot or not enough?

---

## Why I Built It

- I have always loved rogue-likes.
- To test the limits of a GitHub-hosted page. Because it is hosted on GitHub Pages and has no backend, the cost is almost zero, which I find interesting.
- To stress test version two of my black box of agents that built the entire thing. This is the real driver. These three agents seem to be able to handle just about any request.
- To test some ideas I had.

---

## The ideas
**State compression** 

With a deterministic world seed, the save pipeline only has to preserve the mutable edge of the run. The encoder first normalizes that run state, writes it into a compact bit-level schema with symbol-table lookups for common IDs, then tries a small stack of reversible compression passes and keeps the shortest valid result. That compressed payload is encrypted, framed with version/table/seed/bit-length/layer metadata plus a CRC, and base64url-encoded into a portable URL fragment under the 1,500-character budget.

This means every run saved in local storage is 1,500 characters or less. 

**Dynamic music engine** 

The dynamic music engine is a deterministic, seed-driven score system built around a single lookahead conductor that schedules every layer on a 16th-note grid. Each floor generates its own scale, root, chord progression, bass line, drums, and AABA-style lead motif from worldSeed, depth, floorId, and audioMode, with short ledgers preventing obvious progression and motif repeats. Game state shapes the same material in real time: depth, hostile proximity, containers, and combat smoothly raise intensity, tempo, percussion tier, sparkle arpeggios, pulse width, echo, and register without hard-cutting to a separate combat track. The result is an infinite chiptune/ambient score that stays musically coherent, reproducible for saves/tests, and reactive to the run’s pressure.

Plus you can adjust how it mixes in settings.

---

## Construction Details

- The entire thing was built in WebStorm using the ZenCoder chat box, with two agents defined in ZenCoder, and one agent defined at root as a Markdown file.
- The initial specs and mocks were built in my app builder work-in-progress app *new-foundry*.

---

## GitHub Pages Deployment

`./.github/workflows/deploy-pages.yml` publishes the game only after a push to `main` or a manual dispatch — it never deploys from a pull request.

- **Local staging:** run `npm run build:pages` to copy the production asset manifest into the git-ignored `./dist/`, or pass `-- --output <dir>` to stage into a temporary or custom directory instead.
- **CI behavior:** the workflow regenerates the committed CSS/icon assets, fails if that regeneration leaves an uncommitted diff, verifies the production asset manifest, then uploads only that manifest-only staging output as the deployment artifact.
- **One-time setup:** a repository administrator must set **Settings → Pages → Build and deployment → Source → GitHub Actions** once. After that, the canonical deployment URL appears in the workflow's Actions deployment output.
- Project asset paths stay relative — there is no fixed site URL, CNAME file, `<base>` tag, or custom-domain procedure to configure here.

---

## The Agents

### Agent One — The Compiler

- The primary agent. It takes in feature requests in any form. Could be a blob of text, a picture and a sentence, or a random list of bugs or enhancements.
- For lack of a better word, it compiles these requests into a meta program. Again, lack of better words. The program isn't something you can compile or check syntax against. It is a set of instructions for the last agent in this list, the executor.

### Agent Two — The Orchestrator

- Looks at the output of the compiler and threads it, if possible, with up to three subagents.
- Keeps track of state and handles crash recovery.
- Keeps track of dependencies in the instruction sets.

### Agent Three — The Executor

- Takes a set of instructions from the orchestrator and works them to completion.
- Handles check-ins at different points to aid in crash recovery.
- Dumbest of the agents. By the time this agent is spawned, everything has been planned. It just needs to execute.
