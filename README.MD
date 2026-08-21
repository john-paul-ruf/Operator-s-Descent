# Operator's Descent

> I did not write a single line of code. This entire repo was a stress test for three AI agents that were used to translate all feature requests, bug reports, and other inputs into actual code.

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
- To test the limits of a GitHub-hosted page. Because it is hosted on GitHub Pages and has no backend, it costs me zero, which I find interesting.
- To test if I could share a game state in 1,500 characters or less across devices. Play on your phone, export the save as a URL plus at max a 1,500-character token. Then load on another device, continue from the point of export, without changing anything on your original device. It is like forking your save file. Share your fork with others, it won't affect your save. Everything relies on local storage only.
- To stress test version two of my black box of agents that built the entire thing. This is the real driver. These three agents seem to be able to handle just about any request.

---

## Construction Details

- The entire thing was built in WebStorm using the ZenCoder chat box, with two agents defined in ZenCoder, and one agent defined at root as a Markdown file.
- The initial specs and mocks were built in my app builder work-in-progress app *new-foundry*.

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
