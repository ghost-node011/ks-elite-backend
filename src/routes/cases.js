import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";
import { isValidEmail, isValidPhone } from "../lib/validators.js";

const store = createStore("cases");
const router = Router();

async function nextCaseNumber() {
  const all = await store.all();
  return all.reduce((max, c) => Math.max(max, c.caseNumber || 0), 0) + 1;
}

router.get("/admin/all", requirePermission("cases"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const filter = {};
  if (req.query.name?.trim()) {
    filter.caseName = { $regex: req.query.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  if (req.query.nextDate?.trim()) {
    filter.nextDate = req.query.nextDate.trim();
  }

  res.json(await store.paginate({ page, limit, filter }));
});

router.get("/admin/:id", requirePermission("cases"), async (req, res) => {
  const all = await store.all();
  const item = all.find((c) => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.post("/admin", requirePermission("cases"), async (req, res) => {
  const {
    caseName,
    lastDate = "",
    nextDate = "",
    email = "",
    clientMobile = "",
    courtName = "",
    courtNo = "",
    remark = "",
    document = null,
  } = req.body ?? {};
  if (!caseName?.trim()) return res.status(400).json({ error: "caseName is required." });
  if (email?.trim() && !isValidEmail(email)) return res.status(400).json({ error: "Please provide a valid email address." });
  if (clientMobile?.trim() && !isValidPhone(clientMobile)) return res.status(400).json({ error: "Please provide a valid client mobile number." });

  const record = await store.append({
    caseNumber: await nextCaseNumber(),
    caseName: caseName.trim(),
    lastDate,
    nextDate,
    email: email.trim(),
    clientMobile: clientMobile.trim(),
    courtName: courtName.trim(),
    courtNo: courtNo.trim(),
    remark: remark.trim(),
    document,
  });
  res.status(201).json(record);
});

router.put("/admin/:id", requirePermission("cases"), async (req, res) => {
  const { caseName, lastDate, nextDate, email, clientMobile, courtName, courtNo, remark, document } = req.body ?? {};
  if (email?.trim() && !isValidEmail(email)) return res.status(400).json({ error: "Please provide a valid email address." });
  if (clientMobile?.trim() && !isValidPhone(clientMobile)) return res.status(400).json({ error: "Please provide a valid client mobile number." });

  const patch = {};
  if (caseName !== undefined) patch.caseName = caseName.trim();
  if (lastDate !== undefined) patch.lastDate = lastDate;
  if (nextDate !== undefined) patch.nextDate = nextDate;
  if (email !== undefined) patch.email = email.trim();
  if (clientMobile !== undefined) patch.clientMobile = clientMobile.trim();
  if (courtName !== undefined) patch.courtName = courtName.trim();
  if (courtNo !== undefined) patch.courtNo = courtNo.trim();
  if (remark !== undefined) patch.remark = remark.trim();
  if (document !== undefined) patch.document = document;

  const updated = await store.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// The current nextDate becomes lastDate (the hearing that just happened),
// and the newly given date becomes the new nextDate — logs the adjournment
// without needing a separate history collection.
router.post("/admin/:id/add-date", requirePermission("cases"), async (req, res) => {
  const { nextDate } = req.body ?? {};
  if (!nextDate) return res.status(400).json({ error: "nextDate is required." });

  const all = await store.all();
  const existing = all.find((c) => c.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await store.update(req.params.id, { lastDate: existing.nextDate || existing.lastDate, nextDate });
  res.json(updated);
});

router.delete("/admin/:id", requirePermission("cases"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
