# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time cricket commentary streaming app. The backend connects to the Roanuz Cricket API via WebSocket, feeds ball-by-ball events to Claude (claude-sonnet-4-6), and streams AI-generated commentary tokens to a React frontend over SSE. Nine commentator personas run simultaneously, including Hindi, Tamil, Telugu, and other regional language styles.

## Commands

### Backend (root)
```bash
npm install          # install backend deps
npm run server       # start Fastify SSE server on :3001 (main dev command)
npm run mock         # run mock event simulator (no Roanuz API needed)
npm run socket-dev   # run standalone socket runner (src/index.ts)
npm run build        # compile TypeScript → dist/
npm start            # run compiled output (node dist/server.js)
```

### Frontend (separate process)
```bash
npm run ui           # from root — cds into frontend/, starts Vite on :5173
# or directly:
cd frontend && npm install && npm run dev
```

### Full-stack dev
Run `npm run server` and `npm run ui` in two separate terminals.

## Environment Variables

Copy `.env.example` (if present) or create `.env` in the project root:

| Variable | Purpose |
|----------|---------|
| `ROANUZ_PROJECT_KEY` | Roanuz console project key |
| `ROANUZ_API_KEY` | Roanuz API key (`RS5:...`) |
| `ROANUZ_MATCH_KEY` | Match identifier to stream |
| `ANTHROPIC_API_KEY` | Claude API key |
| `FRONTEND_URL` | CORS origin for SSE (e.g. `http://localhost:5173`) |
| `MOCK_CLAUDE` | Set to `true` to skip Claude and use canned responses |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push notification keys |

## Architecture

### Data Flow
```
Roanuz Cricket API (Socket.IO)
        ↓
RoanuzCricketSocket.ts   — receives ball events, detects wickets/sixes/fours
        ↓
Claude Streaming API     — generates commentary per persona via system prompts
        ↓
CommentaryBroadcaster    — fans out SSE tokens to all subscribed clients
        ↓
React frontend (EventSource hook) — renders streaming tokens in real time
```

### Key Backend Files
- **`src/server.ts`** — Fastify server; registers SSE routes, push routes, health check. SSE stream is `/stream/:matchKey?persona=casual_hype`.
- **`src/RoanuzCricketSocket.ts`** — Core logic: Socket.IO connection to Roanuz, event classification, Claude streaming per persona. Token refresh at 23h interval.
- **`src/MatchRegistry.ts`** — Singleton map of `matchKey → RoanuzCricketSocket`. Creates/tears down sockets based on active client count.
- **`src/CommentaryBroadcaster.ts`** — Per-match SSE registry; persona-aware fan-out of streaming tokens.
- **`src/CommentaryCache.ts`** — Caches generated commentary responses.
- **`src/MockCricketSocket.ts`** / **`src/mockSimulator.ts`** — Drop-in mock; emits canned ball events at intervals. Use `MOCK_CLAUDE=true` for fully offline dev.
- **`src/PushService.ts`** — Manages browser push subscriptions and dispatches web-push notifications on notable events.

### Key Frontend Files
- **`frontend/src/App.tsx`** — Scoreboard UI, commentary feed, persona switcher.
- **`frontend/src/hooks/useCommentaryStream.ts`** — `EventSource` hook; connects to `/stream/:matchKey`, accumulates streaming tokens by persona.
- **`frontend/src/hooks/usePushNotifications.ts`** — Handles browser push subscription lifecycle.

### Personas
Nine simultaneous commentator styles defined in `RoanuzCricketSocket.ts`: `casual_hype`, `stats_nerd`, `hindi`, `tamil`, `telugu`, `bengali`, `marathi`, `kannada`, `malayalam`. Each has its own Claude system prompt and TTS voice configuration. Clients select a persona via the `?persona=` query param on the SSE endpoint.

### Reconnection & Lifecycle
- Socket.IO reconnects with exponential backoff (1 s → 60 s cap).
- `MatchRegistry` auto-disposes a `RoanuzCricketSocket` when its broadcaster has zero clients.
- Roanuz API token is refreshed on a 23-hour interval inside `RoanuzCricketSocket`.
