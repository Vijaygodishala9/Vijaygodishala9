/**
 * App.tsx — CricketDesk unified app
 * Scoreboard + dual persona commentary feeds + push notifications
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Persona = "casual_hype" | "stats_nerd";

interface Batter {
  name:       string;
  runs:       number;
  balls:      number;
  fours:      number;
  sixes:      number;
  on_strike?: boolean;
}

interface Bowler {
  name:     string;
  overs:    string;
  runs:     number;
  wickets:  number;
  economy:  number;
  current?: boolean;
}

interface MatchState {
  matchKey:   string;
  homeTeam:   { name: string; abbreviation: string };
  awayTeam:   { name: string; abbreviation: string };
  score: {
    home: { runs: number; wickets: number; overs: string };
    away: { runs: number; wickets: number; overs: string };
  };
  runRate:    string;
  status:     string;
  batters?:   Batter[];
  bowlers?:   Bowler[];
  /** Upcoming batters for the batting team (not yet at crease) */
  yetToBat?:  Array<{ name: string; role: string }>;
  /** Batting lineup for the team not yet batting */
  awaySquad?: Array<{ name: string; role: string }>;
}

interface CommentaryLine {
  id:        number;
  text:      string;
  eventType: string;
  runs?:     number;
  balls?:    number;
  complete:  boolean;
  persona:   Persona;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MATCH_KEY = (import.meta as any).env?.VITE_MATCH_KEY ?? "indpak_2024_t20_01";
const SERVER    = (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3001";

const PERSONAS: { id: Persona; label: string; desc: string; accent: string }[] = [
  { id: "casual_hype", label: "Casual Hype", desc: "English · hype",  accent: "#E2694A" },
  { id: "stats_nerd",  label: "Stats Nerd",  desc: "English · data",  accent: "#4A8FE2" },
];

const EVENT_CFG: Record<string, { label: string; bg: string; color: string; glow: string }> = {
  wicket:        { label: "OUT",     bg: "#2A1515", color: "#E24B4A", glow: "rgba(226,75,74,.2)"   },
  six:           { label: "6",       bg: "#211A0E", color: "#F0B942", glow: "rgba(240,185,66,.2)"  },
  boundary:      { label: "4",       bg: "#0F1E18", color: "#4ECCA3", glow: "rgba(78,204,163,.2)"  },
  runs:          { label: "RUN",     bg: "#111B22", color: "#5BADEE", glow: "rgba(91,173,238,.15)" },
  dot_ball:      { label: "•",       bg: "#141418", color: "#3A4050", glow: "transparent"          },
  over_complete: { label: "OVER",    bg: "#161230", color: "#9B93F5", glow: "rgba(155,147,245,.2)" },
  fantasy:       { label: "FANTASY", bg: "#0E1820", color: "#5BADEE", glow: "rgba(91,173,238,.2)"  },
  dot_or_single: { label: "BALL",    bg: "#161B24", color: "#5A6478", glow: "transparent"          },
};

// ─── AnimatedNumber ───────────────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: string | number }) {
  const [display, setDisplay] = useState(value);
  const [flash,   setFlash]   = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(true);
      setTimeout(() => { setDisplay(value); setFlash(false); }, 110);
      prev.current = value;
    }
  }, [value]);
  return (
    <span style={{
      display: "inline-block",
      transition: "transform .12s, opacity .12s",
      transform: flash ? "translateY(-5px)" : "none",
      opacity:   flash ? 0 : 1,
    }}>{display}</span>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    icon:  "🏏",
    title: "Follow cricket without a stream",
    body:  "CricketDesk gives you AI commentary, key-moment alerts, and fantasy advice — live, in your language.",
  },
  {
    icon:    "🎙️",
    title:   "Two commentary voices, side by side",
    body:    "Watch Casual Hype and Stats Nerd react to the same moment — simultaneously.",
    example: { label: "SIX", text: "What a shot! That's gone miles over mid-wicket!", persona: "Casual · Hype" },
  },
  {
    icon:  "🔔",
    title: "Get alerts when you're away",
    body:  "Turn on Away Mode and we'll push a notification the moment a wicket falls or a six flies — even with the tab closed.",
  },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s      = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      background: "rgba(8,11,16,.88)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#0E1117", borderRadius: 16, padding: "28px 24px",
        maxWidth: 360, width: "100%", border: "1px solid rgba(255,255,255,.1)",
        boxShadow: "0 24px 64px rgba(0,0,0,.6)",
      }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 22 }}>
          {ONBOARDING_STEPS.map((_, i) => (
            <span key={i} style={{
              height: 3, flex: 1, borderRadius: 2,
              background: i <= step ? "#4ECCA3" : "rgba(255,255,255,.1)",
              transition: "background .3s",
            }}/>
          ))}
        </div>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{s.icon}</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#F0F4FF", marginBottom: 8 }}>{s.title}</h2>
        <p style={{ fontSize: 13, color: "#8892A4", lineHeight: 1.65, marginBottom: s.example ? 16 : 24 }}>{s.body}</p>
        {s.example && (
          <div style={{
            background: "#161B28", borderRadius: 10, padding: "11px 14px",
            marginBottom: 24, borderLeft: "3px solid #4ECCA3",
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "#211A0E", color: "#F0B942", flexShrink: 0, marginTop: 2 }}>SIX</span>
              <div>
                <p style={{ fontSize: 12, color: "#F0F4FF", lineHeight: 1.55, margin: 0 }}>{s.example.text}</p>
                <p style={{ fontSize: 10, color: "#4ECCA3", marginTop: 4 }}>{s.example.persona}</p>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              flex: 1, padding: "10px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,.1)",
              background: "transparent", color: "#8892A4", fontSize: 13, cursor: "pointer",
            }}>Back</button>
          )}
          <button onClick={() => isLast ? onDone() : setStep(s => s + 1)} style={{
            flex: 2, padding: "10px 0", borderRadius: 9, border: "none",
            background: "#4ECCA3", color: "#080B10", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            {isLast ? "Let's go 🏏" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ScorecardTab ─────────────────────────────────────────────────────────────

function ScorecardTab({ matchState }: { matchState: MatchState | null }) {
  // Determine batting team: whichever side has overs > "0"
  const battingTeam = matchState
    ? (matchState.score.home.overs !== "0" ? matchState.homeTeam.name : matchState.awayTeam.name)
    : "—";
  const bowlingTeam = matchState
    ? (matchState.score.home.overs !== "0" ? matchState.awayTeam.name : matchState.homeTeam.name)
    : "—";

  const renderBatting = () => {
    const batters = matchState?.batters ?? [];
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
          Batting · {battingTeam}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 36px 36px 24px 24px 48px", gap: 4, marginBottom: 6 }}>
          {["Batter","R","B","4s","6s","SR"].map(h => (
            <div key={h} style={{
              fontSize: 10, color: "#3A4050", textTransform: "uppercase",
              letterSpacing: ".06em", textAlign: h === "Batter" ? "left" : "right",
            }}>{h}</div>
          ))}
        </div>
        {batters.length === 0 ? (
          <div style={{ padding: "14px 0", textAlign: "center", fontSize: 12, color: "#3A4050" }}>
            Waiting for batting data…
          </div>
        ) : batters.map(b => {
          const sr    = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
          const srNum = parseFloat(sr);
          return (
            <div key={b.name} style={{
              display: "grid", gridTemplateColumns: "1fr 36px 36px 24px 24px 48px",
              gap: 4, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.05)",
            }}>
              <div style={{
                fontSize: 13, color: b.on_strike ? "#F0F4FF" : "#8892A4",
                fontWeight: b.on_strike ? 600 : 400,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {b.on_strike && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ECCA3", flexShrink: 0, animation: "dotBlink 1.4s ease infinite", display: "inline-block" }}/>}
                {b.name}
              </div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#F0F4FF", fontWeight: 600 }}><AnimatedNumber value={b.runs} /></div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}><AnimatedNumber value={b.balls} /></div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>{b.fours}</div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>{b.sixes}</div>
              <div style={{
                textAlign: "right", fontSize: 12, fontFamily: "'DM Mono',monospace",
                color: srNum >= 150 ? "#4ECCA3" : srNum >= 100 ? "#F0B942" : "#5A6478",
              }}>{sr}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBowling = () => {
    const bowlers = matchState?.bowlers ?? [];
    return (
      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
          Bowling · {bowlingTeam}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 32px 26px 48px", gap: 4, marginBottom: 6 }}>
          {["Bowler","O","R","W","Eco"].map(h => (
            <div key={h} style={{
              fontSize: 10, color: "#3A4050", textTransform: "uppercase",
              letterSpacing: ".06em", textAlign: h === "Bowler" ? "left" : "right",
            }}>{h}</div>
          ))}
        </div>
        {bowlers.length === 0 ? (
          <div style={{ padding: "14px 0", textAlign: "center", fontSize: 12, color: "#3A4050" }}>
            Waiting for bowling data…
          </div>
        ) : bowlers.map(b => {
          const eco = b.economy;
          return (
            <div key={b.name} style={{
              display: "grid", gridTemplateColumns: "1fr 40px 32px 26px 48px",
              gap: 4, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.05)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {b.current && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#9B93F5", flexShrink: 0, animation: "dotBlink 1.4s ease infinite", display: "inline-block" }}/>}
                <span style={{ fontSize: 13, color: b.wickets > 0 ? "#F0F4FF" : "#8892A4", fontWeight: b.wickets > 0 ? 600 : 400 }}>{b.name}</span>
              </div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}><AnimatedNumber value={b.overs} /></div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}><AnimatedNumber value={b.runs} /></div>
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: b.wickets > 0 ? "#E24B4A" : "#5A6478", fontWeight: 600 }}>{b.wickets}</div>
              <div style={{ textAlign: "right", fontSize: 12, fontFamily: "'DM Mono',monospace", color: eco <= 7 ? "#4ECCA3" : eco <= 10 ? "#F0B942" : "#E24B4A" }}>{b.economy}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderYetToBat = () => {
    const upcoming = matchState?.yetToBat ?? [];
    if (upcoming.length === 0) return null;
    return (
      <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 8 }}>
          Yet to bat
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
          {upcoming.map(p => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#8892A4" }}>{p.name}</span>
              {p.role && <span style={{ fontSize: 9, color: "#3A4050", textTransform: "uppercase", letterSpacing: ".05em" }}>{p.role}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAwaySquad = () => {
    const squad = matchState?.awaySquad ?? [];
    if (squad.length === 0) return null;
    return (
      <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
          {matchState?.awayTeam?.name ?? "Away"} · Batting order
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          {squad.map((p, i) => (
            <div key={p.name} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "5px 0", borderTop: i > 0 ? "1px solid rgba(255,255,255,.04)" : "none",
            }}>
              <span style={{ fontSize: 11, color: "#3A4050", fontFamily: "'DM Mono',monospace", minWidth: 16, textAlign: "right" }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: "#8892A4" }}>{p.name}</span>
              {p.role && <span style={{ fontSize: 9, color: "#3A4050", textTransform: "uppercase", letterSpacing: ".05em", marginLeft: "auto" }}>{p.role}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: "#0E1117", border: "1px solid rgba(255,255,255,.07)", borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
      {renderBatting()}
      {renderYetToBat()}
      {renderBowling()}
      {renderAwaySquad()}
    </div>
  );
}

// ─── usePersonaFeed ───────────────────────────────────────────────────────────

interface FeedState {
  lines:        CommentaryLine[];
  connected:    boolean;
  error:        string | null;
  pulsing:      number | null;
  copiedId:     number | null;
  setCopiedId:  (id: number | null) => void;
  feedRef:      React.RefObject<HTMLDivElement>;
}

function usePersonaFeed(
  persona: Persona,
  onMatchState: React.MutableRefObject<(s: any) => void>,
): FeedState {
  const [lines,     setLines]     = useState<CommentaryLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [pulsing,   setPulsing]   = useState<number | null>(null);
  const [copiedId,  setCopiedId]  = useState<number | null>(null);

  const feedRef    = useRef<HTMLDivElement>(null);
  const lineId     = useRef(0);
  const currentId  = useRef<number | null>(null);
  const linesRef   = useRef<CommentaryLine[]>([]);

  useEffect(() => {
    const url = `${SERVER}/stream/${MATCH_KEY}?persona=${persona}`;
    const es  = new EventSource(url);

    es.addEventListener("connected", () => { setConnected(true); setError(null); });

    es.addEventListener("state", (e) => {
      onMatchState.current(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("token", (e) => {
      const { token, eventType, runs, balls } = JSON.parse((e as MessageEvent).data);

      if (token === "") {
        const id = ++lineId.current;
        currentId.current = id;
        const newLine: CommentaryLine = { id, text: "", eventType, runs, balls, complete: false, persona };
        linesRef.current = [...linesRef.current.slice(-39), newLine];
        setLines([...linesRef.current]);
        setPulsing(id);
        setTimeout(() => setPulsing(null), 900);
        setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 80);
        return;
      }

      const activeId = currentId.current;
      if (activeId === null) return;
      const idx = linesRef.current.findIndex(l => l.id === activeId);
      if (idx === -1) return;
      const line = linesRef.current[idx];
      if (line.complete) return;

      const newText = line.text + token;
      const done    = /[.!?।]\s*$/.test(newText.trim());
      const updated = { ...line, text: newText, complete: done };
      linesRef.current = [...linesRef.current.slice(0, idx), updated, ...linesRef.current.slice(idx + 1)];
      setLines([...linesRef.current]);

      if (done) {
        currentId.current = null;
        setTimeout(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }), 50);
      }
    });

    es.addEventListener("error", (e) => {
      const msg = e instanceof MessageEvent ? JSON.parse(e.data).message : "Connection error";
      setError(msg);
    });

    es.onerror = () => { setConnected(false); };

    return () => { es.close(); };
  }, [persona]);

  return { lines, connected, error, pulsing, copiedId, setCopiedId, feedRef };
}

// ─── PersonaFeedPanel ─────────────────────────────────────────────────────────

function PersonaFeedPanel({ persona, lines, connected, error, pulsing, copiedId, setCopiedId, feedRef }: FeedState & { persona: Persona }) {
  const p = PERSONAS.find(x => x.id === persona)!;

  const shareCommentary = useCallback((line: CommentaryLine) => {
    const text = `${line.text}\n\n— ${p.label} commentary via CricketDesk`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(line.id);
      setTimeout(() => setCopiedId(null), 1800);
    }).catch(() => {});
  }, [p.label, setCopiedId]);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Panel header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 14px",
        background: `${p.accent}14`,
        border: `1px solid ${p.accent}35`,
        borderBottom: "none",
        borderRadius: "10px 10px 0 0",
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: p.accent }}>{p.label}</span>
          <span style={{ fontSize: 10, color: "#5A6478", marginLeft: 6 }}>{p.desc}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: connected ? "#4ECCA3" : error ? "#E24B4A" : "#5A6478",
            display: "inline-block",
            animation: connected ? "dotBlink 1.4s ease infinite" : "none",
          }}/>
          <span style={{ fontSize: 10, color: connected ? "#4ECCA3" : "#5A6478" }}>
            {connected ? "Live" : error ? "Err" : "—"}
          </span>
        </div>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        style={{
          height: 360, overflowY: "auto",
          background: "#0E1117",
          border: "1px solid rgba(255,255,255,.07)",
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
        }}
      >
        {lines.length === 0 ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#3A4050" }}>
            <div style={{ fontSize: 28 }}>🏏</div>
            <div style={{ fontSize: 12, textAlign: "center", lineHeight: 1.6 }}>
              Waiting for events…<br/>
              <span style={{ fontSize: 10, color: "#2A3040" }}>Commentary appears here live</span>
            </div>
          </div>
        ) : lines.map((line, i) => {
          const cfg       = EVENT_CFG[line.eventType] ?? EVENT_CFG.dot_or_single;
          const isPulsing = pulsing === line.id;
          const isLatest  = i === lines.length - 1;
          return (
            <div
              key={line.id}
              className={`feed-item ${isLatest ? "slide-in" : ""}`}
              style={{
                display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px",
                background: isLatest ? `linear-gradient(135deg, ${cfg.glow} 0%, transparent 55%)` : "transparent",
                transition: "background 1.5s ease",
              }}
            >
              <span
                className={isPulsing ? "badge-pulse" : ""}
                style={{
                  "--glow": cfg.glow,
                  flexShrink: 0, marginTop: 3,
                  fontSize: 8, fontWeight: 700,
                  fontFamily: "'DM Mono',monospace",
                  letterSpacing: ".08em",
                  padding: "2px 6px", borderRadius: 4,
                  background: cfg.bg, color: cfg.color,
                  display: "inline-block",
                } as React.CSSProperties}
              >
                {line.eventType === "runs" && line.runs != null ? `${line.runs}` : cfg.label}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, lineHeight: 1.65, color: isLatest ? "#F0F4FF" : "#8892A4" }}>
                  {line.text}
                  {!line.complete && isLatest && (
                    <span style={{
                      display: "inline-block", width: 6, height: 12,
                      background: "#4ECCA3", marginLeft: 3,
                      verticalAlign: "middle", borderRadius: 1, opacity: .6,
                      animation: "cursorBlink .8s step-end infinite",
                    }}/>
                  )}
                </span>
                {line.complete && (
                  <div style={{ display: "flex", gap: 4, marginTop: 3, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => shareCommentary(line)}
                      title="Copy commentary"
                      style={{
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 10, color: copiedId === line.id ? "#4ECCA3" : "#3A4050",
                        cursor: "pointer", borderRadius: 4,
                        transition: "color .2s",
                      }}
                    >
                      {copiedId === line.id ? "✓" : "📋"}
                    </button>
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(line.text + "\n\n— via CricketDesk")}`}
                      target="_blank" rel="noopener noreferrer"
                      title="Share on X"
                      style={{
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 10, color: "#3A4050", cursor: "pointer",
                        borderRadius: 4, textDecoration: "none", display: "inline-block",
                      }}
                    >𝕏</a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [matchState,     setMatchState]     = useState<MatchState | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("cdo"));
  const [activeTab,      setActiveTab]      = useState<"feed" | "scorecard">("feed");

  // Stable ref so SSE effects (run once) always call the latest setter
  const setMatchStateRef = useRef(setMatchState);
  setMatchStateRef.current = setMatchState;

  const hype  = usePersonaFeed("casual_hype", setMatchStateRef);
  const stats = usePersonaFeed("stats_nerd",  setMatchStateRef);

  const connected = hype.connected || stats.connected;
  const error     = hype.error ?? stats.error ?? null;

  return (
    <div style={{
      fontFamily:  "'Barlow Condensed', 'DM Sans', system-ui, sans-serif",
      background:  "#080B10",
      minHeight:   "100vh",
      padding:     "16px",
      color:       "#F0F4FF",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080B10; }
        @keyframes slideIn    { from{opacity:0;transform:translateY(12px) scale(.98)} to{opacity:1;transform:none} }
        @keyframes badgePulse { 0%{transform:scale(1);box-shadow:0 0 0 0 var(--glow)} 35%{transform:scale(1.2);box-shadow:0 0 0 7px var(--glow)} 100%{transform:scale(1);box-shadow:0 0 0 0 transparent} }
        @keyframes dotBlink   { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes cursorBlink{ 0%,100%{opacity:.5} 50%{opacity:0} }
        .slide-in   { animation: slideIn .36s cubic-bezier(.22,1,.36,1) both }
        .badge-pulse{ animation: badgePulse .8s cubic-bezier(.22,1,.36,1) both }
        .feed-item:not(:last-child){ border-bottom:1px solid rgba(255,255,255,.05) }
        button { font-family:inherit; cursor:pointer; }
        ::-webkit-scrollbar      { width:3px }
        ::-webkit-scrollbar-thumb{ background:#2A3040; border-radius:2px }
      `}</style>

      {showOnboarding && (
        <Onboarding onDone={() => { localStorage.setItem("cdo", "1"); setShowOnboarding(false); }} />
      )}

      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".04em", color: "#F0F4FF" }}>
              CRICKET<span style={{ color: "#4ECCA3" }}>DESK</span>
            </div>
            <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginTop: 1 }}>
              Follow live · no stream needed
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.05)", borderRadius: 8, padding: "5px 10px" }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: connected ? "#4ECCA3" : error ? "#E24B4A" : "#5A6478",
              display: "inline-block",
              animation: connected ? "dotBlink 1.4s ease infinite" : "none",
            }}/>
            <span style={{ fontSize: 11, color: connected ? "#4ECCA3" : "#5A6478" }}>
              {connected ? "Live" : error ? "Error" : "Connecting"}
            </span>
          </div>
        </div>

        {/* ── Scoreboard ── */}
        {matchState ? (() => {
          const home = matchState.score.home;
          const away = matchState.score.away;
          const homeHasBatted = home.overs !== "0" || home.runs > 0;
          const awayHasBatted = away.overs !== "0" || away.runs > 0;
          return (
            <div style={{ background: "#0E1117", borderRadius: 12, overflow: "hidden", marginBottom: 14, border: "1px solid rgba(255,255,255,.07)" }}>
              {/* Match title */}
              <div style={{ padding: "10px 18px 8px", background: "linear-gradient(135deg,#111620,#161B28)", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>
                  {matchState.homeTeam.name} vs {matchState.awayTeam.name} · IPL T20
                </div>

                {/* Home team row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#F0F4FF", minWidth: 36 }}>
                      {matchState.homeTeam.abbreviation}
                    </span>
                    {homeHasBatted ? (
                      <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", letterSpacing: "-.5px" }}>
                        <AnimatedNumber value={home.runs} />
                        <span style={{ fontSize: 20, color: "#5A6478" }}>/<AnimatedNumber value={home.wickets} /></span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "#3A4050" }}>Yet to bat</span>
                    )}
                    {homeHasBatted && (
                      <span style={{ fontSize: 12, color: "#5A6478", fontFamily: "'DM Mono',monospace" }}>
                        ({home.overs} ov)
                      </span>
                    )}
                  </div>
                  {homeHasBatted && !awayHasBatted && (
                    <span style={{ fontSize: 12, color: "#8892A4", fontFamily: "'DM Mono',monospace" }}>
                      CRR <span style={{ color: "#4ECCA3" }}><AnimatedNumber value={matchState.runRate} /></span>
                    </span>
                  )}
                </div>

                {/* Away team row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#F0F4FF", minWidth: 36 }}>
                      {matchState.awayTeam.abbreviation}
                    </span>
                    {awayHasBatted ? (
                      <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono',monospace", letterSpacing: "-.5px" }}>
                        <AnimatedNumber value={away.runs} />
                        <span style={{ fontSize: 20, color: "#5A6478" }}>/<AnimatedNumber value={away.wickets} /></span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "#3A4050" }}>Yet to bat</span>
                    )}
                    {awayHasBatted && (
                      <span style={{ fontSize: 12, color: "#5A6478", fontFamily: "'DM Mono',monospace" }}>
                        ({away.overs} ov)
                      </span>
                    )}
                  </div>
                  {awayHasBatted && (
                    <span style={{ fontSize: 12, color: "#8892A4", fontFamily: "'DM Mono',monospace" }}>
                      CRR <span style={{ color: "#4ECCA3" }}><AnimatedNumber value={matchState.runRate} /></span>
                    </span>
                  )}
                </div>
              </div>

              {/* Status bar */}
              <div style={{ padding: "8px 18px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: matchState.status.toLowerCase().includes("live") ||
                               matchState.status.toLowerCase().includes("progress")
                    ? "#4ECCA3" : "#F0B942",
                  display: "inline-block",
                }}/>
                <span style={{ fontSize: 11, color: "#8892A4" }}>{matchState.status}</span>
              </div>
            </div>
          );
        })() : (
          <div style={{ background: "#0E1117", borderRadius: 12, padding: "24px", marginBottom: 14, textAlign: "center", border: "1px solid rgba(255,255,255,.07)" }}>
            <div style={{ fontSize: 13, color: "#3A4050" }}>Waiting for match data…</div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: "flex", gap: 0, marginBottom: 0, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          {(["feed", "scorecard"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              background: "none", border: "none", padding: "9px 16px",
              fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase",
              color: activeTab === t ? "#4ECCA3" : "#5A6478",
              borderBottom: activeTab === t ? "2px solid #4ECCA3" : "2px solid transparent",
              transition: "all .15s", marginBottom: "-1px",
            }}>
              {t === "feed" ? "Commentary" : "Scorecard"}
            </button>
          ))}
        </div>

        {/* ── Dual commentary feed ── */}
        {activeTab === "feed" && (
          <div style={{ display: "flex", gap: 12, marginTop: 0 }}>
            <PersonaFeedPanel persona="casual_hype" {...hype} />
            <PersonaFeedPanel persona="stats_nerd"  {...stats} />
          </div>
        )}

        {/* ── Scorecard tab ── */}
        {activeTab === "scorecard" && (
          <ScorecardTab matchState={matchState} />
        )}

        {/* ── Error bar ── */}
        {error && (
          <div style={{ marginTop: 10, padding: "9px 14px", borderRadius: 8, background: "rgba(226,75,74,.12)", color: "#E24B4A", fontSize: 12, border: "1px solid rgba(226,75,74,.2)" }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <span style={{ fontSize: 10, color: "#2A3040", letterSpacing: ".06em", fontFamily: "'DM Mono',monospace" }}>
            CRICKETDESK · FOLLOW LIVE · NO STREAM NEEDED
          </span>
        </div>

      </div>
    </div>
  );
}
