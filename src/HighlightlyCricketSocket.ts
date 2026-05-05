/**
 * HighlightlyCricketSocket.ts
 * Production-grade Socket.IO handler for Highlightly Cricket API v5
 * Covers: auth + token refresh, match subscription, event parsing,
 * reconnection with backoff, and Claude streaming commentary pipeline.
 *
 * Dependencies (add to package.json):
 *   socket.io-client  ^4.x
 *   axios             ^1.x
 *   @anthropic-ai/sdk ^0.x
 *   dotenv            ^16.x
 */

import { io, Socket } from "socket.io-client";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonaMode =
  | "casual_hype" | "stats_nerd"
  | "hindi" | "tamil" | "telugu" | "bengali" | "marathi" | "kannada" | "malayalam";

export interface HighlightlyConfig {
  projectKey: string;
  apiKey: string;
  matchKey: string;
  persona?: PersonaMode;
  getActivePersonas?: () => PersonaMode[];
  onCommentary?: (token: string, eventType: string, persona: PersonaMode) => void;
  onFantasy?: (advice: string, eventType: string, batsman: string) => void;
  onNotableEvent?: (payload: { title: string; body: string; tag: string }) => void;
  onError?: (err: Error) => void;
}

interface BallEvent {
  ball_number: string;
  batsman: string;
  bowler: string;
  runs: number;
  extras?: number;
  wicket?: boolean;
  wicket_type?: string;
  commentary?: string;
  over: number;
  ball: number;
}

// ─── NEW: player-level types sent to the frontend ─────────────────────────────

/** A batter currently at the crease */
interface Batter {
  name:      string;
  runs:      number;
  balls:     number;
  fours:     number;
  sixes:     number;
  on_strike: boolean;   // true = currently facing
}

/** A bowler who has bowled this innings */
interface Bowler {
  name:     string;
  overs:    string;    // e.g. "3.4"
  runs:     number;
  wickets:  number;
  economy:  string;   // e.g. "8.25"
  current:  boolean;  // true = bowling this over
}

// ─── MatchState (extended) ────────────────────────────────────────────────────

interface MatchState {
  score:          string;
  wickets:        number;
  overs:          string;
  run_rate:       string;
  batting_team:   string;
  bowling_team:   string;
  last_ball?:     BallEvent;
  // Fields consumed by the frontend scoreboard
  target?:        number;
  required_rate?: string;
  partnership?:   string;
  last_wicket?:   string;
  last_5_overs?:  string;
  // Live player tables
  batters?:       Batter[];
  bowlers?:       Bowler[];
}

// ─── Persona system prompts ───────────────────────────────────────────────────

const PERSONA_PROMPTS: Record<PersonaMode, string> = {
  casual_hype: `You are an exciting, casual cricket commentator. React with energy and emotion in 1-2 short sentences. Simple language, exclamations, drama. Never exceed 40 words.`,
  stats_nerd:  `You are a cricket analytics commentator. Give 1-2 sentences focused on statistics, run rates, strike rates, and data-driven insights. Be precise. Never exceed 40 words.`,
  hindi:       `Aap ek josh se bhari Hindi cricket commentator hain. Har ball ke liye 1-2 sentences mein Hindi mein commentary den — energetic, simple, fans ke liye. 40 se zyada words mat.`,
  tamil:       `You are an energetic Tamil cricket commentator. Give 1-2 sentences of commentary in Tamil for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
  telugu:      `You are an energetic Telugu cricket commentator. Give 1-2 sentences of commentary in Telugu for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
  bengali:     `You are an energetic Bengali cricket commentator. Give 1-2 sentences of commentary in Bengali for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
  marathi:     `You are an energetic Marathi cricket commentator. Give 1-2 sentences of commentary in Marathi for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
  kannada:     `You are an energetic Kannada cricket commentator. Give 1-2 sentences of commentary in Kannada for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
  malayalam:   `You are an energetic Malayalam cricket commentator. Give 1-2 sentences of commentary in Malayalam for each ball event. Keep it lively and fan-friendly. Never exceed 40 words.`,
};

// ─── Main class ───────────────────────────────────────────────────────────────

export class HighlightlyCricketSocket {
  private socket: Socket | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private matchState: MatchState | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 8;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  private readonly BASE_URL = process.env.HIGHLIGHTLY_BASE_URL ?? "https://cricket.highlightly.net";
  private readonly API_BASE = (() => {
    const base = process.env.HIGHLIGHTLY_API_BASE_URL?.replace(/\/+$/, "");
    const host = process.env.HIGHLIGHTLY_API_HOST;
    if (host) {
      console.log(`[Highlightly] HIGHLIGHTLY_API_HOST detected; using https://${host} as API_BASE`);
      return `https://${host}`;
    }
    return base ?? this.BASE_URL;
  })();
  private readonly SOCKET_URL = process.env.HIGHLIGHTLY_SOCKET_URL ?? this.API_BASE;
  private readonly SOCKET_PATH = process.env.HIGHLIGHTLY_SOCKET_PATH ?? "/v5/websocket";

  private anthropic: Anthropic;
  private config: HighlightlyConfig;

  constructor(config: HighlightlyConfig) {
    if (!config.projectKey || !config.apiKey || !config.matchKey) {
      throw new Error("Highlightly projectKey, apiKey, and matchKey are required.");
    }
    this.config = { persona: "casual_hype", ...config };
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.refreshToken();
    this.createSocket();
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.unsubscribeMatch();
      this.socket.disconnect();
      this.socket = null;
    }
    console.log("[Highlightly] Connection destroyed.");
  }

  setPersona(persona: PersonaMode): void {
    this.config.persona = persona;
    console.log(`[Highlightly] Persona switched to: ${persona}`);
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  private async refreshToken(): Promise<void> {
    console.log("[Highlightly] Refreshing access token...");
    const url = `${this.API_BASE}/core/${this.config.projectKey}/auth/`;
    console.log(`[Highlightly] Auth URL: ${url}`);
    console.log(`[Highlightly] API Key: ${this.config.apiKey.substring(0, 10)}...`);

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await axios.post(url, { api_key: this.config.apiKey }, {
          headers: this.makeApiHeaders(),
        });
        console.log(`[Highlightly] Auth response status: ${res.status}`);
        this.accessToken = res.data?.data?.token;
        if (!this.accessToken) {
          console.error("[Highlightly] No token in response:", res.data);
          throw new Error("No access token received");
        }
        this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
        console.log("[Highlightly] Token refreshed. Valid for 23 hours.");
        this.scheduleTokenRefresh();
        return; // Success, exit
      } catch (error: any) {
        console.error(`[Highlightly] Token refresh attempt ${attempt + 1} failed:`, error.message);
        if (error.response) {
          console.error("[Highlightly] Response status:", error.response.status);
          console.error("[Highlightly] Response data:", error.response.data);
          if ((error.response.status === 429 || error.response.status === 403 || error.response.status === 404) && attempt < maxRetries - 1) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
            console.log(`[Highlightly] API error. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        if (attempt === maxRetries - 1) {
          // Final attempt failed, use API key as token
          console.log("[Highlightly] Using API key as token fallback");
          this.accessToken = this.config.apiKey;
          this.tokenExpiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
          this.scheduleTokenRefresh();
          return;
        }
      }
    }
  }

  private makeApiHeaders(includeToken = false): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const useRapidApiHeaders =
      this.API_BASE.includes("rapidapi.com") ||
      process.env.HIGHLIGHTLY_API_HOST?.includes("rapidapi.com");

    if (useRapidApiHeaders) {
      headers["x-rapidapi-key"] = this.config.apiKey;
      if (process.env.HIGHLIGHTLY_API_HOST) {
        headers["x-rapidapi-host"] = process.env.HIGHLIGHTLY_API_HOST;
      }
    } else {
      headers["rs-token"] = this.config.apiKey;
    }

    if (includeToken && this.accessToken) {
      headers["rs-token"] = this.accessToken;
    }

    return headers;
  }

  private scheduleTokenRefresh(): void {
    const msUntilRefresh = this.tokenExpiresAt - Date.now();
    setTimeout(async () => {
      if (!this.isDestroyed) {
        await this.refreshToken();
        if (this.socket?.connected) this.emitSubscribe();
      }
    }, msUntilRefresh);
  }

  // ─── Socket lifecycle ────────────────────────────────────────────────────────

  private createSocket(): void {
    console.log(`[Highlightly] Creating socket connection`);
    console.log(`[Highlightly] SOCKET_URL=${this.SOCKET_URL}`);
    console.log(`[Highlightly] SOCKET_PATH=${this.SOCKET_PATH}`);
    console.log(`[Highlightly] Project=${this.config.projectKey} Match=${this.config.matchKey} TokenLoaded=${Boolean(this.accessToken)}`);

    this.socket = io(this.SOCKET_URL, {
      path: this.SOCKET_PATH,
      reconnection: false,
      transports: ["websocket"],
      timeout: 10_000,
    });

    this.socket.on("connect",         () => this.onConnect());
    this.socket.on("on_match_joined", (d) => this.onMatchJoined(d));
    this.socket.on("on_match_update", (d) => this.onMatchUpdate(d));
    this.socket.on("on_error",        (d) => this.onSocketError(d));
    this.socket.on("disconnect",      (r) => this.onDisconnect(r));
    this.socket.on("connect_error",   (e) => this.onConnectError(e));
  }

  private onConnect(): void {
    console.log(`[Highlightly] Socket connected (id=${this.socket?.id ?? "unknown"}). Joining match ${this.config.matchKey}...`);
    this.reconnectAttempts = 0;
    this.emitSubscribe();
  }

  private emitSubscribe(): void {
    const tokenPreview = this.accessToken ? `${String(this.accessToken).slice(0, 12)}...` : "<none>";
    console.log(`[Highlightly] Emitting connect_to_match token=${tokenPreview} match_key=${this.config.matchKey}`);
    this.socket?.emit("connect_to_match", {
      token: this.accessToken,
      match_key: this.config.matchKey,
    });
  }

  private onMatchJoined(data: any): void {
    const key = data?.key ?? this.config.matchKey;
    console.log(`[Highlightly] Match joined: ${key}`);
  }

  private onDisconnect(reason: string): void {
    console.warn(`[Highlightly] Disconnected: ${reason}`);
    if (!this.isDestroyed) this.scheduleReconnect();
  }

  private onConnectError(err: Error): void {
    console.error(`[Highlightly] Connection error: ${err.message}`);
    if (!this.isDestroyed) this.scheduleReconnect();
  }

  private onSocketError(data: any): void {
    const parsed = this.safeParse(data);
    const msg = parsed?.message ?? "Unknown socket error";
    console.error(`[Highlightly] Server error: ${msg}`);
    this.config.onError?.(new Error(msg));
  }

  // ─── Reconnection with exponential backoff ───────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      const err = new Error(`[Highlightly] Max reconnect attempts (${this.MAX_RECONNECT}) reached.`);
      console.error(err.message);
      this.config.onError?.(err);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000);
    this.reconnectAttempts++;
    console.log(`[Highlightly] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(async () => {
      if (this.isDestroyed) return;
      if (Date.now() > this.tokenExpiresAt - 60_000) await this.refreshToken();
      this.socket?.disconnect();
      this.socket = null;
      this.createSocket();
    }, delay);
  }

  // ─── Match subscription REST calls ──────────────────────────────────────────

  async subscribeMatch(): Promise<void> {
    const url = `${this.API_BASE}/cricket/${this.config.projectKey}/match/${this.config.matchKey}/subscribe/`;
    await axios.post(url, { method: "web_socket" }, {
      headers: this.makeApiHeaders(true),
    });
    console.log(`[Highlightly] Match ${this.config.matchKey} subscribed via REST.`);
  }

  async unsubscribeMatch(): Promise<void> {
    try {
      const url = `${this.API_BASE}/cricket/${this.config.projectKey}/match/${this.config.matchKey}/unsubscribe/`;
      await axios.post(url, { method: "web_socket" }, {
        headers: this.makeApiHeaders(true),
      });
      console.log(`[Highlightly] Match ${this.config.matchKey} unsubscribed.`);
    } catch {
      // Best-effort on teardown
    }
  }

  // ─── Event parsing ───────────────────────────────────────────────────────────

  private onMatchUpdate(rawData: any): void {
    if (!rawData) {
      console.warn("[Highlightly] Received on_match_update with empty payload");
      return;
    }
    const preview = typeof rawData === "string"
      ? rawData.slice(0, 250)
      : rawData && typeof rawData === "object"
        ? JSON.stringify(Object.keys(rawData)).slice(0, 200)
        : String(rawData).slice(0, 250);
    console.log(`[Highlightly] Received on_match_update payload: ${preview}`);

    const data = this.safeParse(rawData);
    if (!data) {
      console.error("[Highlightly] Failed to parse on_match_update payload", rawData);
      return;
    }

    this.matchState = this.extractMatchState(data);

    const eventType = this.classifyEvent(data);
    console.log(`[Highlightly] Parsed event ${eventType} | Score: ${this.matchState.score}/${this.matchState.wickets} (${this.matchState.overs})`);

    if (this.shouldCommentOn(eventType)) {
      this.streamCommentary(eventType, this.matchState).catch(console.error);
    }
  }

  // ─── extractMatchState (updated) ─────────────────────────────────────────────
// Parses the full Highlightly on_match_update payload into the MatchState shape
  // the frontend consumes. All new fields use safe optional chaining so the
  // app degrades gracefully if Highlightly doesn't include a section.

  private extractMatchState(data: any): MatchState {
    const innings  = data?.score?.innings?.[0] ?? {};
    const lastBall = data?.score?.recent_ball  ?? {};

    // ── Chase / target fields (second innings only) ──────────────────────────
    const target       = data?.score?.target?.runs ?? innings?.target ?? undefined;
    const requiredRate = innings?.required_run_rate
      ? String(parseFloat(innings.required_run_rate).toFixed(2))
      : undefined;

    // ── Partnership ──────────────────────────────────────────────────────────
    // Highlightly v5: data.score.partnership = { runs, balls }
    const pship = data?.score?.partnership;
    const partnership = pship
      ? `${pship.runs ?? 0}(${pship.balls ?? 0})`
      : undefined;

    // ── Last wicket ──────────────────────────────────────────────────────────
    // Highlightly v5: data.score.last_wicket = { player: { name }, runs, balls }
    const lw = data?.score?.last_wicket;
    const lastWicket = lw
      ? `${lw.player?.name ?? "?"} ${lw.runs ?? 0}(${lw.balls ?? 0})`
      : undefined;

    // ── Last 5 overs ─────────────────────────────────────────────────────────
    // Highlightly v5: innings.last_five_overs = "44" (runs as string/number)
    const last5 = innings?.last_five_overs ?? innings?.last5overs ?? undefined;
    const last5Overs = last5 !== undefined ? String(last5) : undefined;

    // ── Batters ──────────────────────────────────────────────────────────────
    // Highlightly v5: data.score.batting = [ { player: {name}, runs, balls, fours, sixes, is_striker }, ... ]
    // Only current batters (max 2) are present in a live update.
    const rawBatting: any[] = data?.score?.batting ?? [];
    const batters: Batter[] = rawBatting
      .filter((b: any) => b?.player?.name)
      .map((b: any) => ({
        name:      b.player.name,
        runs:      Number(b.runs  ?? b.score ?? 0),
        balls:     Number(b.balls ?? 0),
        fours:     Number(b.fours ?? 0),
        sixes:     Number(b.sixes ?? 0),
        on_strike: Boolean(b.is_striker ?? b.on_strike ?? false),
      }));

    // ── Bowlers ──────────────────────────────────────────────────────────────
    // Highlightly v5: data.score.bowling = [ { player: {name}, overs, runs, wickets, economy, is_current_bowler }, ... ]
    // All bowlers who have sent at least one delivery appear here.
    const rawBowling: any[] = data?.score?.bowling ?? [];
    const bowlers: Bowler[] = rawBowling
      .filter((b: any) => b?.player?.name)
      .map((b: any) => {
        const overs   = b.overs ?? b.over ?? "0.0";
        const runs    = Number(b.runs ?? b.runs_given ?? 0);
        const wickets = Number(b.wickets ?? 0);
        // Economy: use provided value or compute from overs + runs
        const computedEco = parseFloat(overs) > 0
          ? (runs / parseFloat(overs)).toFixed(2)
          : "0.00";
        return {
          name:    b.player.name,
          overs:   String(overs),
          runs,
          wickets,
          economy: b.economy ? String(parseFloat(b.economy).toFixed(2)) : computedEco,
          current: Boolean(b.is_current_bowler ?? b.current ?? false),
        };
      });

    // ── last_ball ────────────────────────────────────────────────────────────
    const lastBallParsed = lastBall?.ball_number ? {
      ball_number: lastBall.ball_number,
      batsman:     lastBall.batsman?.name ?? "Batter",
      bowler:      lastBall.bowler?.name  ?? "Bowler",
      runs:        lastBall.runs    ?? 0,
      extras:      lastBall.extras  ?? 0,
      wicket:      lastBall.wicket  ?? false,
      wicket_type: lastBall.wicket_type ?? "",
      commentary:  lastBall.commentary  ?? "",
      over:        Math.floor(lastBall.ball_number),
      ball:        Math.round((lastBall.ball_number % 1) * 10),
    } : undefined;

    return {
      score:         innings?.score      ?? "0",
      wickets:       innings?.wickets    ?? 0,
      overs:         innings?.overs      ?? "0.0",
      run_rate:      innings?.run_rate   ?? "0.00",
      batting_team:  data?.score?.batting_team?.name ?? "Team A",
      bowling_team:  data?.score?.bowling_team?.name ?? "Team B",
      last_ball:     lastBallParsed,
      target,
      required_rate: requiredRate,
      partnership,
      last_wicket:   lastWicket,
      last_5_overs:  last5Overs,
      batters:       batters.length  > 0 ? batters  : undefined,
      bowlers:       bowlers.length  > 0 ? bowlers  : undefined,
    };
  }

  private classifyEvent(data: any): string {
    const ball = data?.score?.recent_ball;
    if (!ball) return "score_update";
    if (ball.wicket)       return "wicket";
    if (ball.runs === 6)   return "six";
    if (ball.runs === 4)   return "four";
    if (ball.ball_number && String(ball.ball_number).endsWith(".6")) return "over_complete";
    return "dot_or_single";
  }

  private shouldCommentOn(eventType: string): boolean {
    return ["wicket", "six", "four", "over_complete"].includes(eventType);
  }

  // ─── Claude streaming commentary ─────────────────────────────────────────────

  private async streamCommentary(eventType: string, state: MatchState): Promise<void> {
    const ball = state.last_ball;
    const userPrompt = this.buildCommentaryPrompt(eventType, state, ball);

    const activePersonas = this.config.getActivePersonas?.() ?? [this.config.persona ?? "casual_hype"];
    const uniquePersonas = [...new Set(activePersonas)];

    console.log(`[Claude] Generating commentary for personas: ${uniquePersonas.join(", ")}`);

    await Promise.all(uniquePersonas.map(async (persona) => {
      const systemPrompt = PERSONA_PROMPTS[persona];

      this.config.onCommentary?.("", eventType, persona);

      let fullText = "";

      try {
        const stream = this.anthropic.messages.stream({
          model:      "claude-sonnet-4-6",
          max_tokens: 80,
          system:     systemPrompt,
          messages:   [{ role: "user", content: userPrompt }],
        });

        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            const token = chunk.delta.text;
            fullText += token;
            this.config.onCommentary?.(token, eventType, persona);
          }
        }

        console.log(`[Claude] [${persona}] [${eventType}] ${fullText}`);
      } catch (err) {
        console.error(`[Claude] Error generating ${persona} commentary:`, err);
      }
    }));
  }

  private buildCommentaryPrompt(
    eventType: string,
    state: MatchState,
    ball?: BallEvent
  ): string {
    const ballDesc = ball
      ? `Ball ${ball.over}.${ball.ball}: ${ball.bowler} to ${ball.batsman} — ${
          ball.wicket
            ? `WICKET (${ball.wicket_type})`
            : ball.runs === 6
            ? "SIX!"
            : ball.runs === 4
            ? "FOUR!"
            : `${ball.runs} run(s)`
        }`
      : "Update received";

    return `Match: ${state.batting_team} vs ${state.bowling_team}
Score: ${state.score}/${state.wickets} in ${state.overs} overs (RR: ${state.run_rate})
Event: ${eventType.toUpperCase()}
${ballDesc}
${ball?.commentary ? `Raw commentary: "${ball.commentary}"` : ""}

Generate commentary now.`;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  private safeParse(data: any): any {
    if (typeof data === "string") {
      try { return JSON.parse(data); } catch { return null; }
    }
    return data ?? null;
  }

  getMatchState(): MatchState | null {
    return this.matchState;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
