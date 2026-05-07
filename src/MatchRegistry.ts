import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { RoanuzCricketSocket, PersonaMode } from "./RoanuzCricketSocket";
import { PERSONA_PROMPTS } from "./RoanuzCricketSocket";
import { MockCricketSocket } from "./MockCricketSocket";
import { CommentaryBroadcaster } from "./CommentaryBroadcaster";
import { PushService } from "./PushService";

type AnySocket = RoanuzCricketSocket | MockCricketSocket;

// ─── Normalised MatchState (matches what frontend/App.tsx expects) ────────────

interface NormalisedMatchState {
  matchKey: string;
  homeTeam:  { name: string; abbreviation: string };
  awayTeam:  { name: string; abbreviation: string };
  score: {
    home: { runs: number; wickets: number; overs: string };
    away: { runs: number; wickets: number; overs: string };
  };
  runRate:    string;
  status:     string;
  batters?:   Array<{ name: string; runs: number; balls: number; fours: number; sixes: number; strikeRate: number }>;
  bowlers?:   Array<{ name: string; overs: string; wickets: number; runs: number; economy: number }>;
  raw?: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "21/0" → { runs: 21, wickets: 0 } */
function parseScore(s: string | null | undefined): { runs: number; wickets: number } {
  if (!s) return { runs: 0, wickets: 0 };
  const [r, w] = s.split("/");
  return { runs: parseInt(r) || 0, wickets: parseInt(w) || 0 };
}

/**
 * Convert cricket "overs" string to run-rate.
 * "2.5" means 2 complete overs + 5 balls = 17 balls total — NOT 2.5 decimal overs.
 */
function calcRunRate(runs: number, oversStr: string | null | undefined): string {
  if (!oversStr) return "0.00";
  const [maj, min = "0"] = oversStr.replace(/\s*\/.*/, "").split(".");
  const totalBalls = parseInt(maj) * 6 + parseInt(min);
  if (totalBalls === 0) return "0.00";
  return ((runs * 6) / totalBalls).toFixed(2);
}

/** Transform the raw Highlightly /matches/:id response into NormalisedMatchState */
function normalizeHighlightlyState(raw: any, matchKey: string): NormalisedMatchState {
  const homeTeam = { name: raw.homeTeam?.name ?? "Home", abbreviation: raw.homeTeam?.abbreviation ?? "HOM" };
  const awayTeam = { name: raw.awayTeam?.name ?? "Away", abbreviation: raw.awayTeam?.abbreviation ?? "AWY" };

  const homeScoreStr: string | null = raw.state?.teams?.home?.score ?? null;
  const awayScoreStr: string | null = raw.state?.teams?.away?.score ?? null;
  const homeInfo: string | null = raw.state?.teams?.home?.info ?? null;
  const awayInfo: string | null = raw.state?.teams?.away?.info ?? null;

  const homeParsed = parseScore(homeScoreStr);
  const awayParsed = parseScore(awayScoreStr);

  // "info" is like "2.5/20 ov" — extract just the "2.5" part
  const homeOvers = homeInfo ? homeInfo.split("/")[0].trim() : "0";
  const awayOvers = awayInfo ? awayInfo.split("/")[0].trim() : "0";

  // Run rate is for whichever innings is live
  const battingRuns = homeParsed.runs > 0 || awayParsed.runs === 0 ? homeParsed.runs : awayParsed.runs;
  const battingOvers = homeParsed.runs > 0 || awayParsed.runs === 0 ? homeOvers : awayOvers;
  const runRate = calcRunRate(battingRuns, battingOvers);

  // Batters
  const battersRaw: any[] = raw.inplayData?.batsmen ?? [];
  const batters = battersRaw.map((b: any) => ({
    name:        b.player?.name ?? "Unknown",
    runs:        b.player?.statistics?.runs ?? 0,
    balls:       b.player?.statistics?.balls ?? 0,
    fours:       b.player?.statistics?.fours ?? 0,
    sixes:       b.player?.statistics?.sixes ?? 0,
    strikeRate:  b.player?.statistics?.strikeRate ?? 0,
  }));

  // Bowlers
  const bowlersRaw: any[] = raw.inplayData?.bowlers ?? [];
  const bowlers = bowlersRaw.map((b: any) => ({
    name:     b.player?.name ?? "Unknown",
    overs:    String(b.player?.statistics?.overs ?? "0"),
    wickets:  b.player?.statistics?.wickets ?? 0,
    runs:     b.player?.statistics?.runsConceded ?? 0,
    economy:  b.player?.statistics?.economy ?? 0,
  }));

  return {
    matchKey,
    homeTeam,
    awayTeam,
    score: {
      home: { ...homeParsed, overs: homeOvers },
      away: { ...awayParsed, overs: awayOvers },
    },
    runRate,
    status: raw.state?.description ?? "Unknown",
    batters,
    bowlers,
    raw,
  };
}

// ─── State-diff helpers ───────────────────────────────────────────────────────

interface ScoreSnapshot {
  homeRuns: number;
  homeWickets: number;
  awayRuns: number;
  awayWickets: number;
}

function extractSnapshot(state: NormalisedMatchState): ScoreSnapshot {
  return {
    homeRuns:     state.score.home.runs,
    homeWickets:  state.score.home.wickets,
    awayRuns:     state.score.away.runs,
    awayWickets:  state.score.away.wickets,
  };
}

interface CommentaryTrigger {
  type: "wicket" | "boundary";
  runs?: number;
  team: string;
  batters: string[];
  bowlers: string[];
  homeTeam: string;
  awayTeam: string;
  score: string;
  runRate: string;
}

/** Returns a trigger if the state diff warrants commentary, otherwise null */
function detectTrigger(
  prev: ScoreSnapshot,
  curr: NormalisedMatchState,
): CommentaryTrigger | null {
  const snap = extractSnapshot(curr);
  const homeRunDiff = snap.homeRuns - prev.homeRuns;
  const awayRunDiff = snap.awayRuns - prev.awayRuns;
  const homeWktDiff = snap.homeWickets - prev.homeWickets;
  const awayWktDiff = snap.awayWickets - prev.awayWickets;

  const batterNames = (curr.batters ?? []).map((b) => b.name);
  const bowlerNames = (curr.bowlers ?? []).map((b) => b.name);

  const homeScore = `${snap.homeRuns}/${snap.homeWickets} (${curr.score.home.overs} ov)`;
  const awayScore = `${snap.awayRuns}/${snap.awayWickets} (${curr.score.away.overs} ov)`;
  const scoreStr = `${curr.homeTeam.abbreviation}: ${homeScore}  ${curr.awayTeam.abbreviation}: ${awayScore}`;

  if (homeWktDiff > 0) {
    return { type: "wicket", team: curr.homeTeam.name, batters: batterNames, bowlers: bowlerNames, homeTeam: curr.homeTeam.name, awayTeam: curr.awayTeam.name, score: scoreStr, runRate: curr.runRate };
  }
  if (awayWktDiff > 0) {
    return { type: "wicket", team: curr.awayTeam.name, batters: batterNames, bowlers: bowlerNames, homeTeam: curr.homeTeam.name, awayTeam: curr.awayTeam.name, score: scoreStr, runRate: curr.runRate };
  }
  if (homeRunDiff >= 4) {
    return { type: "boundary", runs: homeRunDiff, team: curr.homeTeam.name, batters: batterNames, bowlers: bowlerNames, homeTeam: curr.homeTeam.name, awayTeam: curr.awayTeam.name, score: scoreStr, runRate: curr.runRate };
  }
  if (awayRunDiff >= 4) {
    return { type: "boundary", runs: awayRunDiff, team: curr.awayTeam.name, batters: batterNames, bowlers: bowlerNames, homeTeam: curr.homeTeam.name, awayTeam: curr.awayTeam.name, score: scoreStr, runRate: curr.runRate };
  }
  return null;
}

function buildPrompt(trigger: CommentaryTrigger): string {
  const eventLine =
    trigger.type === "wicket"
      ? `WICKET! ${trigger.team} lose a wicket.`
      : `BOUNDARY! ${trigger.runs} runs scored by ${trigger.team}.`;

  const battersLine = trigger.batters.length
    ? `Batters at crease: ${trigger.batters.join(", ")}.`
    : "";
  const bowlersLine = trigger.bowlers.length
    ? `Current bowler(s): ${trigger.bowlers.join(", ")}.`
    : "";

  return `Match: ${trigger.homeTeam} vs ${trigger.awayTeam} (IPL T20)
Score: ${trigger.score}  |  CRR: ${trigger.runRate}
${eventLine}
${battersLine}
${bowlersLine}
Generate commentary now.`;
}

// ─── MatchRegistry ────────────────────────────────────────────────────────────

export class MatchRegistry {
  private sockets: Map<string, AnySocket> = new Map();
  private publicStatePollers: Map<string, NodeJS.Timeout> = new Map();
  private lastPublicState: Map<string, string> = new Map();
  private lastScoreSnapshot: Map<string, ScoreSnapshot> = new Map();
  private readonly PUBLIC_POLL_INTERVAL_MS = 30_000;
  private broadcaster: CommentaryBroadcaster;
  private push: PushService;
  private fallbackOnly: boolean;
  private anthropic: Anthropic;

  constructor(broadcaster: CommentaryBroadcaster, push: PushService, fallbackOnly = false) {
    this.broadcaster = broadcaster;
    this.push = push;
    this.fallbackOnly = fallbackOnly;
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }

  async ensureConnected(matchKey: string): Promise<void> {
    if (this.sockets.has(matchKey)) return;
    console.log(`[Registry] Spinning up socket for match: ${matchKey}`);

    const onCommentary = (token: string, eventType: string, persona: PersonaMode) => {
      this.broadcaster.broadcastToPersona(matchKey, persona, "token", { token, eventType });
    };
    const onFantasy = (advice: string, eventType: string, batsman: string) => {
      this.broadcaster.broadcast(matchKey, "fantasy", { advice, eventType, batsman });
    };
    const onNotableEvent = (payload: { title: string; body: string; tag: string }) => {
      this.push.broadcast(payload).catch(console.error);
    };
    const onError = (err: Error) => {
      console.error(`[Registry] Socket error for ${matchKey}:`, err.message);
      this.broadcaster.broadcast(matchKey, "error", { message: err.message });
      this.sockets.delete(matchKey);
    };

    // Callback to get all active personas for this match - needed for multi-persona commentary
    const getActivePersonas = (): PersonaMode[] => {
      return this.broadcaster.activePersonas(matchKey) as PersonaMode[];
    };

    if (this.fallbackOnly && matchKey !== "mock") {
      console.log(`[Registry] HIGHLIGHTLY_FALLBACK_ONLY enabled for ${matchKey}. Skipping Roanuz socket setup.`);
      this.startPublicStatePolling(matchKey);
      return;
    }

    const socket: AnySocket = matchKey === "mock"
      ? new MockCricketSocket({
          matchKey,
          getActivePersonas,
          onCommentary,
          onFantasy,
          onNotableEvent,
          onError,
        })
      : new RoanuzCricketSocket({
          projectKey: process.env.ROANUZ_PROJECT_KEY!,
          apiKey:     process.env.ROANUZ_API_KEY!,
          matchKey,
          persona:    "casual_hype", // Default, will be overridden by getActivePersonas
          getActivePersonas,
          onCommentary,
          onFantasy,
          onNotableEvent,
          onError,
        });

    await socket.connect();
    await socket.subscribeMatch().catch((err) => {
      console.warn(`[Registry] Public subscription failed for ${matchKey}:`, err?.message ?? err);
    });
    this.sockets.set(matchKey, socket);
    this.startPublicStatePolling(matchKey);
  }

  getSocket(matchKey: string): AnySocket | undefined {
    return this.sockets.get(matchKey);
  }

  activeSockets(): string[] {
    return [...this.sockets.keys()];
  }

  async getMatchState(matchKey: string): Promise<any | null> {
    const socket = this.sockets.get(matchKey);
    const socketState = socket?.getMatchState();
    if (socketState) return socketState;

    const cachedState = this.lastPublicState.get(matchKey);
    if (cachedState) {
      try {
        return JSON.parse(cachedState);
      } catch {
        // ignore corrupted cache and fall back to live fetch
      }
    }

    return await this.fetchPublicMatchState(matchKey);
  }

  ensurePublicStatePolling(matchKey: string): void {
    this.startPublicStatePolling(matchKey);
  }

  private startPublicStatePolling(matchKey: string): void {
    if (this.publicStatePollers.has(matchKey)) return;

    const poll = async (): Promise<void> => {
      const state = await this.fetchPublicMatchState(matchKey);
      if (!state) return;

      const payload = JSON.stringify(state);
      const last = this.lastPublicState.get(matchKey);
      if (payload === last) return;

      this.lastPublicState.set(matchKey, payload);
      this.broadcaster.broadcast(matchKey, "state", state);
      console.log(`[Registry] Public fallback state broadcast for ${matchKey}`);
    };

    poll().catch((err) => {
      console.warn(`[Registry] Initial public match state poll failed for ${matchKey}:`, err?.message ?? err);
    });

    const timer = setInterval(() => poll().catch((err) => {
      console.warn(`[Registry] Public match state poll failed for ${matchKey}:`, err?.message ?? err);
    }), this.PUBLIC_POLL_INTERVAL_MS);

    this.publicStatePollers.set(matchKey, timer);
  }

  private stopPublicStatePolling(matchKey: string): void {
    const timer = this.publicStatePollers.get(matchKey);
    if (timer) {
      clearInterval(timer);
      this.publicStatePollers.delete(matchKey);
      this.lastPublicState.delete(matchKey);
      this.lastScoreSnapshot.delete(matchKey);
    }
  }

  private async fetchPublicMatchState(matchKey: string): Promise<any | null> {
    const apiKey = process.env.HIGHLIGHTLY_API_KEY;
    if (!apiKey) {
      return null;
    }

    const baseUrl = (process.env.HIGHLIGHTLY_API_BASE_URL || process.env.HIGHLIGHTLY_BASE_URL || "https://cricket-highlights-api.p.rapidapi.com").replace(/\/$/, "");
    const headers: Record<string, string> = {
      "x-rapidapi-key": apiKey,
      Accept: "application/json",
    };

    if (process.env.HIGHLIGHTLY_API_HOST) {
      headers["x-rapidapi-host"] = process.env.HIGHLIGHTLY_API_HOST;
    }

    const candidates = [
      `${baseUrl}/matches/${matchKey}`,
      `${baseUrl}/match/${matchKey}`,
      `${baseUrl}/api/matches/${matchKey}`,
      `${baseUrl}/api/match/${matchKey}`,
    ];

    let lastError: any = null;
    for (const url of candidates) {
      try {
        const res = await axios.get(url, { headers, timeout: 10_000 });
        const raw = res.data?.data ?? res.data;
        if (!raw) {
          if (res.status === 200) return res.data;
          continue;
        }

        // Normalise into the frontend MatchState shape
        const normalised = normalizeHighlightlyState(raw, matchKey);

        // Fire Claude commentary if score has changed meaningfully
        const prevSnapshot = this.lastScoreSnapshot.get(matchKey);
        if (prevSnapshot) {
          const trigger = detectTrigger(prevSnapshot, normalised);
          if (trigger) {
            console.log(`[Registry] Commentary trigger detected for ${matchKey}: ${trigger.type}`);
            this.maybeStreamCommentary(matchKey, trigger).catch((err) => {
              console.warn(`[Registry] Commentary stream error for ${matchKey}:`, err?.message ?? err);
            });
          }
        }
        this.lastScoreSnapshot.set(matchKey, extractSnapshot(normalised));

        return normalised;
      } catch (err: any) {
        lastError = err;
        const status = err?.response?.status;
        const body = err?.response?.data;
        if (status === 404 || status === 403) {
          console.debug(`[Registry] Highlightly candidate ${url} returned ${status}; trying next path.`);
          continue;
        }

        console.warn(`[Registry] Highlightly fallback request failed (${matchKey}) ${url}:`, err?.message ?? err, body ?? "");
      }
    }

    if (lastError?.response) {
      console.warn(`[Registry] Highlightly fallback failed for ${matchKey} after trying candidate paths. Last status:`, lastError.response.status);
    }
    return null;
  }

  /** Stream Claude commentary for all active personas and fan out tokens via SSE */
  private async maybeStreamCommentary(matchKey: string, trigger: CommentaryTrigger): Promise<void> {
    const personas = this.broadcaster.activePersonas(matchKey) as PersonaMode[];
    if (personas.length === 0) return;

    const prompt = buildPrompt(trigger);

    await Promise.allSettled(
      personas.map(async (persona) => {
        const systemPrompt = PERSONA_PROMPTS[persona];
        if (!systemPrompt) return;

        try {
          const stream = await this.anthropic.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 80,
            system: systemPrompt,
            messages: [{ role: "user", content: prompt }],
          });

          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              this.broadcaster.broadcastToPersona(matchKey, persona, "token", {
                token:     chunk.delta.text,
                eventType: trigger.type,
              });
            }
          }

          // Empty token signals end-of-line to the frontend
          this.broadcaster.broadcastToPersona(matchKey, persona, "token", {
            token:     "",
            eventType: trigger.type,
          });
        } catch (err: any) {
          console.warn(`[Registry] Claude stream error for persona ${persona}:`, err?.message ?? err);
        }
      }),
    );
  }

  teardownIfEmpty(matchKey: string): void {
    if (this.broadcaster.clientCount(matchKey) === 0) {
      this.stopPublicStatePolling(matchKey);
      const socket = this.sockets.get(matchKey);
      if (socket) {
        socket.destroy();
        this.sockets.delete(matchKey);
        console.log(`[Registry] Tore down socket for ${matchKey} (no clients left)`);
      }
    }
  }
}
