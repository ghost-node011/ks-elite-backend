import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";
import { isValidEmail } from "../lib/validators.js";

const store = createStore("subscribers");
const router = Router();

router.post("/", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ error: "A valid email is required." });

  const existing = await store.all();
  if (existing.some((s) => s.email === email)) {
    return res.status(200).json({ ok: true, alreadySubscribed: true });
  }

  await store.append({ email });
  res.status(201).json({ ok: true });
});

router.get("/", requirePermission("subscribers"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(await store.paginate({ page, limit }));
});

router.delete("/:id", requirePermission("subscribers"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
