/**
 * mockSimulator.ts
 * Fires fake ball events through Claude → SSE → React UI
 * No Roanuz subscription needed for testing.
 */
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
dotenv.config({ override: true });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PERSONA_PROMPTS: Record<string, string> = {
  casual_hype: `You are an exciting, casual cricket commentator. React with energy and emotion in 1-2 short sentences. Use simple language and exclamations. Never exceed 40 words.`,
  stats_nerd:  `You are a cricket analytics commentator. Give 1-2 sentences focused on statistics and data-driven insights. Be precise. Never exceed 40 words.`,
  hindi:       `Aap ek josh se bhari cricket commentary dene wale hain. 1-2 sentences mein Hindi mein commentary den. 40 se zyada words mat likhein.`,
};

const FAKE_EVENTS = [
  { type: "six",           batsman: "Virat Kohli",   bowler: "Shaheen Afridi", runs: 6,  over: 3,  ball: 2 },
  { type: "wicket",        batsman: "Rohit Sharma",  bowler: "Naseem Shah",    runs: 0,  over: 4,  ball: 1, wicket_type: "caught" },
  { type: "four",          batsman: "KL Rahul",      bowler: "Haris Rauf",     runs: 4,  over: 5,  ball: 4 },
  { type: "six",           batsman: "Hardik Pandya", bowler: "Shadab Khan",    runs: 6,  over: 7,  ball: 3 },
  { type: "over_complete", batsman: "Suryakumar",    bowler: "Mohammad Amir",  runs: 2,  over: 8,  ball: 6 },
  { type: "wicket",        batsman: "KL Rahul",      bowler: "Shaheen Afridi", runs: 0,  over: 9,  ball: 2, wicket_type: "bowled" },
  { type: "four",          batsman: "Virat Kohli",   bowler: "Haris Rauf",     runs: 4,  over: 10, ball: 5 },
];

async function streamCommentary(event: typeof FAKE_EVENTS[0], persona: string) {
  const prompt = `Match: India vs Pakistan T20
Score: 87/2 in ${event.over}.${event.ball} overs (RR: 8.2)
Event: ${event.type.toUpperCase()}
Ball ${event.over}.${event.ball}: ${event.bowler} to ${event.batsman} — ${
    event.type === "wicket"
      ? `WICKET (${event.wicket_type})`
      : event.runs === 6 ? "SIX!"
      : event.runs === 4 ? "FOUR!"
      : `${event.runs} run(s)`
  }
Generate commentary now.`;

  process.stdout.write(`\n[${event.type.toUpperCase()}] ${event.batsman}: `);

  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 80,
    system: PERSONA_PROMPTS[persona],
    messages: [{ role: "user", content: prompt }],
  });

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      process.stdout.write(chunk.delta.text);
    }
  }
  console.log();
}

async function runSimulator() {
  const persona = process.argv[2] ?? "casual_hype";
  console.log(`\n🏏 Mock Cricket Commentary Simulator`);
  console.log(`Persona: ${persona}`);
  console.log(`Firing ${FAKE_EVENTS.length} ball events with 4s intervals...\n`);

  for (const event of FAKE_EVENTS) {
    await streamCommentary(event, persona);
    await new Promise(r => setTimeout(r, 4000));
  }

  console.log("\n✅ Simulation complete.");
}

runSimulator().catch(console.error);