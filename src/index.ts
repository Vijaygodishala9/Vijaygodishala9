/**
 * index.ts — Usage example for Idea 5 commentary personalizer
 * Run: npx ts-node src/index.ts
 */

import { RoanuzCricketSocket, PersonaMode } from "./RoanuzCricketSocket";

// Tracks the current commentary line being streamed
let currentLine = "";

const client = new RoanuzCricketSocket({
  projectKey: process.env.ROANUZ_PROJECT_KEY!,
  apiKey:     process.env.ROANUZ_API_KEY!,
  matchKey:   process.env.ROANUZ_MATCH_KEY ?? "indpak_2024_t20_01",
  persona:    (process.env.PERSONA as PersonaMode) ?? "casual_hype",

  // onCommentary fires for every streamed token — pipe to SSE, WebSocket, or stdout
  onCommentary: (token, eventType) => {
    process.stdout.write(token);   // stream tokens live in terminal
    currentLine += token;

    // Detect end-of-sentence to flush to SSE client
    if (token.includes(".") || token.includes("!") || token.includes("?")) {
      // TODO: sseEmitter.emit(eventType, currentLine)
      currentLine = "";
      console.log();  // newline after each sentence
    }
  },

  onError: (err) => {
    console.error("[App] Fatal error:", err.message);
    process.exit(1);
  },
});

async function main() {
  console.log("Connecting to Roanuz Cricket API...");

  // Step 1: REST subscribe call (registers interest with Roanuz server)
  // Do this before connecting the socket
  await client.subscribeMatch().catch((e) =>
    console.warn("[App] Subscribe REST failed (may already be subscribed):", e.message)
  );

  // Step 2: Open Socket.IO connection — auth + join happen automatically
  await client.connect();
  console.log("Socket connected. Waiting for live ball events...\n");

  // Demo: switch persona after 30s
  setTimeout(() => {
    console.log("\n[Demo] Switching persona to stats_nerd...\n");
    client.setPersona("stats_nerd");
  }, 30_000);

  // Graceful shutdown on Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n[App] Shutting down...");
    client.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
