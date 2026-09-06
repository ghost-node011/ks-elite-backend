import { Router } from "express";
import { createStore } from "../lib/store.js";
import { requirePermission } from "../lib/adminAuth.js";
import { invalidateSiteKnowledge } from "../lib/siteKnowledge.js";
import { getDb } from "../lib/db.js";

const store = createStore("posts");
const router = Router();

// Any write here changes what the chatbot should know — drop its cached
// site-knowledge prompt so the next chat request picks up fresh data.
router.use("/admin", (req, _res, next) => {
  if (req.method !== "GET") invalidateSiteKnowledge();
  next();
});

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(base, ignoreId = null) {
  const all = await store.all();
  let slug = base || "post";
  let n = 2;
  while (all.some((p) => p.slug === slug && p.id !== ignoreId)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

// ── public ───────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const all = await store.all();
  const published = all.filter((p) => p.published).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(published);
});

router.get("/:slug", async (req, res) => {
  const all = await store.all();
  const post = all.find((p) => p.slug === req.params.slug && p.published);
  if (!post) return res.status(404).json({ error: "Not found" });

  const db = await getDb();
  await db.collection("posts").updateOne({ id: post.id }, { $inc: { views: 1 } });

  res.json({ ...post, views: (post.views || 0) + 1 });
});

// ── admin ────────────────────────────────────────────────────────────────

router.get("/admin/all", requirePermission("posts"), async (_req, res) => {
  const all = await store.all();
  res.json(all.slice().sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)));
});

router.get("/admin/:id", requirePermission("posts"), async (req, res) => {
  const all = await store.all();
  const post = all.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json(post);
});

router.post("/admin", requirePermission("posts"), async (req, res) => {
  const {
    title,
    category,
    excerpt = "",
    sections = [],
    heroImage = null,
    published = false,
    authorName = "",
    authorLinkedIn = "",
    authorImage = null,
    authorDescription = "",
  } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "title is required." });

  const slug = await uniqueSlug(slugify(title));
  const record = await store.append({
    title: title.trim(),
    slug,
    category: category || "Laws",
    excerpt: excerpt.trim(),
    heroImage,
    sections,
    authorName: authorName.trim(),
    authorLinkedIn: authorLinkedIn.trim(),
    authorImage,
    authorDescription: authorDescription.trim(),
    date: new Date().toISOString(),
    published: Boolean(published),
    updatedAt: new Date().toISOString(),
    views: 0,
  });
  res.status(201).json(record);
});

router.put("/admin/:id", requirePermission("posts"), async (req, res) => {
  const { title, category, excerpt, sections, heroImage, published, authorName, authorLinkedIn, authorImage, authorDescription } =
    req.body ?? {};
  const all = await store.all();
  const existing = all.find((p) => p.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const patch = { updatedAt: new Date().toISOString() };
  if (title !== undefined && title.trim() && title.trim() !== existing.title) {
    patch.title = title.trim();
    patch.slug = await uniqueSlug(slugify(title.trim()), existing.id);
  } else if (title !== undefined) {
    patch.title = title.trim();
  }
  if (category !== undefined) patch.category = category;
  if (excerpt !== undefined) patch.excerpt = excerpt.trim();
  if (sections !== undefined) patch.sections = sections;
  if (heroImage !== undefined) patch.heroImage = heroImage;
  if (published !== undefined) patch.published = Boolean(published);
  if (authorName !== undefined) patch.authorName = authorName.trim();
  if (authorLinkedIn !== undefined) patch.authorLinkedIn = authorLinkedIn.trim();
  if (authorImage !== undefined) patch.authorImage = authorImage;
  if (authorDescription !== undefined) patch.authorDescription = authorDescription.trim();

  const updated = await store.update(req.params.id, patch);
  res.json(updated);
});

router.delete("/admin/:id", requirePermission("posts"), async (req, res) => {
  const removed = await store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
