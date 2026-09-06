import { Router } from "express";
import { createStore } from "../lib/store.js";
import { notifyLead } from "../lib/mailer.js";
import { requirePermission } from "../lib/adminAuth.js";
import { classifyEnquirySource } from "../lib/enquirySource.js";

const store = createStore("contacts");
const router = Router();

router.post("/", async (req, res) => {
  const { name, phone, matter = "", message } = req.body ?? {};

  if (!name?.trim() || !phone?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "name, phone, and message are required." });
  }

  const source = await classifyEnquirySource({ message: message.trim(), matter: matter.trim() });

  const record = await store.append({
    name: name.trim(),
    phone: phone.trim(),
    matter: matter.trim(),
    message: message.trim(),
    status: "new",
    source,
  });

  notifyLead(`New consultation request — ${record.name}`, [
    `Name: ${record.name}`,
    `Phone: ${record.phone}`,
    `Matter: ${record.matter || "—"}`,
    `Message: ${record.message}`,
    `Received: ${record.receivedAt}`,
  ]);

  res.status(201).json({ ok: true, id: record.id });
});

router.get("/", requirePermission("leads_contact"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(await store.paginate({ page, limit }));
});

router.patch("/:id", requirePermission("leads_contact"), async (req, res) => {
  const { status } = req.body ?? {};
  if (!["new", "contacted", "closed"].includes(status)) {
    return res.status(400).json({ error: "status must be one of: new, contacted, closed" });
  }
  const updated = await store.update(req.params.id, { status });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/:id", requirePermission("leads_contact"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
