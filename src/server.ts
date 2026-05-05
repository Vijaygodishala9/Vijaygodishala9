import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "crypto";
import * as path from "path";
import * as dotenv from "dotenv";
import axios from "axios";
import { CommentaryBroadcaster } from "./CommentaryBroadcaster";
import { MatchRegistry } from "./MatchRegistry";
import { PushService } from "./PushService";
import { PersonaMode } from "./HighlightlyCricketSocket";

dotenv.config({ override: true, path: path.resolve(process.cwd(), ".env") });

// Helper function for retrying axios requests with exponential backoff
async function retryAxios(requestFn: () => Promise<any>, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      if (error.response?.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`Rate limited. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

function getPublicApiBase() {
  const projectHost = process.env.HIGHLIGHTLY_API_HOST?.trim();
  if (projectHost) {
    return `https://${projectHost}`;
  }
  return (process.env.HIGHLIGHTLY_API_BASE_URL ?? "https://cricket.highlightly.net").replace(/\/+$/, "");
}

function makePublicApiHeaders() {
  const headers: Record<string, string> = {
    "User-Agent": "CricketDesk/1.0",
  };
  const apiKey = process.env.HIGHLIGHTLY_API_KEY;
  const projectHost = process.env.HIGHLIGHTLY_API_HOST?.trim();

  if (projectHost) {
    headers["x-rapidapi-key"] = apiKey!;
    headers["x-rapidapi-host"] = projectHost;
  } else if (apiKey) {
    headers["rs-token"] = apiKey;
  }

  return headers;
}

async function fetchPublicMatchState(matchKey: string) {
  const apiBase = getPublicApiBase();
  const projectKey = process.env.HIGHLIGHTLY_PROJECT_KEY;
  const headers = makePublicApiHeaders();

  if (projectKey) {
    try {
      const liveUrl = `${apiBase}/cricket/${projectKey}/matches/live/`;
      console.log(`[Server] Fetching live matches from ${liveUrl} for matchKey=${matchKey}`);
      const response = await retryAxios(() => axios.get(liveUrl, { headers }));
      const data = response.data?.data ?? response.data ?? [];
      console.log(`[Server] Live matches fetched: ${Array.isArray(data) ? data.length : 0}`);
      const match = (data as any[]).find((m) => String(m.id) === String(matchKey) || String(m.match_key) === String(matchKey));
      if (match) {
        console.log(`[Server] Match ${matchKey} found in live matches: ${match.name || match.title || match.match_key || match.id}`);
        return normalizePublicMatch(match);
      }
    } catch (err: any) {
      const status = err.response?.status ?? "unknown";
      const errorData = err.response?.data ?? err.message;
      console.warn(`[Server] Live match fetch failed: ${status}`, typeof errorData === 'object' ? JSON.stringify(errorData).slice(0, 200) : errorData);
    }
  }

  const dates = [
    new Date().toISOString().slice(0, 10),
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  ];

  for (const date of dates) {
    try {
      const query = new URLSearchParams({ date, limit: "200" }).toString();
      const apiUrl = `${apiBase}/matches?${query}`;
      console.log(`[Server] Fetching public matches for date=${date}, matchKey=${matchKey}, URL=${apiUrl}`);
      const response = await axios.get(apiUrl, { headers });
      const data = response.data?.data ?? [];
      console.log(`[Server] Found ${data.length} matches in public API for ${date}`);
      console.log(`[Server] Match IDs: ${data.map((m: any) => m.id || m.match_key).join(', ')}`);
      const match = (data as any[]).find((m) => String(m.id) === String(matchKey) || String(m.match_key) === String(matchKey));
      if (match) {
        console.log(`[Server] Match ${matchKey} found on ${date}: ${match.name || match.title || match.match_key || match.id}`);
        return normalizePublicMatch(match);
      }
    } catch (err: any) {
      const status = err.response?.status ?? "unknown";
      const errorData = err.response?.data ?? err.message;
      console.warn(`[Server] Public match fetch failed for ${date}: ${status}`, typeof errorData === 'object' ? JSON.stringify(errorData).slice(0, 200) : errorData);
    }
  }

  console.log(`[Server] Match ${matchKey} not found in public API for any date`);
  return null;
}

function normalizePublicMatch(match: any) {
  const awayInfo = match?.state?.teams?.away ?? {};
  const homeInfo = match?.state?.teams?.home ?? {};
  const isAwayBatting = Boolean(awayInfo?.info && String(awayInfo?.score).trim());
  const battingTeam = isAwayBatting ? match.awayTeam : match.homeTeam;
  const bowlingTeam = isAwayBatting ? match.homeTeam : match.awayTeam;
  const battingState = isAwayBatting ? awayInfo : homeInfo;

  const scoreText = String(battingState.score ?? "0/0");
  const [runsText, wicketsText] = scoreText.split("/");
  const runs = Number(runsText || 0);
  const wickets = Number(wicketsText || 0);
  const oversMatch = String(battingState.info ?? "").match(/(\d+(?:\.\d+)?)/);
  const overs = oversMatch ? String(parseFloat(oversMatch[1]).toFixed(1)) : "0.0";
  const runRate = overs !== "0.0" ? String((runs / parseFloat(overs)).toFixed(2)) : "0.00";

  const batters = extractPublicBatters(match);
  const bowlers = extractPublicBowlers(match);
  const lastBall = extractPublicLastBall(match);

  return {
    score: String(runs),
    wickets,
    overs,
    run_rate: runRate,
    batting_team: battingTeam?.name ?? "",
    bowling_team: bowlingTeam?.name ?? "",
    target: undefined,
    required_rate: undefined,
    partnership: match.state?.report ?? undefined,
    last_wicket: undefined,
    last_5_overs: undefined,
    batters: batters.length > 0 ? batters : undefined,
    bowlers: bowlers.length > 0 ? bowlers : undefined,
    last_ball: lastBall,
  };
}

function normalizePublicBatters(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any) => {
      const name = b?.player?.name ?? b?.name ?? b?.batter ?? b?.batsman ?? "Batter";
      const runs = Number(b?.runs ?? b?.score ?? 0);
      const balls = Number(b?.balls ?? b?.balls_faced ?? b?.face ?? 0);
      const fours = Number(b?.fours ?? b?.x4 ?? 0);
      const sixes = Number(b?.sixes ?? b?.x6 ?? 0);
      const on_strike = Boolean(b?.is_striker ?? b?.on_strike ?? b?.strike ?? false);
      return { name, runs, balls, fours, sixes, on_strike };
    })
    .filter((b: any) => b.name && !Number.isNaN(b.runs));
}

function normalizePublicBowlers(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any) => {
      const name = b?.player?.name ?? b?.name ?? b?.bowler ?? "Bowler";
      const overs = String(b?.overs ?? b?.ov ?? b?.over ?? "0.0");
      const runs = Number(b?.runs ?? b?.runs_given ?? b?.conceded ?? 0);
      const wickets = Number(b?.wickets ?? b?.wkts ?? 0);
      const economy = b?.economy
        ? String(parseFloat(b.economy).toFixed(2))
        : parseFloat(overs) > 0
          ? String((runs / parseFloat(overs)).toFixed(2))
          : "0.00";
      const current = Boolean(b?.is_current_bowler ?? b?.current ?? false);
      return { name, overs, runs, wickets, economy, current };
    })
    .filter((b: any) => b.name && !Number.isNaN(b.wickets));
}

function findFirstArray(...candidates: any[]): any[] {
  for (const item of candidates) {
    if (Array.isArray(item) && item.length > 0) return item;
  }
  return [];
}

function extractPublicBatters(match: any): any[] {
  const candidate = findFirstArray(
    match?.score?.batting,
    match?.state?.batting,
    match?.state?.teams?.away?.batting,
    match?.state?.teams?.home?.batting,
    match?.state?.teams?.away?.players,
    match?.state?.teams?.home?.players,
    match?.state?.teams?.away?.batsmen,
    match?.state?.teams?.home?.batsmen
  );
  return normalizePublicBatters(candidate).slice(0, 4);
}

function extractPublicBowlers(match: any): any[] {
  const candidate = findFirstArray(
    match?.score?.bowling,
    match?.state?.bowling,
    match?.state?.teams?.away?.bowling,
    match?.state?.teams?.home?.bowling,
    match?.state?.teams?.away?.bowlers,
    match?.state?.teams?.home?.bowlers
  );
  return normalizePublicBowlers(candidate).slice(0, 5);
}

function extractPublicLastBall(match: any) {
  const ball = match?.state?.recent_ball ?? match?.state?.last_ball ?? match?.score?.recent_ball ?? null;
  if (!ball) return undefined;
  const ballNumber = ball.ball_number ?? ball.ball ?? null;
  if (!ballNumber) return undefined;
  const runs = Number(ball.runs ?? 0);
  return {
    ball_number: ballNumber,
    batsman: ball?.batsman?.name ?? ball?.batter ?? "Batter",
    bowler: ball?.bowler?.name ?? ball?.bowler_name ?? "Bowler",
    runs,
    extras: Number(ball.extras ?? 0),
    wicket: Boolean(ball.wicket ?? false),
    wicket_type: ball.wicket_type ?? ball.wicketType ?? "",
    commentary: ball.commentary ?? ball.text ?? "",
    over: Math.floor(parseFloat(String(ballNumber))),
    ball: Math.round((parseFloat(String(ballNumber)) % 1) * 10),
  };
}

const publicStatePollers = new Map<string, { timer: NodeJS.Timeout; lastPayload?: string }>();
const PUBLIC_STATE_POLL_INTERVAL = 10_000;

function startPublicFallbackPolling(matchKey: string, broadcaster: CommentaryBroadcaster) {
  if (publicStatePollers.has(matchKey)) return;

  const poll = async () => {
    if (broadcaster.clientCount(matchKey) === 0) {
      stopPublicFallbackPolling(matchKey);
      return;
    }

    try {
      const publicState = await fetchPublicMatchState(matchKey);
      if (!publicState) return;

      const payload = JSON.stringify(publicState);
      const poller = publicStatePollers.get(matchKey);
      if (!poller) return;

      if (payload !== poller.lastPayload) {
        poller.lastPayload = payload;
        console.log(`[Server] Public poll sending state update for ${matchKey}: ${JSON.stringify(publicState).slice(0, 200)}...`);
        broadcaster.broadcast(matchKey, "state", publicState);
      }
    } catch (err: any) {
      console.warn(`[Server] Public poll failed for ${matchKey}:`, err.message);
    }
  };

  const timer = setInterval(poll, PUBLIC_STATE_POLL_INTERVAL);
  publicStatePollers.set(matchKey, { timer, lastPayload: undefined });
  poll();
}

function stopPublicFallbackPolling(matchKey: string) {
  const poller = publicStatePollers.get(matchKey);
  if (!poller) return;
  clearInterval(poller.timer);
  publicStatePollers.delete(matchKey);
}

console.log("Environment check:");
console.log("VAPID_PUBLIC_KEY:", process.env.VAPID_PUBLIC_KEY ? "SET" : "NOT SET");
console.log("VAPID_PRIVATE_KEY:", process.env.VAPID_PRIVATE_KEY ? "SET" : "NOT SET");
console.log("HIGHLIGHTLY_PROJECT_KEY:", process.env.HIGHLIGHTLY_PROJECT_KEY ? "SET" : "NOT SET");
console.log("HIGHLIGHTLY_API_KEY:", process.env.HIGHLIGHTLY_API_KEY ? "SET" : "NOT SET");

const REQUIRED_ENV = [
  "HIGHLIGHTLY_PROJECT_KEY",
  "HIGHLIGHTLY_API_KEY",
  "ANTHROPIC_API_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error("Missing required environment variables:", missingEnv.join(", "));
  process.exit(1);
}

const VALID_PERSONAS: PersonaMode[] = [
  "casual_hype", "stats_nerd",
  "hindi", "tamil", "telugu", "bengali", "marathi", "kannada", "malayalam",
];
const DEFAULT_PORT = 3001;

async function main() {
  const app = Fastify({ logger: { level: "warn" } });
  const broadcaster = new CommentaryBroadcaster();
  const push = new PushService();
  const registry = new MatchRegistry(broadcaster, push);

  await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? "http://localhost:5174",
    methods: ["GET", "POST"],
  });

  app.get("/health", async () => ({
    status: "ok",
    activeMatches: registry.activeSockets(),
    socketStatus: registry.socketStatus(),
    ts: new Date().toISOString(),
  }));

  app.get("/", async () => ({
    message: "Cricket Commentary SSE Server",
    endpoints: ["/health", "/stream/:matchKey", "/match/:matchKey/state", "/matches/live", "/push/vapid-public-key", "/push/subscribe"],
  }));

  // Discover live matches from Highlightly API
  app.get("/matches/live", async (_req, reply) => {
    try {
      const apiBase = (process.env.HIGHLIGHTLY_API_BASE_URL ?? "").replace(/\/+$/, "");
      const projectKey = process.env.HIGHLIGHTLY_PROJECT_KEY!;
      const apiKey = process.env.HIGHLIGHTLY_API_KEY!;
      const apiHost = process.env.HIGHLIGHTLY_API_HOST ?? "";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      headers["x-rapidapi-key"] = apiKey;
      if (apiHost) headers["x-rapidapi-host"] = apiHost;

      // Get auth token first with retry
      const authRes = await retryAxios(() =>
        axios.post(`${apiBase}/core/${projectKey}/auth/`, { api_key: apiKey }, { headers })
      );
      const token = authRes.data?.data?.token;
      if (token) headers["rs-token"] = token;

      // Fetch live matches with retry
      const matchRes = await retryAxios(() =>
        axios.get(`${apiBase}/cricket/${projectKey}/matches/live/`, { headers })
      );

      const matches: any[] = matchRes.data?.data ?? matchRes.data ?? [];
      return { matches };
    } catch (err: any) {
      const status = err.response?.status ?? 500;
      const message = err.response?.data?.message ?? err.message;
      reply.code(status).send({ error: message, matches: [] });
    }
  });

  // SSE stream endpoint
  app.get<{
    Params: { matchKey: string };
    Querystring: { persona?: string };
  }>("/stream/:matchKey", async (req, reply) => {
    const { matchKey } = req.params;
    const persona = (req.query.persona ?? "casual_hype") as PersonaMode;

    if (!VALID_PERSONAS.includes(persona)) {
      return reply.code(400).send({ error: `Invalid persona. Choose: ${VALID_PERSONAS.join(", ")}` });
    }

    reply.raw.writeHead(200, {
      "Content-Type":                     "text/event-stream",
      "Cache-Control":                    "no-cache, no-transform",
      "Connection":                       "keep-alive",
      "X-Accel-Buffering":                "no",
      "Access-Control-Allow-Origin":      process.env.FRONTEND_URL ?? "http://localhost:5174",
      "Access-Control-Allow-Credentials": "true",
    });

    const clientId = randomUUID();
    broadcaster.register({ id: clientId, matchKey, persona, reply, connectedAt: Date.now() });
    console.log(`[Server] /stream/${matchKey} opened for persona=${persona}`);

    await registry.ensureConnected(matchKey).catch((err) => {
      console.warn(`[Server] Live socket connect failed for ${matchKey}: ${err.message}`);
    });

    const socket = registry.getSocket(matchKey);
    const state = socket?.getMatchState();
    if (state) {
      broadcaster.send(clientId, "connected", {
        clientId,
        matchKey,
        persona,
        ts: Date.now(),
      });
      broadcaster.send(clientId, "state", state);
      stopPublicFallbackPolling(matchKey);
    } else {
      const publicState = await fetchPublicMatchState(matchKey);
      if (publicState) {
        broadcaster.send(clientId, "connected", {
          clientId,
          matchKey,
          persona,
          ts: Date.now(),
        });
        broadcaster.send(clientId, "state", publicState);
      } else {
        broadcaster.send(clientId, "error", { message: "No public match state available yet." });
      }
      startPublicFallbackPolling(matchKey, broadcaster);
    }

    const heartbeat = setInterval(() => {
      try { reply.raw.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      broadcaster.remove(clientId);
      if (broadcaster.clientCount(matchKey) === 0) {
        stopPublicFallbackPolling(matchKey);
      }
      registry.teardownIfEmpty(matchKey);
    });

    await new Promise(() => {});
  });

  // Push: return VAPID public key so the frontend can subscribe
  app.get("/push/vapid-public-key", async () => ({
    publicKey: push.publicKey,
  }));

  // Push: store a browser push subscription
  app.post("/push/subscribe", async (req, reply) => {
    const sub = req.body as any;
    if (!sub?.endpoint) return reply.code(400).send({ error: "Invalid subscription" });
    const id = push.add(sub);
    return { ok: true, id };
  });

  // Match state snapshot
  app.get<{ Params: { matchKey: string } }>(
    "/match/:matchKey/state",
    async (req, reply) => {
      const socket = registry.getSocket(req.params.matchKey);
      const state = socket?.getMatchState();
      if (state) return state;

      const publicState = await fetchPublicMatchState(req.params.matchKey);
      if (publicState) return publicState;

      return reply.code(404).send({ error: "Match not active or no state available" });
    }
  );

  // Switch persona
  app.post<{ Params: { matchKey: string } }>(
    "/match/:matchKey/persona",
    async (req, reply) => {
      const { persona } = req.body as { persona: string };
      if (!VALID_PERSONAS.includes(persona as PersonaMode)) {
        return reply.code(400).send({ error: "Invalid persona" });
      }
      return { ok: true, persona };
    }
  );

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${port}`);
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
