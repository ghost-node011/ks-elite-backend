import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createStore } from "../lib/store.js";
import { requireAdminAuth, requireSuperAdmin } from "../lib/adminAuth.js";
import { SECTIONS, SECTION_KEYS } from "../lib/permissions.js";
import { isValidEmail } from "../lib/validators.js";

const router = Router();
const usersStore = createStore("adminUsers");

function signToken(payload) {
  return jwt.sign(payload, process.env.ADMIN_JWT_SECRET, { expiresIn: "12h" });
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const secret = process.env.ADMIN_JWT_SECRET;
  const rootUser = process.env.ADMIN_USERNAME;
  const rootHash = process.env.ADMIN_PASSWORD_HASH;

  if (!secret || !rootUser || !rootHash) {
    return res.status(503).json({ error: "Admin auth is not configured on this server." });
  }

  // Root admin (env-based, full access) takes priority so it always works
  // even if the DB is unreachable.
  if (username === rootUser) {
    const valid = await bcrypt.compare(password ?? "", rootHash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password." });
    const token = signToken({ sub: rootUser, email: rootUser, permissions: ["*"], label: "Primary Admin" });
    return res.json({ token });
  }

  // Otherwise look up a created admin user by email.
  const users = await usersStore.all();
  const user = users.find((u) => u.email.toLowerCase() === String(username ?? "").toLowerCase());
  const valid = user && (await bcrypt.compare(password ?? "", user.passwordHash));
  if (!valid) return res.status(401).json({ error: "Invalid username or password." });

  const token = signToken({ sub: user.id, email: user.email, permissions: user.permissions, label: user.label || user.email });
  res.json({ token });
});

router.get("/me", requireAdminAuth, (req, res) => {
  res.json({ email: req.admin.email, permissions: req.admin.permissions, label: req.admin.label });
});

router.get("/sections", requireSuperAdmin, (_req, res) => {
  res.json(SECTIONS);
});

router.get("/users", requireSuperAdmin, async (_req, res) => {
  const users = await usersStore.all();
  res.json(users.map(({ passwordHash, ...rest }) => rest));
});

router.post("/users", requireSuperAdmin, async (req, res) => {
  const { email, password, permissions = [], label = "" } = req.body ?? {};
  if (!email?.trim() || !password?.trim()) return res.status(400).json({ error: "email and password are required." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Please provide a valid email address." });
  if (password.trim().length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const cleanPermissions = Array.isArray(permissions) ? permissions.filter((p) => SECTION_KEYS.includes(p)) : [];

  const existing = await usersStore.all();
  if (existing.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
    return res.status(400).json({ error: "A user with this email already exists." });
  }

  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  const record = await usersStore.append({
    email: email.trim(),
    label: label.trim(),
    passwordHash,
    permissions: cleanPermissions,
  });
  const { passwordHash: _omit, ...safe } = record;
  res.status(201).json(safe);
});

router.put("/users/:id", requireSuperAdmin, async (req, res) => {
  const { permissions, label, password } = req.body ?? {};
  const patch = {};
  if (permissions !== undefined) patch.permissions = Array.isArray(permissions) ? permissions.filter((p) => SECTION_KEYS.includes(p)) : [];
  if (label !== undefined) patch.label = label.trim();
  if (password?.trim()) {
    if (password.trim().length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    patch.passwordHash = bcrypt.hashSync(password.trim(), 10);
  }

  const updated = await usersStore.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  const { passwordHash: _omit, ...safe } = updated;
  res.json(safe);
});

router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  const removed = await usersStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
