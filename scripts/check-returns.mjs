import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const text = await readFile(".env.local", "utf8");
const env = Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.from("returns").select("id, order_id, customer_name, status, created_at").order("created_at", { ascending: false });
if (error) throw error;
console.log(JSON.stringify(data));
