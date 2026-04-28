/**
 * CommentaryBroadcaster.ts
 * Manages a registry of SSE clients per match key.
 * Thread-safe emit to all subscribers of a given match.
 */

import { FastifyReply } from "fastify";

export interface SSEClient {
  id: string;
  matchKey: string;
  persona: string;
  reply: FastifyReply;
  connectedAt: number;
}

export type SSEEventType =
  | "token"        // streaming commentary token
  | "fantasy"      // fantasy advice for notable events
  | "event"        // ball event metadata (wicket, six, etc.)
  | "state"        // full match state snapshot
  | "connected"    // handshake confirmation
  | "error";       // server-side error

export class CommentaryBroadcaster {
  private clients: Map<string, SSEClient> = new Map();

  register(client: SSEClient): void {
    this.clients.set(client.id, client);
    this.send(client.id, "connected", {
      clientId: client.id,
      matchKey: client.matchKey,
      persona: client.persona,
      ts: Date.now(),
    });
    console.log(`[SSE] Client ${client.id} connected (match: ${client.matchKey}, total: ${this.clients.size})`);
  }

  remove(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`[SSE] Client ${clientId} disconnected (total: ${this.clients.size})`);
  }

  /** Send an event to a single client */
  send(clientId: string, event: SSEEventType, data: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.write(client.reply, event, data);
  }

  /** Broadcast an event to all clients subscribed to a match */
  broadcast(matchKey: string, event: SSEEventType, data: unknown): void {
    for (const client of this.clients.values()) {
      if (client.matchKey === matchKey) {
        this.write(client.reply, event, data);
      }
    }
  }

  /** Broadcast only to clients with a specific persona */
  broadcastToPersona(
    matchKey: string,
    persona: string,
    event: SSEEventType,
    data: unknown
  ): void {
    for (const client of this.clients.values()) {
      if (client.matchKey === matchKey && client.persona === persona) {
        this.write(client.reply, event, data);
      }
    }
  }

  clientCount(matchKey: string): number {
    return [...this.clients.values()].filter(c => c.matchKey === matchKey).length;
  }

  allMatchKeys(): string[] {
    return [...new Set([...this.clients.values()].map(c => c.matchKey))];
  }

  activePersonas(matchKey: string): string[] {
    const set = new Set<string>();
    for (const c of this.clients.values()) {
      if (c.matchKey === matchKey) set.add(c.persona);
    }
    return [...set];
  }

  private write(reply: FastifyReply, event: SSEEventType, data: unknown): void {
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      reply.raw.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch {
      // Client likely disconnected — will be cleaned up via close handler
    }
  }
}
