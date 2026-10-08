import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const envText = await readFile(".env.local", "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, "")];
    })
);

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { error: deleteError } = await client.from("returns").delete().not("id", "is", null);
if (deleteError) throw deleteError;

const { count, error: countError } = await client
  .from("returns")
  .select("id", { count: "exact", head: true });
if (countError) throw countError;
console.log(`Remaining return records: ${count ?? 0}`);
