import { useEffect, useRef, useState, useCallback } from "react";

export type Persona = "casual_hype" | "stats_nerd" | "hindi";

export interface CommentaryLine {
  id: string;
  text: string;
  eventType: string;
  ts: number;
  complete: boolean;
}

export interface FantasyItem {
  id: string;
  advice: string;
  eventType: string;
  batsman: string;
  ts: number;
}

export interface MatchState {
  score: string;
  wickets: number;
  overs: string;
  run_rate: string;
  batting_team: string;
  bowling_team: string;
}

interface UseCommentaryStreamOptions {
  matchKey: string;
  persona: Persona;
  serverUrl?: string;
  maxLines?: number;
}

export function useCommentaryStream({
  matchKey,
  persona,
  serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001",
  maxLines = 50,
}: UseCommentaryStreamOptions) {
  const [lines, setLines] = useState<CommentaryLine[]>([]);
  const [fantasyItems, setFantasyItems] = useState<FantasyItem[]>([]);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const url = `${serverUrl}/stream/${matchKey}?persona=${persona}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener("token", (e) => {
      const { token, eventType } = JSON.parse(e.data);
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.complete) {
          const isComplete = /[.!?]$/.test(token.trim());
          return [...prev.slice(0, -1), { ...last, text: last.text + token, complete: isComplete }];
        }
        const newLine: CommentaryLine = {
          id: crypto.randomUUID(),
          text: token,
          eventType,
          ts: Date.now(),
          complete: false,
        };
        const updated = [...prev, newLine];
        return updated.length > maxLines ? updated.slice(-maxLines) : updated;
      });
    });

    es.addEventListener("fantasy", (e) => {
      const { advice, eventType, batsman } = JSON.parse(e.data);
      setFantasyItems((prev) => {
        const item: FantasyItem = {
          id: crypto.randomUUID(),
          advice,
          eventType,
          batsman,
          ts: Date.now(),
        };
        return [item, ...prev].slice(0, 20);
      });
    });

    es.addEventListener("state", (e) => setMatchState(JSON.parse(e.data)));

    es.addEventListener("error", (e) => {
      const msg = e instanceof MessageEvent ? JSON.parse(e.data).message : "Connection error";
      setError(msg);
      setConnected(false);
    });

    es.onerror = () => setConnected(false);
  }, [matchKey, persona, serverUrl, maxLines]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  const clearLines = useCallback(() => setLines([]), []);
  const clearFantasy = useCallback(() => setFantasyItems([]), []);

  return { lines, fantasyItems, matchState, connected, error, clearLines, clearFantasy };
}
