/**
 * Deliberate architecture upgrade (see CLAUDE.md "Add backend-dependent
 * behavior"): a small store gives the marketplace real, shared persistence
 * for listings without pulling in an external database. It seeds itself once
 * from `shared/listings.ts` and is then the sole source of truth — editing
 * the seed file after that has no effect on a running deployment.
 *
 * Two interchangeable backends sit behind one small interface. Which one is
 * used is decided once at module load:
 *
 *   - FILE backend (default): a single JSON file (`server/data/listings.json`)
 *     with an in-memory cache and a write queue. Used for local development
 *     (`pnpm dev`) and single-process production (`pnpm start`), where the
 *     process is long-lived and the filesystem is writable and persistent.
 *
 *   - NETLIFY BLOBS backend: used when running as a Netlify Function, detected
 *     via `process.env.NETLIFY` (Netlify sets this in the Functions runtime).
 *     A Netlify Function's filesystem is ephemeral (`/tmp` is wiped between
 *     invocations), so file persistence would silently lose data; Netlify
 *     Blobs is a durable, site-scoped key/value store that needs no separate
 *     credentials from inside a Function. We keep the whole catalog as one
 *     JSON blob, mirroring the single-file model.
 *
 * Both backends expose the exact same read/create/update/remove/slugify
 * contract, so `server/routes.ts` doesn't know or care which is active.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedListings, type Listing } from "../shared/listings.js";

// Decide the storage backend at load. We must use Blobs whenever we're running
// inside a Netlify Function (its filesystem is read-only/ephemeral — the file
// backend throws `ENOENT: mkdir '/var/task/data'` there).
//
// NOTE: `process.env.NETLIFY` is set during Netlify *builds* but is NOT reliably
// present in the *Functions runtime*, so it can't be the detector on its own.
// The runtime signals below are what's actually available inside the function:
//   - NETLIFY_BLOBS_CONTEXT: injected by the Functions runtime specifically so
//     @netlify/blobs can auto-configure — its presence means Blobs is ready.
//   - AWS_LAMBDA_FUNCTION_NAME / LAMBDA_TASK_ROOT: Netlify Functions execute on
//     AWS Lambda, where the filesystem is read-only, so Blobs is the only option.
const useBlobs = Boolean(
  process.env.NETLIFY_BLOBS_CONTEXT ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT,
);

/* ------------------------------------------------------------------ */
/* Backend interface                                                   */
/* A backend just loads the whole catalog or persists the whole catalog.*/
/* `read()` returns null when the store has never been initialized      */
/* (mirrors the file backend's ENOENT-means-seed-fresh behavior).       */
/* ------------------------------------------------------------------ */
interface Backend {
  read(): Promise<Listing[] | null>;
  write(data: Listing[]): Promise<void>;
}

/* ------------------------- File backend --------------------------- */
// Resolve this module's directory. In ESM (local dev, `pnpm start`, the
// esbuild server bundle) `import.meta.url` is a file URL. When this module is
// bundled into a CommonJS Netlify Function, esbuild replaces `import.meta.url`
// with `undefined`, so guard it and fall back — the file backend is never used
// on Netlify (Blobs is), so the fallback path is only a safe placeholder.
const metaUrl: string | undefined = import.meta.url;
const moduleDir = metaUrl ? path.dirname(fileURLToPath(metaUrl)) : process.cwd();
const DATA_DIR = path.resolve(moduleDir, "data");
const DATA_FILE = path.join(DATA_DIR, "listings.json");

const fileBackend: Backend = {
  async read() {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf-8");
      return JSON.parse(raw) as Listing[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async write(data) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmp, DATA_FILE);
  },
};

/* ------------------------ Netlify Blobs backend -------------------- */
// A single store holding one JSON blob is the source of truth. Inside a
// Netlify Function `getStore(name)` is automatically scoped to the site and
// needs no explicit credentials. The `@netlify/blobs` import is dynamic and
// gated behind `useBlobs` so it is never loaded (and never demands a Netlify
// environment) during local dev, `pnpm start`, or the build.
const BLOB_STORE_NAME = "listings";
const BLOB_KEY = "listings.json";

// Minimal structural type so this module type-checks (`pnpm check`) without
// coupling to the package's exported types; the real object is cast in.
interface BlobStore {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<void>;
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
  async read() {
    const store = await getBlobStore();
    const data = (await store.get(BLOB_KEY, { type: "json" })) as Listing[] | null;
    return data ?? null;
  },
  async write(data) {
    const store = await getBlobStore();
    await store.setJSON(BLOB_KEY, data);
  },
};

const backend: Backend = useBlobs ? blobBackend : fileBackend;

/* ------------------------------------------------------------------ */
/* Shared logic                                                        */
/* ------------------------------------------------------------------ */
// In-memory cache is used ONLY for the file backend (a single long-lived
// process where the file is the private source of truth). It is deliberately
// NOT used for Blobs: on Netlify the API runs across many short-lived function
// instances, so a per-instance cache would serve stale data (a create on one
// instance would be invisible to reads on another) and risk lost updates.
// With Blobs we always read the shared store fresh, so every instance sees the
// same catalog and read-modify-write mutations act on current data.
let cache: Listing[] | null = null;
// Serializes writes so two near-simultaneous requests on the same instance
// can't clobber each other.
let writeQueue: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<Listing[]> {
  if (!useBlobs && cache) return cache;
  const existing = await backend.read();
  let data: Listing[];
  if (existing) {
    data = existing;
  } else {
    // First run: seed from shared/listings.ts and persist, then it's the
    // source of truth (mirrors the old ENOENT-seeds-fresh-file behavior).
    data = seedListings.map((listing) => ({ ...listing }));
    await backend.write(data);
  }
  if (!useBlobs) cache = data;
  return data;
}

async function persist(data: Listing[]): Promise<void> {
  await backend.write(data);
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

export async function listAll(): Promise<Listing[]> {
  const data = await ensureLoaded();
  return data;
}

export async function getById(id: string): Promise<Listing | undefined> {
  const data = await ensureLoaded();
  return data.find((listing) => listing.id === id);
}

/** Runs `mutate` against the current data under the write queue and persists the result. */
async function withStore<T>(mutate: (data: Listing[]) => T): Promise<T> {
  let result!: T;
  writeQueue = writeQueue.then(async () => {
    const data = await ensureLoaded();
    result = mutate(data);
    await persist(data);
  });
  await writeQueue;
  return result;
}

export async function create(input: Omit<Listing, "id" | "slug">): Promise<Listing> {
  return withStore((data) => {
    const base = slugify(input.title);
    const existingSlugs = new Set(data.map((l) => l.slug));
    let slug = base;
    let n = 2;
    while (existingSlugs.has(slug)) {
      slug = `${base}-${n++}`;
    }
    const id = `${input.type}-${slug}`;
    const listing: Listing = { ...input, id, slug };
    data.push(listing);
    return listing;
  });
}

export async function update(id: string, patch: Partial<Omit<Listing, "id" | "slug">>): Promise<Listing | undefined> {
  return withStore((data) => {
    const idx = data.findIndex((l) => l.id === id);
    if (idx === -1) return undefined;
    data[idx] = { ...data[idx], ...patch };
    return data[idx];
  });
}

export async function remove(id: string): Promise<boolean> {
  return withStore((data) => {
    const idx = data.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    data.splice(idx, 1);
    return true;
  });
}
