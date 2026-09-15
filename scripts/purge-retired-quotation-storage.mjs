import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

const RETIRED_BUCKETS = [
  "price-quotation-endorsements",
  "quotation-signed-proofs",
];
const PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 1000;
const dryRun = process.argv.includes("--dry-run");

async function loadLocalEnv() {
  try {
    const contents = await readFile(
      new URL("../.env.local", import.meta.url),
      "utf8",
    );

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(
        /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
      );
      if (!match || process.env[match[1]]) continue;

      let value = match[2].trim();
      const first = value[0];
      const last = value[value.length - 1];
      if (
        value.length >= 2 &&
        ((first === '"' && last === '"') || (first === "'" && last === "'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function listBucketObjects(storage, bucketId, prefix = "") {
  const objectPaths = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.from(bucketId).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(
        "Could not list Storage bucket " + bucketId + ": " + error.message,
      );
    }

    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.id === null) {
        objectPaths.push(...(await listBucketObjects(storage, bucketId, path)));
      } else {
        objectPaths.push(path);
      }
    }

    if (entries.length < PAGE_SIZE) break;
    offset += entries.length;
  }

  return objectPaths;
}

async function listBuckets(storage) {
  const { data, error } = await storage.listBuckets();
  if (error) throw new Error("Could not list Storage buckets: " + error.message);
  return data ?? [];
}

async function main() {
  await loadLocalEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required and must stay server-side",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const storage = supabase.storage;
  const buckets = await listBuckets(storage);
  const plan = [];

  for (const bucketId of RETIRED_BUCKETS) {
    const bucket = buckets.find((candidate) => candidate.id === bucketId);
    if (!bucket) {
      plan.push({ bucketId, exists: false, objectPaths: [] });
      continue;
    }

    plan.push({
      bucketId,
      exists: true,
      objectPaths: await listBucketObjects(storage, bucketId),
    });
  }

  console.log(
    (dryRun ? "[dry-run] " : "") +
      "Retired quotation storage cleanup targets only: " +
      RETIRED_BUCKETS.join(", "),
  );
  for (const item of plan) {
    console.log(
      " - " +
        item.bucketId +
        ": " +
        (item.exists ? item.objectPaths.length + " object(s)" : "bucket already absent"),
    );
  }

  if (dryRun) return;

  for (const item of plan) {
    if (!item.exists) continue;

    for (
      let start = 0;
      start < item.objectPaths.length;
      start += REMOVE_BATCH_SIZE
    ) {
      const batch = item.objectPaths.slice(start, start + REMOVE_BATCH_SIZE);
      const { error } = await storage.from(item.bucketId).remove(batch);
      if (error) {
        throw new Error(
          "Could not remove objects from " +
            item.bucketId +
            ": " +
            error.message,
        );
      }
      console.log(
        "Removed " +
          Math.min(start + batch.length, item.objectPaths.length) +
          "/" +
          item.objectPaths.length +
          " object(s) from " +
          item.bucketId,
      );
    }

    const remaining = await listBucketObjects(storage, item.bucketId);
    if (remaining.length > 0) {
      throw new Error(
        item.bucketId +
          " still contains " +
          remaining.length +
          " object(s); the bucket was not deleted",
      );
    }

    const { error } = await storage.deleteBucket(item.bucketId);
    if (error) {
      throw new Error(
        "Could not delete Storage bucket " +
          item.bucketId +
          ": " +
          error.message,
      );
    }
    console.log("Deleted Storage bucket " + item.bucketId);
  }

  const remainingBuckets = await listBuckets(storage);
  const stillPresent = remainingBuckets
    .filter((bucket) => RETIRED_BUCKETS.includes(bucket.id))
    .map((bucket) => bucket.id);
  if (stillPresent.length > 0) {
    throw new Error(
      "Retired Storage buckets still exist: " + stillPresent.join(", "),
    );
  }

  console.log(
    "Storage API cleanup complete. You can now run " +
      "supabase/152_remove_legacy_quotation_proof_features.sql.",
  );
}

main().catch((error) => {
  console.error("[retired quotation storage cleanup] " + error.message);
  process.exitCode = 1;
});
