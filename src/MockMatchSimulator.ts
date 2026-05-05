import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
dotenv.config({ override: true });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const PERSONA_PROMPTS: Record<string, string> = {
  casual_hype: `You are an exciting, casual cricket commentator. React with energy and emotion in 1-2 short sentences. Use simple language and exclamations. Never exceed 40 words.`,
  stats_nerd:  `You are a cricket analytics commentator. Give 1-2 sentences focused on statistics and data-driven insights. Be precise. Never exceed 40 words.`,
  hindi:       `Aap ek josh se bhari cricket commentary dene wale hain. 1-2 sentences mein Hindi mein commentary den. 40 se zyada words mat likhein.`,
  tamil:       `நீங்கள் ஒரு உற்சாகமான கிரிக்கெட் கமென்டேட்டர். 1-2 சிறிய வாக்கியங்களில் தமிழில் கமென்டரி கொடுங்கள். 40 சொற்களை விட அதிகமாக எழுத வேண்டாம்.`,
  telugu:      `మీరు ఒక ఉత్సాహకరమైన క్రికెట్ కామెంటేటర్. 1-2 చిన్న వాక్యాలలో తెలుగులో కామెంటరీ ఇవ్వండి. 40 పదాల కంటే ఎక్కువ రాయవద్దు.`,
  bengali:     `আপনি একজন উত্তেজনাপূর্ণ ক্রিকেট কমেন্টেটর। 1-2টি ছোট বাক্যে বাংলায় কমেন্টারি দিন। 40টির বেশি শব্দ লিখবেন না।`,
  marathi:     `तुम्ही एक उत्साहपूर्ण क्रिकेट कमेंटेटर आहात. 1-2 छोट्या वाक्यांमध्ये मराठीत कमेंटरी द्या. 40 पेक्षा जास्त शब्द लिहू नका.`,
  kannada:     `ನೀವು ಒಬ್ಬ ಉತ್ಸಾಹದಾಯಕ ಕ್ರಿಕೆಟ್ ಕಾಮೆಂಟೇಟರ್. 1-2 ಸಣ್ಣ ವಾಕ್ಯಗಳಲ್ಲಿ ಕನ್ನಡದಲ್ಲಿ ಕಾಮೆಂಟರಿ ನೀಡಿ. 40 ಮಾತುಗಳಿಗಿಂತ ಹೆಚ್ಚು ಬರೆಯಬೇಡಿ.`,
  malayalam:   `നിങ്ങൾ ഒരു ആവേശകരമായ ക്രിക്കറ്റ് കമെന്റേറ്റർ ആണ്. 1-2 ചെറിയ വാക്കുകളിൽ മലയാളത്തിൽ കമെന്ററി നൽകുക. 40 വാക്കുകളിൽ കൂടുതൽ എഴുതരുത്.`,
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

export class MockMatchSimulator {
  private intervalId: NodeJS.Timeout | null = null;
  private eventIndex = 0;
  private getActivePersonas: () => string[];

  constructor(getActivePersonas: () => string[]) {
    this.getActivePersonas = getActivePersonas;
  }

  start(send: (event: string, data: unknown) => void, interval: number) {
    this.intervalId = setInterval(async () => {
      if (this.eventIndex >= FAKE_EVENTS.length) {
        this.eventIndex = 0; // Loop or stop?
      }
      const event = FAKE_EVENTS[this.eventIndex++];
      const personas = this.getActivePersonas();
      const persona = personas[Math.floor(Math.random() * personas.length)] || "casual_hype";

      const commentary = await this.generateCommentary(event, persona);
      send("commentary", { event, commentary });
    }, interval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async generateCommentary(event: typeof FAKE_EVENTS[0], persona: string): Promise<string> {
    // Static commentary for demo purposes
    const staticComments = {
      casual_hype: "What a shot! That's massive!",
      stats_nerd: "Run rate now at 9.2, excellent strike rate.",
      hindi: "क्या शॉट था! बहुत बड़ा!",
      tamil: "என்ன ஷாட்! மிகவும் பெரியது!",
      telugu: "ఏ షాట్! చాలా పెద్దది!",
      bengali: "কী শট! খুব বড়!",
      marathi: "काय शॉट होता! खूप मोठा!",
      kannada: "ಏನ್ ಶಾಟ್! ತುಂಬಾ ದೊಡ್ಡದು!",
      malayalam: "എന്ത് ഷോട്ട്! വളരെ വലുത്!",
    };
    return staticComments[persona as keyof typeof staticComments] || staticComments.casual_hype;
  }
}