/**
 * App.tsx — CricketDesk unified app
 * Scoreboard + animated commentary feed + TTS + persona switcher
 * Connects to Fastify SSE server at localhost:3001
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Persona = "casual_hype" | "stats_nerd";

/** A batter currently at the crease, sent in the SSE `state` event */
interface Batter {
  name:    string;
  runs:    number;
  balls:   number;
  fours:   number;
  sixes:   number;
  on_strike?: boolean;  // true = currently facing
}

/** A bowler who has bowled at least one ball, sent in the SSE `state` event */
interface Bowler {
  name:      string;
  overs:     string;   // e.g. "3.4"
  runs:      number;
  wickets:   number;
  economy:   string;   // e.g. "8.25"
  current?:  boolean;  // true = bowling this over
}

interface MatchState {
  score:         string;
  wickets:       number;
  overs:         string;
  run_rate:      string;
  batting_team:  string;
  bowling_team:  string;
  target?:       number;
  required_rate?: string;
  partnership?:  string;
  last_wicket?:  string;
  last_5_overs?: string;
  // ── NEW: live player data ──────────────────────────
  batters?:  Batter[];
  bowlers?:  Bowler[];
}

interface CommentaryLine {
  id:        number;
  text:      string;
  eventType: string;
  complete:  boolean;
  persona:   Persona;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MATCH_KEY = (import.meta as any).env?.VITE_MATCH_KEY ?? "live";
const SERVER    = (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3001";

const PERSONAS: { id: Persona; label: string; lang: string; desc: string; accent: string }[] = [
  { id: "casual_hype", label: "Casual", lang: "en-IN", desc: "English · hype", accent: "#E2694A" },
  { id: "stats_nerd",  label: "Stats",  lang: "en-IN", desc: "English · data", accent: "#4A8FE2" },
];

const EVENT_CFG: Record<string, { label: string; bg: string; color: string; glow: string }> = {
  wicket:        { label: "WICKET",  bg: "#2A1515", color: "#E24B4A", glow: "rgba(226,75,74,.2)"   },
  six:           { label: "SIX",     bg: "#211A0E", color: "#F0B942", glow: "rgba(240,185,66,.2)"  },
  four:          { label: "FOUR",    bg: "#0F1E18", color: "#4ECCA3", glow: "rgba(78,204,163,.2)"  },
  over_complete: { label: "OVER",    bg: "#161230", color: "#9B93F5", glow: "rgba(155,147,245,.2)" },
  fantasy:       { label: "FANTASY", bg: "#0E1820", color: "#5BADEE", glow: "rgba(91,173,238,.2)"  },
  dot_or_single: { label: "BALL",    bg: "#161B24", color: "#5A6478", glow: "transparent"          },
};

const TTS_CFG: Record<Persona, { lang: string; rate: number; pitch: number }> = {
  casual_hype: { lang: "en-IN", rate: 1.08, pitch: 1.10 },
  stats_nerd:  { lang: "en-IN", rate: 0.92, pitch: 0.88 },
};

// ─── useSpeech ────────────────────────────────────────────────────────────────

function useSpeech(persona: Persona) {
  const [speaking,  setSpeaking]  = useState(false);
  const [supported, setSupported] = useState(false);
  const [ready,     setReady]     = useState(false);
  const voiceMap = useRef<Record<string, SpeechSynthesisVoice>>({});
  const queue    = useRef<string[]>([]);
  const active   = useRef(false);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    setSupported(true);
    const load = () => {
      const vs = window.speechSynthesis.getVoices();
      if (!vs.length) return;
      const m: Record<string, SpeechSynthesisVoice> = {};
      vs.forEach(v => { m[v.lang] = v; });
      voiceMap.current = m;
      setReady(true);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const drain = useCallback(() => {
    const text = queue.current.shift();
    if (!text) { active.current = false; setSpeaking(false); return; }
    const cfg = TTS_CFG[persona];
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang  = cfg.lang;
    utt.rate  = cfg.rate;
    utt.pitch = cfg.pitch;
    const voice = voiceMap.current[cfg.lang]
      ?? Object.values(voiceMap.current).find(v => v.lang.startsWith(cfg.lang.split("-")[0]))
      ?? null;
    if (voice) utt.voice = voice;
    utt.onstart = () => { active.current = true; setSpeaking(true); };
    utt.onend   = () => drain();
    utt.onerror = () => drain();
    window.speechSynthesis.speak(utt);
  }, [persona]);

  const speak = useCallback((text: string) => {
    if (!supported || !ready || !text.trim()) return;
    queue.current.push(text);
    if (!active.current) drain();
  }, [supported, ready, drain]);

  const stop = useCallback(() => {
    queue.current = [];
    window.speechSynthesis.cancel();
    active.current = false;
    setSpeaking(false);
  }, []);

  useEffect(() => { stop(); }, [persona]);

  return { speak, stop, speaking, supported, ready };
}

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
      display:    "inline-block",
      transition: "transform .12s, opacity .12s",
      transform:  flash ? "translateY(-5px)" : "none",
      opacity:    flash ? 0 : 1,
    }}>{display}</span>
  );
}

// ─── Onboarding overlay ───────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    icon:  "🏏",
    title: "Follow cricket without a stream",
    body:  "CricketDesk gives you AI commentary, key-moment alerts, and fantasy advice — live, in your language.",
  },
  {
    icon:    "🎙️",
    title:   "Pick your commentary voice",
    body:    "Choose Casual for hype or Stats for data — the feed speaks your way.",
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
          {ONBOARDING_STEPS.map((_,i) => (
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
// Renders batting + bowling tables from live matchState data.
// Falls back to a "waiting" placeholder when no player data is available yet.

function ScorecardTab({ matchState }: { matchState: MatchState | null }) {

  // ── Batting table ──
  const renderBatting = () => {
    const batters = matchState?.batters ?? [];

    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
          Batting · {matchState?.batting_team ?? "—"}
        </div>

        {/* Header row */}
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
        ) : batters.map((b) => {
          const sr    = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
          const srNum = parseFloat(sr);
          return (
            <div
              key={b.name}
              style={{
                display: "grid", gridTemplateColumns: "1fr 36px 36px 24px 24px 48px",
                gap: 4, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.05)",
              }}
            >
              {/* Name + on-strike dot */}
              <div style={{
                fontSize: 13,
                color: b.on_strike ? "#F0F4FF" : "#8892A4",
                fontWeight: b.on_strike ? 600 : 400,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {b.on_strike && (
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "#4ECCA3", flexShrink: 0,
                    animation: "dotBlink 1.4s ease infinite",
                    display: "inline-block",
                  }}/>
                )}
                {b.name}
              </div>

              {/* Runs */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#F0F4FF", fontWeight: 600 }}>
                <AnimatedNumber value={b.runs} />
              </div>

              {/* Balls */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>
                <AnimatedNumber value={b.balls} />
              </div>

              {/* 4s */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>
                {b.fours}
              </div>

              {/* 6s */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>
                {b.sixes}
              </div>

              {/* SR — colour-coded: ≥150 teal, ≥100 amber, else muted */}
              <div style={{
                textAlign: "right", fontSize: 12, fontFamily: "'DM Mono',monospace",
                color: srNum >= 150 ? "#4ECCA3" : srNum >= 100 ? "#F0B942" : "#5A6478",
              }}>
                {sr}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Bowling table ──
  const renderBowling = () => {
    const bowlers = matchState?.bowlers ?? [];

    return (
      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
          Bowling · {matchState?.bowling_team ?? "—"}
        </div>

        {/* Header row */}
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
          const eco = parseFloat(b.economy);
          return (
            <div
              key={b.name}
              style={{
                display: "grid", gridTemplateColumns: "1fr 40px 32px 26px 48px",
                gap: 4, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.05)",
              }}
            >
              {/* Name + current-bowler indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {b.current && (
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "#9B93F5", flexShrink: 0,
                    animation: "dotBlink 1.4s ease infinite",
                    display: "inline-block",
                  }}/>
                )}
                <span style={{
                  fontSize: 13,
                  color: b.wickets > 0 ? "#F0F4FF" : "#8892A4",
                  fontWeight: b.wickets > 0 ? 600 : 400,
                }}>{b.name}</span>
              </div>

              {/* Overs */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>
                <AnimatedNumber value={b.overs} />
              </div>

              {/* Runs */}
              <div style={{ textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#5A6478" }}>
                <AnimatedNumber value={b.runs} />
              </div>

              {/* Wickets — red when > 0 */}
              <div style={{
                textAlign: "right", fontSize: 13, fontFamily: "'DM Mono',monospace",
                color: b.wickets > 0 ? "#E24B4A" : "#5A6478", fontWeight: 600,
              }}>
                {b.wickets}
              </div>

              {/* Economy — colour-coded: ≤7 teal, ≤10 amber, else red */}
              <div style={{
                textAlign: "right", fontSize: 12, fontFamily: "'DM Mono',monospace",
                color: eco <= 7 ? "#4ECCA3" : eco <= 10 ? "#F0B942" : "#E24B4A",
              }}>
                {b.economy}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      background: "#0E1117", border: "1px solid rgba(255,255,255,.07)",
      borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden",
    }}>
      {renderBatting()}
      {renderBowling()}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [persona,        setPersona]        = useState<Persona>("casual_hype");
  const [matchState,     setMatchState]     = useState<MatchState | null>(null);
  const [lines,          setLines]          = useState<CommentaryLine[]>([]);
  const [pulsing,        setPulsing]        = useState<number | null>(null);
  const [connected,      setConnected]      = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [copiedId,       setCopiedId]       = useState<number | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("cdo"));
  const [activeTab,      setActiveTab]      = useState<"feed" | "scorecard">("feed");
  const [matchKey,       setMatchKey]       = useState<string>(MATCH_KEY);
  const [matchTitle,     setMatchTitle]     = useState<string>("");

  const feedRef    = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const lineId     = useRef(0);
  const currentId  = useRef<number | null>(null);
  const linesRef   = useRef<CommentaryLine[]>([]);
  const personaRef = useRef<Persona>("casual_hype");

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stop } = useSpeech(persona);

  useEffect(() => { personaRef.current = persona; }, [persona]);

  // ── Auto-discover live IPL match ──
  useEffect(() => {
    fetch(`${SERVER}/matches/live`)
      .then(r => r.json())
      .then(({ matches }) => {
        if (!Array.isArray(matches) || matches.length === 0) return;
        // Prefer IPL match; fallback to first live match
        const ipl = matches.find((m: any) =>
          /ipl|indian premier league/i.test(m.tournament?.name ?? m.competition?.name ?? m.league?.name ?? m.name ?? "")
        ) ?? matches[0];
        const key = ipl?.key ?? ipl?.match_key ?? ipl?.id;
        if (key && key !== matchKey) {
          setMatchKey(String(key));
          const name = ipl?.name ?? ipl?.title ?? ipl?.tournament?.name ?? "";
          if (name) setMatchTitle(name);
        }
      })
      .catch(() => { /* fallback to env match key */ });
  }, []);

  const shareCommentary = useCallback((line: CommentaryLine) => {
    const p    = PERSONAS.find(p => p.id === line.persona);
    const text = `${line.text}\n\n— ${p?.label ?? line.persona} commentary via CricketDesk`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(line.id);
      setTimeout(() => setCopiedId(null), 1800);
    }).catch(() => {});
  }, []);

  // ── SSE connect ──
  useEffect(() => {
    if (esRef.current) esRef.current.close();
    currentId.current = null;
    linesRef.current  = [];
    setLines([]);

    const url = `${SERVER}/stream/${matchKey}?persona=${persona}`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => { setConnected(true); setError(null); });

    es.addEventListener("state", (e) => {
      setMatchState(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("token", (e) => {
      const { token, eventType } = JSON.parse((e as MessageEvent).data);

      if (token === "") {
        const id = ++lineId.current;
        currentId.current = id;
        const newLine: CommentaryLine = { id, text: "", eventType, complete: false, persona: personaRef.current };
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

    return () => { es.close(); stop(); };
  }, [persona, matchKey]);

  const pctComplete = matchState?.target
    ? Math.min(100, (parseInt(matchState.score || "0") / matchState.target) * 100)
    : 0;
  const needed = matchState?.target ? (matchState.target - parseInt(matchState.score || "0")) : 0;

  return (
    <div style={{
      fontFamily: "'Barlow Condensed', 'DM Sans', system-ui, sans-serif",
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
        @keyframes barPulse   { 0%,100%{opacity:.4} 50%{opacity:1} }
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

      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".04em", color: "#F0F4FF" }}>
              CRICKET<span style={{ color: "#4ECCA3" }}>DESK</span>
            </div>
            <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".07em", textTransform: "uppercase", marginTop: 1 }}>
              {matchTitle || "Follow live · no stream needed"}
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

        {/* ── Persona switcher ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {PERSONAS.map(p => (
            <button key={p.id} onClick={() => setPersona(p.id)} style={{
              padding: "9px 8px", borderRadius: 10, border: "none",
              background: persona === p.id ? `${p.accent}18` : "rgba(255,255,255,.04)",
              outline: persona === p.id ? `1.5px solid ${p.accent}` : "1.5px solid transparent",
              transition: "all .15s",
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: persona === p.id ? p.accent : "#8892A4" }}>{p.label}</div>
              <div style={{ fontSize: 10, color: "#5A6478", marginTop: 2 }}>{p.desc}</div>
            </button>
          ))}
        </div>

        {/* ── Scoreboard ── */}
        {matchState ? (
          <div style={{ background: "#0E1117", borderRadius: 12, overflow: "hidden", marginBottom: 14, border: "1px solid rgba(255,255,255,.07)" }}>

            <div style={{ padding: "16px 18px 14px", background: "linear-gradient(135deg,#111620,#161B28)", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
              <div style={{ fontSize: 11, color: "#5A6478", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
                {matchState.batting_team} vs {matchState.bowling_team}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: "-.5px" }}>
                    <AnimatedNumber value={matchState.score} />
                    <span style={{ fontSize: 28, color: "#5A6478", fontWeight: 600 }}>
                      /<AnimatedNumber value={matchState.wickets} />
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#5A6478", fontFamily: "'DM Mono',monospace", marginTop: 5 }}>
                    {matchState.overs} ov · RR <span style={{ color: "#F0F4FF" }}><AnimatedNumber value={matchState.run_rate} /></span>
                  </div>
                </div>
                {matchState.target && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#5A6478", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 3 }}>Need</div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: needed <= 0 ? "#4ECCA3" : "#F0F4FF" }}>
                      {needed <= 0 ? "WON 🏆" : <><AnimatedNumber value={needed} /><span style={{ fontSize: 12, color: "#5A6478" }}> off {20 - parseFloat(matchState.overs)} ov</span></>}
                    </div>
                    <div style={{ fontSize: 11, color: "#5A6478", fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                      RRR <span style={{ color: parseFloat(matchState.required_rate||"0") > 12 ? "#E24B4A" : "#F0B942" }}>
                        <AnimatedNumber value={matchState.required_rate ?? "—"} />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {matchState.target && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${pctComplete}%`,
                      background: "linear-gradient(90deg,#4ECCA3,#2ECC71)",
                      transition: "width .9s cubic-bezier(.22,1,.36,1)",
                    }}/>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: "#3A4050", fontFamily: "'DM Mono',monospace" }}>{Math.round(pctComplete)}% of {matchState.target}</span>
                    <span style={{ fontSize: 10, color: "#3A4050" }}>Target {matchState.target}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
              {[
                { label: "Partnership", value: matchState.partnership ?? "—" },
                { label: "Last wkt",    value: matchState.last_wicket  ?? "—" },
                { label: "Last 5",      value: matchState.last_5_overs ?? "—" },
              ].map(({ label, value }, i) => (
                <div key={label} style={{ padding: "9px 14px", borderRight: i < 2 ? "1px solid rgba(255,255,255,.06)" : "none" }}>
                  <div style={{ fontSize: 10, color: "#3A4050", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: "#8892A4" }}>
                    <AnimatedNumber value={value} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
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

        {/* ── Commentary feed ── */}
        {activeTab === "feed" && (
          <div
            ref={feedRef}
            style={{
              height: 360, overflowY: "auto",
              background: "#0E1117",
              border: "1px solid rgba(255,255,255,.07)",
              borderTop: "none",
              borderRadius: "0 0 12px 12px",
            }}
          >
            {lines.length === 0 ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#3A4050" }}>
                <div style={{ fontSize: 32 }}>🏏</div>
                <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
                  Waiting for ball events…<br/>
                  <span style={{ fontSize: 11, color: "#2A3040" }}>Commentary will appear here live</span>
                </div>
              </div>
            ) : lines.map((line, i) => {
              const cfg       = EVENT_CFG[line.eventType] ?? EVENT_CFG.dot_or_single;
              const isPulsing = pulsing === line.id;
              const isLatest  = i === lines.length - 1;
              const p         = PERSONAS.find(p => p.id === line.persona)!;
              return (
                <div
                  key={line.id}
                  className={`feed-item ${isLatest ? "slide-in" : ""}`}
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px",
                    background: isLatest ? `linear-gradient(135deg, ${cfg.glow} 0%, transparent 55%)` : "transparent",
                    transition: "background 1.5s ease",
                  }}
                >
                  <span
                    className={isPulsing ? "badge-pulse" : ""}
                    style={{
                      "--glow": cfg.glow,
                      flexShrink: 0, marginTop: 3,
                      fontSize: 9, fontWeight: 600,
                      fontFamily: "'DM Mono',monospace",
                      letterSpacing: ".08em",
                      padding: "3px 7px", borderRadius: 5,
                      background: cfg.bg, color: cfg.color,
                      display: "inline-block",
                    } as React.CSSProperties}
                  >
                    {cfg.label}
                  </span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, lineHeight: 1.65, color: isLatest ? "#F0F4FF" : "#8892A4" }}>
                      {line.text}
                      {!line.complete && isLatest && (
                        <span style={{
                          display: "inline-block", width: 7, height: 13,
                          background: "#4ECCA3", marginLeft: 3,
                          verticalAlign: "middle", borderRadius: 1, opacity: .6,
                          animation: "cursorBlink .8s step-end infinite",
                        }}/>
                      )}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
                      <span style={{ fontSize: 10, color: "#3A4050" }}>
                        <span style={{ color: p?.accent, opacity: .7 }}>{p?.label}</span>
                        {" · "}{line.eventType.replace("_", " ")}
                      </span>
                      {line.complete && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => shareCommentary(line)}
                            title="Copy commentary"
                            style={{
                              background: "none", border: "none", padding: "2px 5px",
                              fontSize: 11, color: copiedId === line.id ? "#4ECCA3" : "#3A4050",
                              cursor: "pointer", borderRadius: 4, lineHeight: 1,
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
                              background: "none", border: "none", padding: "2px 5px",
                              fontSize: 11, color: "#3A4050", cursor: "pointer",
                              borderRadius: 4, lineHeight: 1, textDecoration: "none",
                              display: "inline-block",
                            }}
                          >𝕏</a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
