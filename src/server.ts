import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "crypto";
import * as dotenv from "dotenv";
import { CommentaryBroadcaster } from "./CommentaryBroadcaster";
import { MatchRegistry } from "./MatchRegistry";
import { PushService } from "./PushService";
import { PersonaMode } from "./RoanuzCricketSocket";
import { MockMatchSimulator } from "./mockSimulator";

dotenv.config({ override: true });

const VALID_PERSONAS: PersonaMode[] = [
  "casual_hype", "stats_nerd",
  "hindi", "tamil", "telugu", "bengali", "marathi", "kannada", "malayalam",
];
const DEFAULT_PORT = 3001;

async function main() {
  const app = Fastify({ logger: { level: "warn" } });
  const broadcaster = new CommentaryBroadcaster();
  const push = new PushService();
  const fallbackOnly = String(process.env.HIGHLIGHTLY_FALLBACK_ONLY).toLowerCase() === "true";
  const registry = new MatchRegistry(broadcaster, push, fallbackOnly);

  await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? "http://localhost:5174",
    methods: ["GET", "POST"],
  });

  app.get("/health", async () => ({
    status: "ok",
    activeMatches: registry.activeSockets(),
    ts: new Date().toISOString(),
  }));

  app.get("/", async () => ({
    message: "Cricket Commentary SSE Server",
    endpoints: ["/health", "/stream/:matchKey", "/mock-stream/:matchKey", "/match/:matchKey/state", "/push/vapid-public-key", "/push/subscribe"],
  }));

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

    let socketError: Error | null = null;
    try {
      await registry.ensureConnected(matchKey);
    } catch (err: any) {
      socketError = err instanceof Error ? err : new Error(String(err));
    }

    registry.ensurePublicStatePolling(matchKey);
    const initialState = await registry.getMatchState(matchKey);
    if (initialState) {
      broadcaster.send(clientId, "state", initialState);
    } else if (socketError) {
      broadcaster.send(clientId, "error", { message: socketError.message });
    }

    const heartbeat = setInterval(() => {
      try { reply.raw.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      broadcaster.remove(clientId);
      registry.teardownIfEmpty(matchKey);
    });

    await new Promise(() => {});
  });

  // ── Mock SSE stream — no Roanuz needed ──────────────────────────────────────
  app.get<{
    Params: { matchKey: string };
    Querystring: { persona?: string };
  }>("/mock-stream/:matchKey", async (req, reply) => {
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

    const activePersonas = new Set<PersonaMode>([persona]);

    const sim = new MockMatchSimulator(() => [...activePersonas]);

    const send = (event: string, data: unknown) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        sim.stop();
      }
    };

    sim.start(send, 5_000);

    const heartbeat = setInterval(() => {
      try { reply.raw.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      sim.stop();
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
      const state = await registry.getMatchState(req.params.matchKey);
      if (!state) return reply.code(404).send({ error: "No match state available yet" });
      return state;
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
