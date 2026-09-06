import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";
import { requirePermission } from "../lib/adminAuth.js";
import { saveFile } from "../lib/uploads.js";
import { analyzeResume } from "../lib/resumeAnalysis.js";
import { getDb } from "../lib/db.js";
import { isValidEmail, isValidPhone } from "../lib/validators.js";

const store = createStore("internships");
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const REQUIRED_FIELDS = ["firstName", "surname", "college", "email", "contact", "gender", "dob", "month"];

// Browsers infer File.type/originalname from the extension, not the actual
// bytes — a .docx renamed to .pdf reports as "application/pdf" and sails
// through client-side checks. Only the magic-number header is trustworthy.
const PDF_MAGIC = Buffer.from("%PDF-");
const isPdfBuffer = (buffer) => buffer.length > PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);

router.post("/", upload.single("resume"), async (req, res) => {
  const body = req.body ?? {};
  const missing = REQUIRED_FIELDS.filter((key) => !String(body[key] ?? "").trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }
  if (!isValidEmail(body.email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (!isValidPhone(body.contact)) {
    return res.status(400).json({ error: "Please provide a valid contact number." });
  }

  let resumeUrl = null;
  let resumeText = "";
  let resumeRejected = false;
  if (req.file) {
    if (!isPdfBuffer(req.file.buffer)) {
      resumeRejected = true;
      console.warn(`Rejected non-PDF resume upload (name="${req.file.originalname}", mimetype=${req.file.mimetype})`);
    } else {
      try {
        resumeUrl = await saveFile(req.file.buffer, req.file.originalname || "resume.pdf", req.file.mimetype);
        const parsed = await pdfParse(req.file.buffer);
        resumeText = parsed.text || "";
      } catch (err) {
        console.error("Resume upload/parse failed:", err.message);
      }
    }
  }

  // Scored before saving, not after responding — Vercel can freeze a serverless
  // function immediately once the response is sent, so "fire and forget after
  // res.json()" would silently never run there. This adds real latency to the
  // request instead (a few seconds for the LLM call), which is the correct trade.
  let aiResult = null;
  if (resumeText.trim()) {
    aiResult = await analyzeResume({ resumeText, college: body.college.trim(), mode: (body.mode ?? "Offline").trim(), month: body.month.trim() });
  }

  const record = await store.append({
    firstName: body.firstName.trim(),
    surname: body.surname.trim(),
    preferredName: (body.preferredName ?? "").trim(),
    college: body.college.trim(),
    email: body.email.trim(),
    contact: body.contact.trim(),
    gender: body.gender.trim(),
    mode: (body.mode ?? "Offline").trim(),
    dob: body.dob.trim(),
    month: body.month.trim(),
    resumeUrl,
    aiScore: aiResult?.score ?? null,
    aiVerdict: aiResult?.verdict ?? null,
    aiSummary: aiResult?.summary ?? null,
    status: "new",
  });

  notifyLead(`New internship application — ${record.firstName} ${record.surname}`, [
    `Name: ${record.firstName} ${record.surname} (${record.preferredName || "—"})`,
    `College: ${record.college}`,
    `Email: ${record.email}`,
    `Contact: ${record.contact}`,
    `Gender: ${record.gender}`,
    `Mode of Internship: ${record.mode}`,
    `DOB: ${record.dob}`,
    `Preferred month: ${record.month}`,
    `Resume: ${resumeUrl || (resumeRejected ? "rejected — uploaded file was not a valid PDF" : "not provided")}`,
    aiResult ? `AI assessment: ${aiResult.verdict} (${aiResult.score}/100) — ${aiResult.summary}` : null,
    `Received: ${record.receivedAt}`,
  ].filter(Boolean));

  res.status(201).json({ ok: true, id: record.id });
});

router.get("/", requirePermission("leads_internship"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const filter = {};
  if (req.query.year) {
    const y = String(req.query.year).slice(0, 4);
    const m = req.query.month ? String(req.query.month).padStart(2, "0") : "";
    filter.receivedAt = { $regex: `^${y}${m ? `-${m}` : ""}` };
  }

  res.json(await store.paginate({ page, limit, filter }));
});

// Groups applications by received year/month so the admin can keep older
// years collapsed to a single total and only drill into months for the
// current, still-active year.
router.get("/summary", requirePermission("leads_internship"), async (_req, res) => {
  const db = await getDb();
  const col = db.collection("internships");
  const currentYear = String(new Date().getFullYear());

  const rows = await col
    .aggregate([
      { $project: { year: { $substrCP: ["$receivedAt", 0, 4] }, month: { $substrCP: ["$receivedAt", 0, 7] } } },
      { $group: { _id: { year: "$year", month: "$month" }, count: { $sum: 1 } } },
    ])
    .toArray();

  const byYear = {};
  for (const r of rows) {
    const { year, month } = r._id;
    byYear[year] ??= { year: Number(year), count: 0, months: {} };
    byYear[year].count += r.count;
    byYear[year].months[month] = (byYear[year].months[month] || 0) + r.count;
  }

  const years = Object.values(byYear)
    .map((y) => {
      if (String(y.year) !== currentYear) return { year: y.year, count: y.count };
      const months = Object.entries(y.months)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => {
          const [yy, mm] = key.split("-").map(Number);
          const label = new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
          return { key, label, count };
        });
      return { year: y.year, count: y.count, months };
    })
    .sort((a, b) => b.year - a.year);

  res.json({ currentYear: Number(currentYear), years });
});

router.patch("/:id", requirePermission("leads_internship"), async (req, res) => {
  const { status } = req.body ?? {};
  if (!["new", "contacted", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: new, contacted, closed" });
  }
  const updated = await store.update(req.params.id, { status });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/:id", requirePermission("leads_internship"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
