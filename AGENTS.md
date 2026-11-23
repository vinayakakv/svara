# Project workflow

- This is a local Bun + Vite app. Keep it local; do not publish it unless the user asks.
- For browser QA, use the Chrome DevTools MCP tools to open the running localhost app, inspect console errors, exercise controls, and check desktop and mobile layouts. Use them again after UI or audio-flow changes.
- Run `bun test` and `bun run build` for pitch-detection changes. Report any browser or microphone testing limits accurately.
