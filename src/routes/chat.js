import { Router } from "express";
import { llmChatRaw, LlmError } from "../lib/llm.js";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";
import { getSiteKnowledge, getArticleBySlug } from "../lib/siteKnowledge.js";
import { isValidPhone } from "../lib/validators.js";

const router = Router();
const contactStore = createStore("contacts");

const SYSTEM_PROMPT_HEADER = `You are the website assistant for K.S. Elite Attorneys, a law firm in Delhi, India.

Your job: answer visitor questions about the firm, its people, its practice areas, its blog articles, and general legal process/terminology in plain language. Be concise and warm, like a helpful front-desk paralegal. Use the site knowledge below — it's the current, real state of the website, not general knowledge — to answer specifically rather than generically whenever it's relevant.

You can also book a consultation appointment directly using the book_appointment tool:
- Collect the visitor's full name and phone number at minimum — ask for both if missing.
- Also try to get their preferred date/time and the nature of their matter, but don't block the booking on these if the visitor doesn't offer them.
- Once you have name and phone, call book_appointment. After it succeeds, confirm the booking to the visitor and let them know the team will call to confirm details.
- If the tool reports an error, tell the visitor what's missing and ask for it.

If a visitor asks something about a specific blog article that the summary below doesn't answer, call get_article_content with that article's slug to read the full piece before answering — don't guess at its contents.

Rules:
- Never give specific legal advice or predict case outcomes — general information only.
- For anything specific to a visitor's situation, encourage them to book a consultation (via the tool, phone, or WhatsApp).
- Keep replies short (2-4 sentences) unless the question needs more detail.
- Plain text only — this renders in a chat bubble, not a document. Never use markdown (no **bold**, no #headings, no bullet/numbered lists, no backticks).

--- SITE KNOWLEDGE (current as of this conversation) ---`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Book a consultation appointment with K.S. Elite Attorneys. Call this once the visitor has provided at least their name and phone number.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Visitor's full name" },
          phone: { type: "string", description: "Visitor's phone number" },
          matter: { type: "string", description: "Nature of the legal matter, if mentioned" },
          preferredDate: { type: "string", description: "Preferred date, in whatever format the visitor gave" },
          preferredTime: { type: "string", description: "Preferred time, in whatever format the visitor gave" },
          notes: { type: "string", description: "Any other relevant context worth passing to the team" },
        },
        required: ["name", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_article_content",
      description: "Fetch the full text of a specific published blog article by its slug, for questions the article summary doesn't cover.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "The article's slug, from the site knowledge list" } },
        required: ["slug"],
      },
    },
  },
];

const MAX_MESSAGES = 16;
const MAX_CONTENT_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 3;

async function bookAppointment(args) {
  const name = String(args?.name ?? "").trim();
  const phone = String(args?.phone ?? "").trim();
  if (!name || !phone) return { error: "Missing name or phone — ask the visitor for both before booking." };
  if (!isValidPhone(phone)) return { error: "That doesn't look like a valid phone number — ask the visitor to confirm it." };

  const message = [
    args.notes ? String(args.notes).trim() : null,
    args.preferredDate ? `Preferred date: ${String(args.preferredDate).trim()}` : null,
    args.preferredTime ? `Preferred time: ${String(args.preferredTime).trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Booked via website chatbot";

  const record = await contactStore.append({
    name,
    phone,
    matter: args.matter ? String(args.matter).trim() : "",
    message,
    status: "new",
    source: "chatbot",
  });

  notifyLead(`New chatbot appointment — ${record.name}`, [
    `Name: ${record.name}`,
    `Phone: ${record.phone}`,
    `Matter: ${record.matter || "—"}`,
    `Details: ${record.message}`,
    `Booked via: website chatbot`,
    `Received: ${record.receivedAt}`,
  ]);

  return { ok: true, confirmationId: record.id };
}

async function runTool(name, args) {
  if (name === "book_appointment") return bookAppointment(args);
  if (name === "get_article_content") {
    const slug = String(args?.slug ?? "").trim();
    if (!slug) return { error: "No slug provided." };
    const article = await getArticleBySlug(slug);
    return article || { error: "No published article found with that slug." };
  }
  return { error: "Unknown tool." };
}

router.post("/", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array." });
  }

  const cleaned = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CONTENT_LENGTH) }));

  if (cleaned.length === 0) {
    return res.status(400).json({ error: "No valid messages provided." });
  }

  try {
    const { prompt: siteKnowledge } = await getSiteKnowledge();
    const systemPrompt = `${SYSTEM_PROMPT_HEADER}\n${siteKnowledge}`;
    const convo = [{ role: "system", content: systemPrompt }, ...cleaned];

    let message = await llmChatRaw(convo, { temperature: 0.6, maxTokens: 500, tools: TOOLS });
    let rounds = 0;

    while (message.tool_calls?.length && rounds < MAX_TOOL_ROUNDS) {
      convo.push({ role: "assistant", content: message.content || null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        let result;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = await runTool(call.function.name, args);
        } catch (err) {
          result = { error: `Failed to process: ${err.message}` };
        }
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }

      message = await llmChatRaw(convo, { temperature: 0.6, maxTokens: 500, tools: TOOLS });
      rounds++;
    }

    if (!message.content) throw new LlmError("The AI provider returned an empty response.", 502);
    res.json({ reply: message.content });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("Chat error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
