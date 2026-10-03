import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";

// strict: false so `/api/x` and `/api/x/` both match.
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
// None yet beyond the health check. The analysis and portal routes are rebuilt around the
// practitioner insights once those are defined; ingestion runs from the CLI meanwhile.
app.get("/", (c) => c.json({ status: "ok" }));

// --- Server ---
const port = Number(process.env.PORT) || 8000;

console.log(`Starting server on http://0.0.0.0:${port}`);
serve({ fetch: app.fetch, port });
