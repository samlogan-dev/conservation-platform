import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

export const supabase = createClient(supabaseUrl, supabaseSecretKey);

// Environment-specific variables
export const FRONTEND_URL =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

console.log("Configuration loaded.");
