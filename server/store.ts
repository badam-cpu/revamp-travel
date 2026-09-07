/**
 * Deliberate architecture upgrade (see CLAUDE.md "Add backend-dependent
 * behavior"): a small store gives the marketplace real, shared persistence
 * for listings without pulling in an external database. It seeds itself once
 * from `shared/listings.ts` and is then the sole source of truth.
 *
 * Two interchangeable backends sit behind one small per-record interface,
 * chosen once at module load:
 *
 *   - FILE backend (default): a single JSON file (`server/data/listings.json`)
 *     with an in-memory cache and a write queue. Used for local development
 *     (`pnpm dev`) and single-process production (`pnpm start`), where the
 *     process is long-lived and the filesystem is writable and persistent.
 *
 *   - NETLIFY BLOBS backend: used when running as a Netlify Function. A
 *     Function's filesystem is read-only/ephemeral, so file persistence would
 *     throw and lose data; Netlify Blobs is a durable, site-scoped store that
 *     needs no separate credentials from inside a Function (the classic-Lambda
 *     handler calls `connectLambda(event)` first — see netlify/functions/api.ts).
 *     Each listing is stored under its OWN key (one blob per listing) rather
 *     than one big JSON array. That matters on serverless: many short-lived
 *     instances handle requests concurrently, and per-key writes can't clobber
 *     each other the way a whole-array read-modify-write would (a create/delete
 *     touches only its own key). There is no in-memory cache on Blobs, so every
 *     instance reads the same durable state.
 *
 * Both backends expose the same all/get/put/del/ensureSeeded primitives, and
 * the create/update/remove/slugify contract used by `server/routes.ts` is built
 * once on top of them.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedListings, type Listing } from "../shared/listings.js";

// process.env.NETLIFY is a *build* variable and isn't reliably present in the
// Functions runtime, so detect the serverless runtime via signals that are:
// NETLIFY_BLOBS_CONTEXT is injected so @netlify/blobs can configure, and the
// AWS Lambda markers are always set for Netlify Functions (read-only fs).
const useBlobs = Boolean(
  process.env.NETLIFY_BLOBS_CONTEXT ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT,
);

/* ------------------------------------------------------------------ */
/* Backend contract — per-record primitives.                          */
/* `ensureSeeded` writes the seed once (idempotent); the CRUD layer     */
/* below builds create/update/remove on top of all/get/put/del.         */
/* ------------------------------------------------------------------ */
interface Backend {
  ensureSeeded(): Promise<void>;
  all(): Promise<Listing[]>;
  get(id: string): Promise<Listing | undefined>;
  put(listing: Listing): Promise<void>;
  del(id: string): Promise<boolean>;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}

/* ------------------------- File backend --------------------------- */
// Single long-lived process: keep the whole catalog in memory, persist the
// whole file, and serialize writes so concurrent requests can't interleave.
// Resolve this module's directory; in a CJS bundle `import.meta.url` is
// undefined, so guard it (the file backend isn't used on Netlify anyway).
const metaUrl: string | undefined = import.meta.url;
const moduleDir = metaUrl ? path.dirname(fileURLToPath(metaUrl)) : process.cwd();
const DATA_DIR = path.resolve(moduleDir, "data");
const DATA_FILE = path.join(DATA_DIR, "listings.json");

let fileCache: Listing[] | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function fileLoad(): Promise<Listing[]> {
  if (fileCache) return fileCache;
  try {
    fileCache = JSON.parse(await fs.readFile(DATA_FILE, "utf-8")) as Listing[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      fileCache = seedListings.map((l) => ({ ...l }));
      await filePersist(fileCache);
    } else {
      throw err;
    }
  }
  return fileCache;
}

async function filePersist(data: Listing[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, DATA_FILE);
}

/** Serialize a mutation of the cached array + persist under the write queue. */
async function fileMutate<T>(mutate: (data: Listing[]) => T): Promise<T> {
  let result!: T;
  writeQueue = writeQueue.then(async () => {
    const data = await fileLoad();
    result = mutate(data);
    await filePersist(data);
  });
  await writeQueue;
  return result;
}

const fileBackend: Backend = {
  async ensureSeeded() {
    await fileLoad(); // fileLoad seeds on ENOENT
  },
  async all() {
    return fileLoad();
  },
  async get(id) {
    return (await fileLoad()).find((l) => l.id === id);
  },
  async put(listing) {
    await fileMutate((data) => {
      const idx = data.findIndex((l) => l.id === listing.id);
      if (idx === -1) data.push(listing);
      else data[idx] = listing;
    });
  },
  async del(id) {
    return fileMutate((data) => {
      const idx = data.findIndex((l) => l.id === id);
      if (idx === -1) return false;
      data.splice(idx, 1);
      return true;
    });
  },
};

/* ------------------------ Netlify Blobs backend -------------------- */
// One blob per listing (key = listing id) plus a marker key recording that the
// seed has run. @netlify/blobs is imported dynamically and only when we're on
// Netlify, so local dev / the build never load it or require its environment.
const BLOB_STORE_NAME = "listings";
const SEED_MARKER_KEY = "__seeded__";
// A previous revision stored the whole catalog as one JSON array under this
// key. New code stores one blob per listing, so this legacy key is skipped by
// all() and removed during seeding migration.
const LEGACY_ARRAY_KEY = "listings.json";

// Minimal structural type so this module type-checks without coupling to the
// package's exported types; the real object is cast in.
interface BlobStore {
  get(key: string): Promise<string | null>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<{ blobs: { key: string }[] }>;
}

let blobStore: BlobStore | null = null;

async function getBlobStore(): Promise<BlobStore> {
  if (!blobStore) {
    const { getStore } = await import("@netlify/blobs");
    blobStore = getStore(BLOB_STORE_NAME) as unknown as BlobStore;
  }
  return blobStore;
}

const blobBackend: Backend = {
  async ensureSeeded() {
    const store = await getBlobStore();
    const marker = await store.get(SEED_MARKER_KEY);
    if (marker) return;
    // Remove any legacy single-array blob from the previous revision so its
    // contents don't leak into all() as a bogus listing.
    if ((await store.get(LEGACY_ARRAY_KEY)) != null) {
      await store.delete(LEGACY_ARRAY_KEY);
    }
    // Seed once: write each listing under its own key, then set the marker so
    // deleting every listing later does NOT trigger a reseed (mirrors the file
    // backend, where an empty-but-existing file is never reseeded).
    for (const listing of seedListings) {
      await store.setJSON(listing.id, listing);
    }
    await store.set(SEED_MARKER_KEY, new Date().toISOString());
  },
  async all() {
    const store = await getBlobStore();
    const { blobs } = await store.list();
    const listings: Listing[] = [];
    for (const { key } of blobs) {
      if (key === SEED_MARKER_KEY || key === LEGACY_ARRAY_KEY) continue;
      const value = (await store.get(key, { type: "json" })) as Listing | null;
      if (value) listings.push(value);
    }
    return listings;
  },
  async get(id) {
    const store = await getBlobStore();
    const value = (await store.get(id, { type: "json" })) as Listing | null;
    return value ?? undefined;
  },
  async put(listing) {
    const store = await getBlobStore();
    await store.setJSON(listing.id, listing);
  },
  async del(id) {
    const store = await getBlobStore();
    const existing = await store.get(id);
    if (existing == null) return false;
    await store.delete(id);
    return true;
  },
};

const backend: Backend = useBlobs ? blobBackend : fileBackend;

/* ------------------------------------------------------------------ */
/* CRUD contract used by server/routes.ts (backend-agnostic)          */
/* ------------------------------------------------------------------ */
export async function listAll(): Promise<Listing[]> {
  await backend.ensureSeeded();
  return backend.all();
}

export async function getById(id: string): Promise<Listing | undefined> {
  await backend.ensureSeeded();
  return backend.get(id);
}

export async function create(input: Omit<Listing, "id" | "slug">): Promise<Listing> {
  await backend.ensureSeeded();
  const existing = await backend.all();
  const base = slugify(input.title);
  const existingSlugs = new Set(existing.map((l) => l.slug));
  let slug = base;
  let n = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${n++}`;
  }
  const id = `${input.type}-${slug}`;
  const listing: Listing = { ...input, id, slug };
  await backend.put(listing);
  return listing;
}

export async function update(
  id: string,
  patch: Partial<Omit<Listing, "id" | "slug">>,
): Promise<Listing | undefined> {
  await backend.ensureSeeded();
  const existing = await backend.get(id);
  if (!existing) return undefined;
  const updated: Listing = { ...existing, ...patch };
  await backend.put(updated);
  return updated;
}

export async function remove(id: string): Promise<boolean> {
  await backend.ensureSeeded();
  return backend.del(id);
}
