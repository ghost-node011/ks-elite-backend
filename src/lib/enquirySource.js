import { llmChat } from "./llm.js";

export const ENQUIRY_SOURCES = ["LinkedIn", "Referral", "Google / Online Search", "Social Media", "Returning Client", "Direct / Website"];

const SYSTEM_PROMPT = `You tag where a law firm's website contact enquiry likely originated, based only on the free-text message a visitor wrote. People sometimes mention how they found the firm — e.g. "saw your LinkedIn post", "a friend recommended you", "found you on Google", "I'm a returning client" — look for such signals.

Respond with ONLY a JSON object: { "source": one of ${JSON.stringify(ENQUIRY_SOURCES)} }

If there is no signal at all about how they found the firm, respond with "Direct / Website" — never guess beyond what the text actually says.`;

// Best-effort — this is a nice-to-have tag, never worth failing or delaying
// the enquiry submission over.
export async function classifyEnquirySource({ message, matter }) {
  const userPrompt = `Matter: ${matter || "(not specified)"}\nMessage: ${message}`;

  try {
    const raw = await llmChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.2, maxTokens: 60, json: true }
    );
    const parsed = JSON.parse(raw);
    return ENQUIRY_SOURCES.includes(parsed.source) ? parsed.source : "Direct / Website";
  } catch (err) {
    console.error("Enquiry source classification failed:", err.message);
    return null;
  }
}
