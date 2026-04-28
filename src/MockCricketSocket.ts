import Anthropic from "@anthropic-ai/sdk";
import { PersonaMode } from "./RoanuzCricketSocket";
import { CommentaryCache } from "./CommentaryCache";

export interface NotableEventPayload {
  title: string;
  body: string;
  tag: string;
}

interface MockConfig {
  matchKey: string;
  getActivePersonas?: () => PersonaMode[];
  onCommentary?: (token: string, eventType: string, persona: PersonaMode) => void;
  onFantasy?: (advice: string, eventType: string, batsman: string) => void;
  onNotableEvent?: (payload: NotableEventPayload) => void;
  onError?: (err: Error) => void;
}

// ─── All personas ─────────────────────────────────────────────────────────────

const ALL_PERSONAS: PersonaMode[] = [
  "casual_hype", "stats_nerd",
  "hindi", "tamil", "telugu", "bengali", "marathi", "kannada", "malayalam",
];

// ─── Live Claude prompts ──────────────────────────────────────────────────────

const PERSONA_PROMPTS: Record<PersonaMode, string> = {
  casual_hype: `Exciting casual English cricket commentator. 1-2 sentences, energy and drama. Max 40 words.`,
  stats_nerd:  `Cricket analytics commentator. 1-2 sentences, stats and data focus. Max 40 words.`,
  hindi:       `Josh bhari Hindi cricket commentary. 1-2 sentences, simple aur energetic. 40 words se kam.`,
  tamil:       `Energetic Tamil cricket commentator. 1-2 sentences in Tamil, lively and fan-friendly. Max 40 words.`,
  telugu:      `Energetic Telugu cricket commentator. 1-2 sentences in Telugu, lively and fan-friendly. Max 40 words.`,
  bengali:     `Energetic Bengali cricket commentator. 1-2 sentences in Bengali, lively and fan-friendly. Max 40 words.`,
  marathi:     `Energetic Marathi cricket commentator. 1-2 sentences in Marathi, lively and fan-friendly. Max 40 words.`,
  kannada:     `Energetic Kannada cricket commentator. 1-2 sentences in Kannada, lively and fan-friendly. Max 40 words.`,
  malayalam:   `Energetic Malayalam cricket commentator. 1-2 sentences in Malayalam, lively and fan-friendly. Max 40 words.`,
};

const FANTASY_PROMPT = `Fantasy cricket advisor. One sentence of actionable fantasy advice: points impact, captain value, form signals. Max 20 words.`;

// ─── Canned responses per event (7 events × 9 personas) ─────────────────────

const CANNED: Array<{ commentary: Record<PersonaMode, string>; fantasy?: string }> = [
  {
    // 0 · SIX — Virat Kohli off Shaheen Afridi
    commentary: {
      casual_hype: "OH WOW! Kohli absolutely SMASHES that over long-on! Monster SIX, what a shot!",
      stats_nerd:  "Kohli's 6th maximum — strike rate now 198, well above his T20 career avg of 139.",
      hindi:       "Kya shot mara Kohli ne! Seedha stands mein! Jawab nahi is aadmi ka — CHHAKKA!",
      tamil:       "Kohli eppadiyoru shot! Stadium-e adichitu! Enna oru SIX da bhai!",
      telugu:      "Kohli enti shot! Stadium lo ki velipoyindi — emi oka SIX ra baba!",
      bengali:     "Kohli ki shot! Stadium theke baira gelo — kemon ekta SIX re!",
      marathi:     "Kohli kaay shot maarla! Stadium baher gela — kiti bhari SIX!",
      kannada:     "Kohli yaavdu shot! Stadium daati hoyitu — enu oru SIX!",
      malayalam:   "Kohli enna oru shot! Stadium kazhinjupoyi — ippo oru SIX!",
    },
    fantasy: "Kohli in explosive form — strong captain pick if you need a differential tonight.",
  },
  {
    // 1 · WICKET — Rohit Sharma caught by Naseem Shah
    commentary: {
      casual_hype: "WICKET! Rohit's gone for a duck! Naseem strikes — Pakistan is absolutely ECSTATIC!",
      stats_nerd:  "Rohit dismissed for 0 — his 3rd duck vs Pakistan in T20Is. Naseem's economy: 5.8.",
      hindi:       "Aur Rohit Sharma aout! Sifar pe! Naseem ne kya delivery ki — Pakistan ke fans jhoom rahe!",
      tamil:       "Rohit Sharma out! Sifar-la out! Pakistan fans mela jolly thaan da!",
      telugu:      "Rohit Sharma out! Zero ki out! Pakistan fans aanandam lo unnaru!",
      bengali:     "Rohit Sharma out! Shunya te out! Pakistan fans khushi te jhomche!",
      marathi:     "Rohit Sharma aout! Shunya la out — Pakistan chya fans anandaat!",
      kannada:     "Rohit Sharma out! Shunya ge out — Pakistan fans santhoshada hoot!",
      malayalam:   "Rohit Sharma out! Punnayil out — Pakistan fans santhoshathil!",
    },
    fantasy: "Rohit OUT for 0 — remove immediately from your XI, negative points incoming.",
  },
  {
    // 2 · FOUR — KL Rahul off Haris Rauf
    commentary: {
      casual_hype: "Lovely cover drive from Rahul! Timed to perfection through the gap — FOUR!",
      stats_nerd:  "Rahul's cover drive off Rauf — 74% of his boundaries come through this arc historically.",
      hindi:       "Wah Rahul bhai! Covers ke through kya timing — FOUR! Bilkul perfect shot!",
      tamil:       "Rahul enna timing! Cover through FOUR! Arumai da bhai!",
      telugu:      "Rahul timing super! Cover through FOUR! Chala bagundi boss!",
      bengali:     "Rahul er timing! Cover diye FOUR! Darun khelse!",
      marathi:     "Rahul chi timing! Cover madhun FOUR — shandar shot!",
      kannada:     "Rahul timing! Cover moode FOUR — chenna ide bhai!",
      malayalam:   "Rahul timing! Cover vazhi FOUR — valare nannayirunnu!",
    },
    fantasy: "Rahul timing the ball beautifully — safe mid-order pick for consistent returns.",
  },
  {
    // 3 · SIX — Hardik Pandya off Shadab Khan
    commentary: {
      casual_hype: "BOOM! Hardik clears the ropes off Shadab with ease! Another MASSIVE SIX — he's on fire!",
      stats_nerd:  "Pandya hits his 2nd six — projected total at current RR: 156. High-variance innings.",
      hindi:       "Hardik ne aasman chhoo liya! Shadab ko tofaan mein udaya — CHHAKKA! Zabardast!",
      tamil:       "Pandya super shot! Shadab-a six-a adichi — vaai potta vaangom da!",
      telugu:      "Pandya super shot! Shadab ni six kottadu — wow ra baba!",
      bengali:     "Pandya ki shot! Shadab ke SIX marlo — wow ki khela!",
      marathi:     "Pandya ne SIX maarlaa! Shadab la udavla — wow kiti mast!",
      kannada:     "Pandya SIX hoda! Shadab ge adida — wow bhai wow!",
      malayalam:   "Pandya SIX adichi! Shadab-ne thadanjirunnu — wow!",
    },
    fantasy: "Hardik hitting big — excellent multiplier if he bats through; high ceiling tonight.",
  },
  {
    // 4 · OVER_COMPLETE — Suryakumar (no fantasy)
    commentary: {
      casual_hype: "Good over from Amir — just 2 off it. Tight bowling, India need to up the run rate!",
      stats_nerd:  "Amir's spell: 8 overs, 14 runs, 1 wicket. Economy 1.75 this over — exceptional containment.",
      hindi:       "Amir ka kamal over — sirf 2 run! India par pressure badh raha hai!",
      tamil:       "Amir tight over — 2 run mattum. India kku pressure thaan da!",
      telugu:      "Amir tight over — 2 runs matrame. India ki pressure padeesthundi!",
      bengali:     "Amir er tight over — 2 run. India te pressure baadche!",
      marathi:     "Amir chi tight over — sirf 2 dhav. India var dabaav vadhla!",
      kannada:     "Amir tight over — 2 run. India ge pressure idhey!",
      malayalam:   "Amir tight over — 2 run. India pressure il aanulla!",
    },
  },
  {
    // 5 · WICKET — KL Rahul bowled by Shaheen Afridi
    commentary: {
      casual_hype: "BOWLED HIM! Rahul's stumps shattered by Afridi — Pakistan take full control!",
      stats_nerd:  "Rahul bowled — Afridi's 4th wicket against him in T20Is. A dominant head-to-head matchup.",
      hindi:       "Rahul bhi gaye! Bowled! Afridi ki swing ke aage koi jawab nahi — Pakistan dominant!",
      tamil:       "Rahul bowled! Afridi-oda swing-ku answer-e kidaiyathu — Pakistan control!",
      telugu:      "Rahul bowled! Afridi swing ki answer ledu — Pakistan dominant!",
      bengali:     "Rahul bowled! Afridi r swing er jawab nei — Pakistan control e!",
      marathi:     "Rahul bowled! Afridi chi swing la uttar nahi — Pakistan dominant!",
      kannada:     "Rahul bowled! Afridi swing ge uttara illa — Pakistan control!",
      malayalam:   "Rahul bowled! Afridi swing-inu marupadi illayirunnu — Pakistan!",
    },
    fantasy: "Rahul bowled cheaply — his fantasy value crashes, expect poor returns today.",
  },
  {
    // 6 · FOUR — Virat Kohli off Haris Rauf
    commentary: {
      casual_hype: "Beautiful! Kohli strokes it through covers for FOUR — back to his absolute elegant best!",
      stats_nerd:  "Kohli's boundary count reaches 5 — on pace for 50+ if current strike rate holds.",
      hindi:       "Kohli ki classic cover drive! Koi rok nahi sakta — FOUR! Maidaan ka raja yahi hai!",
      tamil:       "Kohli's classic drive! Yarum thada maatom — FOUR! Legend thaan da!",
      telugu:      "Kohli drive chestadu! Aagaledu — FOUR! Meeru legend bhai!",
      bengali:     "Kohli drive dilo! Keu thakte parbe na — FOUR! Legend!",
      marathi:     "Kohli chi drive! Kuni thaambavat nahi — FOUR! Legend aahe!",
      kannada:     "Kohli drive! Yaavaro thadeyokke agolla — FOUR! Legend!",
      malayalam:   "Kohli drive! Aarkum thadukkan patilla — FOUR! Legend!",
    },
    fantasy: "Kohli looking fluent — upgrade to captain if you can, he's in premium touch.",
  },
];

// ─── Event definitions ────────────────────────────────────────────────────────

const FAKE_EVENTS = [
  { type: "six",           batsman: "Virat Kohli",   bowler: "Shaheen Afridi", runs: 6, over: 3,  ball: 2 },
  { type: "wicket",        batsman: "Rohit Sharma",  bowler: "Naseem Shah",    runs: 0, over: 4,  ball: 1, wicket_type: "caught" },
  { type: "four",          batsman: "KL Rahul",      bowler: "Haris Rauf",     runs: 4, over: 5,  ball: 4 },
  { type: "six",           batsman: "Hardik Pandya", bowler: "Shadab Khan",    runs: 6, over: 7,  ball: 3 },
  { type: "over_complete", batsman: "Suryakumar",    bowler: "Mohammad Amir",  runs: 2, over: 8,  ball: 6 },
  { type: "wicket",        batsman: "KL Rahul",      bowler: "Shaheen Afridi", runs: 0, over: 9,  ball: 2, wicket_type: "bowled" },
  { type: "four",          batsman: "Virat Kohli",   bowler: "Haris Rauf",     runs: 4, over: 10, ball: 5 },
];

type FakeEvent = typeof FAKE_EVENTS[0];

const PUSH_NOTABLE    = new Set(["six", "wicket"]);
const FANTASY_NOTABLE = new Set(["six", "wicket", "four"]);

// ─── Socket ───────────────────────────────────────────────────────────────────

export class MockCricketSocket {
  private destroyed  = false;
  private anthropic: Anthropic | null = null;
  private cache      = new CommentaryCache();
  private config: MockConfig;
  private eventIndex = 0;

  constructor(config: MockConfig) {
    this.config = config;
    if (process.env.MOCK_CLAUDE !== "true") {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn("[Mock] ANTHROPIC_API_KEY not set — forcing MOCK_CLAUDE mode");
      } else {
        this.anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          maxRetries: 2,
          timeout: 30_000,
        });
      }
    }
  }

  async subscribeMatch(): Promise<void> {}

  async connect(): Promise<void> {
    const mode = this.anthropic ? "live Claude" : "mock";
    console.log(`[Mock] Starting simulation (${mode}) for match: ${this.config.matchKey}`);
    this.runLoop().catch((err) => this.config.onError?.(err));
  }

  destroy(): void {
    this.destroyed = true;
    console.log("[Mock] Simulation stopped.");
  }

  setPersona(_persona: PersonaMode): void {}  // personas managed per SSE client

  getMatchState() {
    return { score: "87/2", wickets: 2, overs: "10.0", run_rate: "8.70", batting_team: "India", bowling_team: "Pakistan", last_ball: null };
  }

  // ─── Main loop ────────────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    while (!this.destroyed) {
      for (let i = 0; i < FAKE_EVENTS.length; i++) {
        if (this.destroyed) return;
        this.eventIndex = i;
        await this.handleEvent(FAKE_EVENTS[i]);
        await new Promise<void>((r) => setTimeout(r, 4000));
      }
    }
  }

  private async handleEvent(event: FakeEvent): Promise<void> {
    if (this.destroyed) return;
    console.log(`[Mock] ${event.type.toUpperCase()} — ${event.batsman}`);

    // Fire push immediately (no Claude latency)
    if (PUSH_NOTABLE.has(event.type)) {
      this.config.onNotableEvent?.({
        title: event.type === "wicket" ? `🎯 WICKET! ${event.batsman}` : `🏏 SIX! ${event.batsman}`,
        body:  event.type === "wicket"
          ? `OUT! ${"wicket_type" in event ? event.wicket_type : "dismissed"} by ${event.bowler}`
          : `Clears the ropes off ${event.bowler}!`,
        tag: event.type,
      });
    }

    // Get which personas currently have active clients
    const active = this.config.getActivePersonas?.() ?? ALL_PERSONAS;
    if (active.length === 0) return;

    if (this.anthropic) {
      await this.streamLive(event, active);
    } else {
      await this.streamCanned(event, active);
    }

    // Fantasy advice after commentary (English, language-agnostic)
    if (FANTASY_NOTABLE.has(event.type) && !this.destroyed) {
      const fantasy = CANNED[this.eventIndex]?.fantasy;
      if (fantasy) this.config.onFantasy?.(fantasy, event.type, event.batsman);
    }
  }

  // ─── Mock streaming (no API cost) ────────────────────────────────────────

  private async streamCanned(event: FakeEvent, personas: PersonaMode[]): Promise<void> {
    const canned = CANNED[this.eventIndex];
    await Promise.all(personas.map((p) => this.emitWords(p, canned.commentary[p], event.type)));
  }

  private async emitWords(persona: PersonaMode, text: string, eventType: string): Promise<void> {
    this.config.onCommentary?.("", eventType, persona);  // signal new line
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (this.destroyed) return;
      this.config.onCommentary?.((i === 0 ? "" : " ") + words[i], eventType, persona);
      await delay(45 + Math.random() * 55);
    }
  }

  // ─── Live Claude streaming with cache + retry ─────────────────────────────

  private async streamLive(event: FakeEvent, personas: PersonaMode[]): Promise<void> {
    await Promise.all(personas.map((p) => this.streamPersona(p, event)));
  }

  private async streamPersona(persona: PersonaMode, event: FakeEvent): Promise<void> {
    const cacheKey = this.cache.key(persona, event.type, event.batsman, event.bowler);
    const cached   = this.cache.get(cacheKey);

    this.config.onCommentary?.("", event.type, persona);  // signal new line

    if (cached) {
      await this.emitWords(persona, cached, event.type);
      return;
    }

    const context = buildContext(event);
    let fullText  = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const stream = this.anthropic!.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 80,
          system: PERSONA_PROMPTS[persona],
          messages: [{ role: "user", content: `${context}\nGenerate commentary now.` }],
        });

        for await (const chunk of stream) {
          if (this.destroyed) return;
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            const token = chunk.delta.text;
            fullText += token;
            this.config.onCommentary?.(token, event.type, persona);
          }
        }

        if (fullText) this.cache.set(cacheKey, fullText);
        return;

      } catch (err: any) {
        const isTimeout = err.message?.includes("timeout") || err.message?.includes("idle");
        console.warn(`[Mock] Stream ${isTimeout ? "timeout" : "error"} for ${persona} (attempt ${attempt + 1}):`, err.message);
        if (attempt < 2 && !this.destroyed) {
          await delay(1000 * (attempt + 1));  // 1s, 2s backoff
        } else {
          // Fall back to canned response on persistent failure
          const fallback = CANNED[this.eventIndex]?.commentary[persona];
          if (fallback) await this.emitWords(persona, fallback, event.type);
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildContext(event: FakeEvent): string {
  const ballDesc =
    event.type === "wicket"
      ? `WICKET (${"wicket_type" in event ? event.wicket_type : "out"})`
      : event.runs === 6 ? "SIX!"
      : event.runs === 4 ? "FOUR!"
      : `${event.runs} run(s)`;
  return `Match: India vs Pakistan T20 | Score: 87/2 in ${event.over}.${event.ball} overs | Ball ${event.over}.${event.ball}: ${event.bowler} to ${event.batsman} — ${ballDesc}`;
}
