# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time cricket commentary streaming app. The backend connects to the Roanuz Cricket API (Socket.IO), feeds ball-by-ball events to Claude (claude-sonnet-4-6), and streams AI-generated commentary tokens to a React frontend over SSE. Nine commentator personas run simultaneously, including Hindi, Tamil, Telugu, and other regional language styles.

## Commands

### Backend (root)
```bash
npm install          # install backend deps
npm run server       # start Fastify SSE server on :3001 (main dev command)
npm run mock         # run mockSimulator.ts CLI — fires fake events to stdout, no server needed
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

Create `.env` in the project root:

| Variable | Purpose |
|----------|---------|
| `ROANUZ_PROJECT_KEY` | Roanuz console project key |
| `ROANUZ_API_KEY` | Roanuz API key (`RS5:...`) |
| `ROANUZ_MATCH_KEY` | Match identifier to stream |
| `ANTHROPIC_API_KEY` | Claude API key |
| `FRONTEND_URL` | CORS origin for SSE (default: `http://localhost:5174`) |
| `MOCK_CLAUDE` | Set to `true` to use canned responses instead of Claude in mock mode |
| `HIGHLIGHTLY_API_KEY` | RapidAPI key for Highlightly REST fallback (public match state polling) |
| `HIGHLIGHTLY_API_BASE_URL` | Highlightly API base URL (default: `https://cricket-highlights-api.p.rapidapi.com`) |
| `HIGHLIGHTLY_API_HOST` | Sets `x-rapidapi-host` header if required |
| `HIGHLIGHTLY_FALLBACK_ONLY` | Set to `true` to skip Roanuz socket entirely and use only Highlightly REST polling |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push notification keys (required — server throws on startup if missing) |
| `VAPID_EMAIL` | Contact email for VAPID details (default: `admin@localhost`) |
| `PORT` | Override server port (default: `3001`) |

Frontend Vite env vars (in `frontend/.env`):

| Variable | Purpose |
|----------|---------|
| `VITE_MATCH_KEY` | Match key the UI connects to (default: `indpak_2024_t20_01`) |
| `VITE_SERVER_URL` | Backend URL (default: `http://localhost:3001`) |

## Architecture

### Data Flow
```
Roanuz Cricket API (Socket.IO)
        ↓
RoanuzCricketSocket.ts   — receives ball events, classifies them, extracts match state
        ↓  (only for: wicket / six / four / over_complete)
Claude Streaming API     — generates commentary per active persona via system prompts
        ↓
CommentaryBroadcaster    — fans out SSE tokens to clients filtered by matchKey + persona
        ↓
React frontend (EventSource) — renders streaming tokens in real time
```

### Backend Key Files
- **`src/server.ts`** — Fastify server. SSE routes: `/stream/:matchKey?persona=<persona>` (live) and `/mock-stream/:matchKey` (mock). Also: `/health`, `/match/:matchKey/state`, `/push/vapid-public-key`, `/push/subscribe`.
- **`src/RoanuzCricketSocket.ts`** — Production Socket.IO handler. Auth + 23h token refresh, event parsing, Claude streaming across all active personas in parallel. Only comments on `wicket`, `six`, `four`, `over_complete` events.
- **`src/MatchRegistry.ts`** — Singleton map of `matchKey → socket`. Dispatches `matchKey = "mock"` to `MockCricketSocket` and all others to `RoanuzCricketSocket`. Also runs a 30s public state polling loop via Highlightly REST API as a fallback.
- **`src/CommentaryBroadcaster.ts`** — Per-match SSE client registry. `broadcast()` sends to all clients for a match; `broadcastToPersona()` filters by persona for commentary tokens.
- **`src/MockCricketSocket.ts`** — Drop-in socket replacement. Cycles through 7 fake India vs Pakistan events every 4 s. Uses live Claude if `ANTHROPIC_API_KEY` is set and `MOCK_CLAUDE != true`; falls back to hardcoded canned responses (7 events × 9 personas in `CANNED` array). Includes `CommentaryCache` to avoid re-calling Claude for duplicate events.
- **`src/mockSimulator.ts`** — Standalone CLI simulator (used by `npm run mock`) AND exports `MockMatchSimulator` class used by `/mock-stream` endpoint. Note: emits `commentary` events (full strings), unlike `MockCricketSocket` which streams word-by-word `token` events.
- **`src/CommentaryCache.ts`** — In-memory LRU cache (max 500 entries) keyed on `persona:eventType:batsman:bowler`.
- **`src/PushService.ts`** — Web Push subscription store and broadcaster.

### SSE Protocol
The server sends these named SSE events (consumed via `es.addEventListener(name, ...)`):
- `connected` — handshake with `{ clientId, matchKey, persona }`
- `token` — commentary chunk `{ token, eventType }`. An **empty `token` string** signals the start of a new commentary line; subsequent non-empty tokens append to it.
- `state` — full `MatchState` snapshot including batters, bowlers, score, run rate, target, etc.
- `fantasy` — fantasy advice `{ advice, eventType, batsman }`
- `error` — `{ message }` from server-side failures

### Frontend Key Files
- **`frontend/src/App.tsx`** — All UI in one file. Uses `EventSource` directly (not the `useCommentaryStream` hook). Handles the `token` empty-string protocol for building streaming commentary lines. Shows only 2 personas (`casual_hype`, `stats_nerd`) despite the backend supporting 9.
- **`frontend/src/hooks/useCommentaryStream.ts`** — Alternative `EventSource` hook (not used by `App.tsx`). Useful for custom integrations.
- **`frontend/src/hooks/usePushNotifications.ts`** — Push subscription lifecycle.

### Personas
Nine commentator styles: `casual_hype`, `stats_nerd`, `hindi`, `tamil`, `telugu`, `bengali`, `marathi`, `kannada`, `malayalam`. System prompts are defined independently in `RoanuzCricketSocket.ts`, `MockCricketSocket.ts`, and `mockSimulator.ts` — keep them in sync when editing. Clients select persona via `?persona=` query param; `CommentaryBroadcaster.broadcastToPersona()` routes tokens only to matching clients.

### Mock Modes Summary
| Mode | How to run | Commentary |
|------|-----------|------------|
| `matchKey=mock` on `/stream/` | `registry.ensureConnected("mock")` → `MockCricketSocket` | Word-by-word `token` events; live Claude or canned |
| `/mock-stream/:matchKey` | Direct, no registry | Full-string `commentary` events; live Claude only |
| `MOCK_CLAUDE=true` | Any mock mode | Forces canned `CANNED` array, no API calls |
| `HIGHLIGHTLY_FALLBACK_ONLY=true` | Env var | Skips Roanuz socket, public REST polling only |

### Reconnection & Lifecycle
- Socket.IO reconnects with exponential backoff (1 s → 60 s cap, max 8 attempts).
- `MatchRegistry` auto-disposes a socket when its broadcaster reaches zero clients.
- Roanuz API token is refreshed on a 23-hour interval; refreshed proactively before the socket re-subscribes after reconnect.
- SSE heartbeat every 25 s keeps connections alive through proxies.
