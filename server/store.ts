/**
 * Deliberate architecture upgrade (see CLAUDE.md "Add backend-dependent
 * behavior"): a small store gives the marketplace real, shared persistence
 * for listings without pulling in an external database. It seeds itself once
 * from `shared/listings.ts` and is then the sole source of truth.
 *
 * Two interchangeable backends sit behind one small read/write interface,
 * chosen once at module load:
 *
 *   - FILE backend (default): a single JSON file (`server/data/listings.json`)
 *     with an in-memory cache and a write queue. Used for local development
 *     (`pnpm dev`) and single-process production (`pnpm start`), where the
 *     process is long-lived and the filesystem is writable and persistent.
 *
 *   - NETLIFY BLOBS backend: used when running as a Netlify Function, whose
 *     filesystem is read-only/ephemeral. The whole catalog is stored as ONE
 *     JSON blob under a single key. This is deliberate: Netlify Blobs gives
 *     strong read-after-write consistency for a `get()` of a single key, but
 *     `list()` is only eventually consistent (a newly written key can take
 *     ~30s to appear). A one-blob-per-listing scheme would therefore make a
 *     freshly created listing invisible on /explore for that whole window.
 *     Keeping everything under one key means every read reflects the latest
 *     write immediately. Writes are a whole-array read-modify-write; that is
 *     safe here because the only writer is the /manage admin flow (no
 *     concurrent writers in practice), and the one-time bulk import spaces its
 *     writes. There is no in-memory cache on Blobs, so every function instance
 *     reads the same durable state.
 *
 * Both backends expose the same read/write contract, and the
 * create/update/remove/slugify logic used by `server/routes.ts` is built once
 * on top of them.
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
/* Backend contract: load the whole catalog or persist the whole       */
/* catalog. read() returns null when the store is uninitialized         */
/* (mirrors the file backend's ENOENT-means-seed-fresh behavior).       */
/* ------------------------------------------------------------------ */
interface Backend {
  read(): Promise<Listing[] | null>;
  write(data: Listing[]): Promise<void>;
}

/* ------------------------- File backend --------------------------- */
// Resolve this module's directory. In ESM (local dev, `pnpm start`, the
// esbuild server bundle) `import.meta.url` is a file URL; when bundled into a
// CommonJS Netlify Function esbuild replaces it with undefined, so guard it —
// the file backend is never used on Netlify anyway.
const metaUrl: string | undefined = import.meta.url;
const moduleDir = metaUrl ? path.dirname(fileURLToPath(metaUrl)) : process.cwd();
const DATA_DIR = path.resolve(moduleDir, "data");
const DATA_FILE = path.join(DATA_DIR, "listings.json");

const fileBackend: Backend = {
  async read() {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf-8")) as Listing[];
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
// The whole catalog lives under one key. @netlify/blobs is imported
// dynamically and only when we're on Netlify, so local dev / the build never
// load it or require its environment. (The classic-Lambda handler calls
// connectLambda(event) first — see netlify/functions/api.ts.)
const BLOB_STORE_NAME = "listings";
const BLOB_KEY = "listings.json";

// Minimal structural type so this module type-checks without coupling to the
// package's exported types; the real object is cast in.
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
/* Shared CRUD logic                                                   */
/* ------------------------------------------------------------------ */
// In-memory cache is used ONLY for the file backend (a single long-lived
// process). On Blobs we read fresh every time so all function instances see
// the same durable state and read-modify-write acts on current data.
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
  return ensureLoaded();
}

export async function getById(id: string): Promise<Listing | undefined> {
  const data = await ensureLoaded();
  return data.find((listing) => listing.id === id);
}

/** Runs `mutate` against current data under the write queue and persists the result. */
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

export async function update(
  id: string,
  patch: Partial<Omit<Listing, "id" | "slug">>,
): Promise<Listing | undefined> {
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
