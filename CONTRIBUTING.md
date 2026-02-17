# Contributing to OpenWriter

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/travsteward/openwriter.git
cd openwriter
npm install
cd packages/openwriter
npm run dev
```

This starts the Vite dev server with hot reload on `localhost:5050`.

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run the build and type checks:
   ```bash
   npx turbo run build --force
   npx tsc --noEmit -p packages/openwriter/tsconfig.json
   npx tsc --noEmit -p packages/openwriter/tsconfig.server.json
   ```
4. Open a pull request against `main`

## Pull Requests

- Open an issue first to discuss significant changes
- Keep PRs focused — one feature or fix per PR
- Write a clear description of what changed and why

## Project Structure

- `packages/openwriter/src/` — React frontend (TipTap editor, sidebar, review panel, themes)
- `packages/openwriter/server/` — Express server (MCP tools, WebSocket, document state)
- `packages/openwriter/bin/` — CLI entry point
- `plugins/` — Optional plugins (extend MCP tools, routes, context menu)

## Code Style

- TypeScript throughout
- Imperative commit messages ("Add feature" not "Added feature")
- No unnecessary abstractions — keep it simple

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
