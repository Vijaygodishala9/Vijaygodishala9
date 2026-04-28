import { RoanuzCricketSocket, PersonaMode } from "./RoanuzCricketSocket";
import { MockCricketSocket } from "./MockCricketSocket";
import { CommentaryBroadcaster } from "./CommentaryBroadcaster";
import { PushService } from "./PushService";

type AnySocket = RoanuzCricketSocket | MockCricketSocket;

export class MatchRegistry {
  private sockets: Map<string, AnySocket> = new Map();
  private broadcaster: CommentaryBroadcaster;
  private push: PushService;

  constructor(broadcaster: CommentaryBroadcaster, push: PushService) {
    this.broadcaster = broadcaster;
    this.push = push;
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

    await socket.subscribeMatch().catch(() => {});
    await socket.connect();
    this.sockets.set(matchKey, socket);
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
}
