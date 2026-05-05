import { HighlightlyCricketSocket, PersonaMode } from "./HighlightlyCricketSocket";
import { MockCricketSocket } from "./MockCricketSocket";
import { CommentaryBroadcaster } from "./CommentaryBroadcaster";
import { PushService } from "./PushService";

type AnySocket = HighlightlyCricketSocket | MockCricketSocket;

export class MatchRegistry {
  private sockets: Map<string, AnySocket> = new Map();
  private broadcaster: CommentaryBroadcaster;
  private push: PushService;

  constructor(broadcaster: CommentaryBroadcaster, push: PushService) {
    this.broadcaster = broadcaster;
    this.push = push;
  }

  async ensureConnected(matchKey: string): Promise<void> {
    if (this.sockets.has(matchKey)) {
      console.log(`[Registry] Socket already active for match: ${matchKey}`);
      return;
    }
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

    const socket: AnySocket = matchKey === "mock"
      ? new MockCricketSocket({
          matchKey,
          getActivePersonas,
          onCommentary,
          onFantasy,
          onNotableEvent,
          onError,
        })
      : new HighlightlyCricketSocket({
          projectKey: process.env.HIGHLIGHTLY_PROJECT_KEY!,
          apiKey:     process.env.HIGHLIGHTLY_API_KEY!,
          matchKey,
          persona:    "casual_hype", // Default, will be overridden by getActivePersonas
          getActivePersonas,
          onCommentary,
          onFantasy,
          onNotableEvent,
          onError,
        });

    await socket.connect();
    await socket.subscribeMatch().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      console.warn(`[Registry] Subscribe REST failed for ${matchKey} (non-fatal, socket still active):`, message);
    });

    this.sockets.set(matchKey, socket);
    console.log(`[Registry] Socket registered for match: ${matchKey}`);
  }

  teardownIfEmpty(matchKey: string): void {
    if (this.broadcaster.clientCount(matchKey) === 0) {
      const socket = this.sockets.get(matchKey);
      if (socket) {
        socket.destroy();
        this.sockets.delete(matchKey);
        console.log(`[Registry] Tore down socket for ${matchKey} (no clients left)`);
      }
    }
  }

  getSocket(matchKey: string): AnySocket | undefined {
    return this.sockets.get(matchKey);
  }

  activeSockets(): string[] {
    return [...this.sockets.keys()];
  }

  socketStatus(): Array<{ matchKey: string; connected: boolean; hasState: boolean; hasClients: boolean }> {
    return [...this.sockets.entries()].map(([matchKey, socket]) => {
      const hasState = typeof (socket as any).getMatchState === "function" && Boolean((socket as any).getMatchState());
      const connected = typeof (socket as any).isConnected === "function" && (socket as any).isConnected();
      return {
        matchKey,
        connected,
        hasState,
        hasClients: this.broadcaster.clientCount(matchKey) > 0,
      };
    });
  }
}
