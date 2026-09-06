import { Router } from "express";
import { llmChatRaw, LlmError } from "../lib/llm.js";
import { requireAdminAuth } from "../lib/adminAuth.js";
import { hasPermission } from "../lib/permissions.js";
import { getDb } from "../lib/db.js";

const router = Router();

const SYSTEM_PROMPT = `You are an internal AI assistant embedded in K.S. Elite Attorneys' staff admin dashboard. You help staff quickly understand and triage incoming consultation leads and internship applications.

Always call a tool to look up real data before answering anything about specific leads or applications — never invent names, dates, scores, or other details. When you reference a specific record, mention its name and received date so staff can find it in the dashboard list.

Internship applications already carry an AI fit assessment done at submission time (aiVerdict: "Strong Fit" / "Possible Fit" / "Not a Fit", aiScore 0-100, aiSummary) — use these existing fields when asked whether a candidate is good, don't re-assess from scratch.

Consultation leads carry a "source" tag (LinkedIn, Referral, Google / Online Search, Social Media, Returning Client, Direct / Website) inferred from their message — use this when asked where enquiries are coming from.

If a tool reports that a section isn't available, tell the staff member they don't have access to that section rather than guessing.

Keep replies concise and scannable — short paragraphs, or a short list of records with a one-line summary each. Plain text only, this renders in a chat bubble: no markdown (**bold**, #headings, bullet/numbered list syntax, backticks).`;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTACT_TOOL = {
  type: "function",
  function: {
    name: "search_contacts",
    description: "Search consultation/contact-us leads. Omit filters to list the most recent ones.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search across name, matter, and message" },
        status: { type: "string", enum: ["new", "contacted", "closed"] },
        source: { type: "string", enum: ["LinkedIn", "Referral", "Google / Online Search", "Social Media", "Returning Client", "Direct / Website"] },
        limit: { type: "number", description: "Max results, default 10, max 25" },
      },
    },
  },
};

const INTERNSHIP_TOOL = {
  type: "function",
  function: {
    name: "search_internships",
    description: "Search internship applications. Omit filters to list the most recent ones.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search across name, college, and email" },
        status: { type: "string", enum: ["new", "contacted", "closed"] },
        verdict: { type: "string", enum: ["Strong Fit", "Possible Fit", "Not a Fit"] },
        limit: { type: "number", description: "Max results, default 10, max 25" },
      },
    },
  },
};

const OVERVIEW_TOOL = {
  type: "function",
  function: {
    name: "get_overview",
    description: "Get aggregate counts (totals, by status, internship fit breakdown, contact source breakdown) for a quick dashboard-style summary.",
    parameters: { type: "object", properties: {} },
  },
};

async function searchContacts({ query, status, source, limit }) {
  const db = await getDb();
  const filter = {};
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (query?.trim()) {
    const re = new RegExp(escapeRegex(query.trim()), "i");
    filter.$or = [{ name: re }, { matter: re }, { message: re }];
  }
  const docs = await db
    .collection("contacts")
    .find(filter, { projection: { _id: 0 } })
    .sort({ receivedAt: -1 })
    .limit(Math.min(Number(limit) || 10, 25))
    .toArray();
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    phone: d.phone,
    matter: d.matter,
    source: d.source || "unknown",
    status: d.status,
    receivedAt: d.receivedAt,
    message: (d.message || "").slice(0, 300),
  }));
}

async function searchInternships({ query, status, verdict, limit }) {
  const db = await getDb();
  const filter = {};
  if (status) filter.status = status;
  if (verdict) filter.aiVerdict = verdict;
  if (query?.trim()) {
    const re = new RegExp(escapeRegex(query.trim()), "i");
    filter.$or = [{ firstName: re }, { surname: re }, { college: re }, { email: re }];
  }
  const docs = await db
    .collection("internships")
    .find(filter, { projection: { _id: 0 } })
    .sort({ receivedAt: -1 })
    .limit(Math.min(Number(limit) || 10, 25))
    .toArray();
  return docs.map((d) => ({
    id: d.id,
    name: `${d.firstName} ${d.surname}`,
    college: d.college,
    mode: d.mode,
    preferredMonth: d.month,
    status: d.status,
    aiVerdict: d.aiVerdict || "not scored",
    aiScore: d.aiScore,
    aiSummary: d.aiSummary,
    receivedAt: d.receivedAt,
  }));
}

async function getOverview(permissions) {
  const db = await getDb();
  const overview = {};

  if (hasPermission(permissions, "leads_contact")) {
    const col = db.collection("contacts");
    const bySource = await col.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }]).toArray();
    overview.contacts = {
      total: await col.countDocuments(),
      new: await col.countDocuments({ status: "new" }),
      contacted: await col.countDocuments({ status: "contacted" }),
      closed: await col.countDocuments({ status: "closed" }),
      bySource: Object.fromEntries(bySource.map((s) => [s._id || "unknown", s.count])),
    };
  }

  if (hasPermission(permissions, "leads_internship")) {
    const col = db.collection("internships");
    overview.internships = {
      total: await col.countDocuments(),
      new: await col.countDocuments({ status: "new" }),
      strongFit: await col.countDocuments({ aiVerdict: "Strong Fit" }),
      possibleFit: await col.countDocuments({ aiVerdict: "Possible Fit" }),
      notAFit: await col.countDocuments({ aiVerdict: "Not a Fit" }),
    };
  }

  return overview;
}

function buildTools(permissions) {
  const tools = [OVERVIEW_TOOL];
  if (hasPermission(permissions, "leads_contact")) tools.push(CONTACT_TOOL);
  if (hasPermission(permissions, "leads_internship")) tools.push(INTERNSHIP_TOOL);
  return tools;
}

async function runTool(name, args, permissions) {
  if (name === "search_contacts") {
    if (!hasPermission(permissions, "leads_contact")) return { error: "You don't have access to consultation leads." };
    return searchContacts(args);
  }
  if (name === "search_internships") {
    if (!hasPermission(permissions, "leads_internship")) return { error: "You don't have access to internship applications." };
    return searchInternships(args);
  }
  if (name === "get_overview") return getOverview(permissions);
  return { error: "Unknown tool." };
}

const MAX_MESSAGES = 16;
const MAX_CONTENT_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 4;

router.post("/chat", requireAdminAuth, async (req, res) => {
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

  const permissions = req.admin.permissions || [];
  const tools = buildTools(permissions);

  try {
    const convo = [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned];

    let message = await llmChatRaw(convo, { temperature: 0.4, maxTokens: 700, tools });
    let rounds = 0;

    while (message.tool_calls?.length && rounds < MAX_TOOL_ROUNDS) {
      convo.push({ role: "assistant", content: message.content || null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        let result;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          result = await runTool(call.function.name, args, permissions);
        } catch (err) {
          result = { error: `Failed to process: ${err.message}` };
        }
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }

      message = await llmChatRaw(convo, { temperature: 0.4, maxTokens: 700, tools });
      rounds++;
    }

    if (!message.content) throw new LlmError("The AI provider returned an empty response.", 502);
    res.json({ reply: message.content });
  } catch (err) {
    if (err instanceof LlmError) return res.status(err.status).json({ error: err.message });
    console.error("Assistant chat error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
