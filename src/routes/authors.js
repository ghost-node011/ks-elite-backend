import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";

const store = createStore("authors");
const router = Router();

// Reusable author profiles (name, photo, bio, LinkedIn) so staff pick from a
// saved list instead of re-typing/re-uploading the same author on every post.
// A post stores a denormalized snapshot of these fields at save time, so
// editing an author here doesn't retroactively change already-published posts.

router.get("/admin", requirePermission("posts"), async (_req, res) => {
  const all = await store.all();
  res.json(all.slice().sort((a, b) => a.name.localeCompare(b.name)));
});

router.post("/admin", requirePermission("posts"), async (req, res) => {
  const { name, image = null, description = "", linkedin = "" } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "name is required." });

  const record = await store.append({
    name: name.trim(),
    image,
    description: description.trim(),
    linkedin: linkedin.trim(),
  });
  res.status(201).json(record);
});

router.put("/admin/:id", requirePermission("posts"), async (req, res) => {
  const { name, image, description, linkedin } = req.body ?? {};
  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (image !== undefined) patch.image = image;
  if (description !== undefined) patch.description = description.trim();
  if (linkedin !== undefined) patch.linkedin = linkedin.trim();

  const updated = await store.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/admin/:id", requirePermission("posts"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
