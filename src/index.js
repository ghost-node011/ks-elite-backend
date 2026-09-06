import "dotenv/config";
import express from "express";
import cors from "cors";
import contactRouter from "./routes/contact.js";
import internshipRouter from "./routes/internship.js";
import adminAuthRouter from "./routes/adminAuth.js";
import chatRouter from "./routes/chat.js";
import postsRouter from "./routes/posts.js";
import aiRouter from "./routes/ai.js";
import assistantRouter from "./routes/assistant.js";
import authorsRouter from "./routes/authors.js";
import parseDocRouter from "./routes/parseDoc.js";
import uploadImageRouter from "./routes/uploadImage.js";
import teamRouter from "./routes/team.js";
import testimonialsRouter from "./routes/testimonials.js";
import subscribersRouter from "./routes/subscribers.js";
import casesRouter from "./routes/cases.js";
import uploadFileRouter from "./routes/uploadFile.js";
import analyticsRouter from "./routes/analytics.js";
import { UPLOADS_DIR, FILES_DIR } from "./lib/uploads.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/files", express.static(FILES_DIR));

app.get("/", (_req, res) => res.json({ ok: true, service: "KS Elite Attorneys API", status: "live" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/contact", contactRouter);
app.use("/api/internship", internshipRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/chat", chatRouter);
app.use("/api/posts", postsRouter);
app.use("/api/admin/ai", aiRouter);
app.use("/api/admin/assistant", assistantRouter);
app.use("/api/admin/authors", authorsRouter);
app.use("/api/parse-doc", parseDocRouter);
app.use("/api/admin/upload-image", uploadImageRouter);
app.use("/api/team", teamRouter);
app.use("/api/testimonials", testimonialsRouter);
app.use("/api/subscribers", subscribersRouter);
app.use("/api/cases", casesRouter);
app.use("/api/admin/upload-file", uploadFileRouter);
app.use("/api/admin/analytics", analyticsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 30MB)." });
  res.status(500).json({ error: "Internal server error" });
});

// Vercel imports this module as a serverless function handler and calls it directly —
// only bind a real port when running locally (node src/index.js / npm run dev).
if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`KS Elite Attorneys API listening on http://localhost:${port}`);
  });
}

export default app;
