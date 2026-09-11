import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";

import { userRoutes } from "./routes/user_routes.ts";
import { corpusRoutes } from "./routes/corpus_routes.ts";

// strict: false so `/api/users` and `/api/users/` both match — the frontend
// API client calls the trailing-slash form.
const app = new Hono({ strict: false });

// --- CORS ---
const rawOrigins = process.env.ALLOWED_ORIGINS ?? "";
const origins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "/*",
  cors({
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Conversation-Id"],
    credentials: true,
  }),
);

// --- Routes ---
app.route("/api/users", userRoutes);
// Read-only views over harvested runs. Harvesting itself stays in the CLI.
app.route("/api/corpus", corpusRoutes);

app.get("/", (c) => c.json({ message: "Hello World" }));

// --- Server ---
const port = Number(process.env.PORT) || 8000;

console.log(`Starting server on http://0.0.0.0:${port}`);
serve({ fetch: app.fetch, port });
