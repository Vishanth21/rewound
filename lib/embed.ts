// lib/embed.ts  (Member A)
// One embedding model for chunks AND queries (a symmetric model requires this), loaded once
// per server process. all-MiniLM-L6-v2 -> 384-dimensional, mean-pooled, L2-normalised vectors,
// so cosine distance (<=>) in pgvector ranks the same as inner product.
//
// EMBED_BACKEND=minilm (default) is the real model. It is downloaded once (~23 MB) on first use.
// EMBED_BACKEND=hash is a model-free stand-in used only for offline tests and CI: it builds a
// deterministic word-hash vector. It is NOT semantic, so never use it for real results.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBED_DIM = 384;
export const EMBED_BACKEND = (process.env.EMBED_BACKEND ?? "minilm") as "minilm" | "hash";
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const BATCH = 16;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

export type EmbedModelProgress = {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
};

export type EmbedModelProgressCallback = (progress: EmbedModelProgress) => void;

async function loadModel(onProgress?: EmbedModelProgressCallback): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  // Vercel functions can only write to temporary storage. Keep the downloaded model in /tmp
  // when no explicit cache path is configured; local environments keep the library default.
  const cacheDir = process.env.TRANSFORMERS_CACHE_DIR || (process.env.VERCEL ? "/tmp/transformers-cache" : undefined);
  if (cacheDir) env.cacheDir = cacheDir;

  // Narrowed signature: the library's overloads are too complex for tsc to resolve here.
  const load = pipeline as unknown as (
    task: "feature-extraction",
    model: string,
    options: { progress_callback?: EmbedModelProgressCallback },
  ) => Promise<FeatureExtractionPipeline>;
  return load("feature-extraction", MODEL_ID, { progress_callback: onProgress });
}

function isTransientModelError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /\b429\b|too many requests|rate.?limit|econnreset|econnrefused|etimedout|fetch failed|network/i.test(message);
}

async function loadModelWithRetry(onProgress?: EmbedModelProgressCallback): Promise<FeatureExtractionPipeline> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await loadModel(onProgress);
    } catch (error) {
      if (attempt >= 3 || !isTransientModelError(error)) throw error;
      const waitMs = attempt * 1500;
      onProgress?.({ status: "retry", progress: attempt, total: 3, file: `${Math.ceil(waitMs / 1000)}s` });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export async function embed(texts: string[], onModelProgress?: EmbedModelProgressCallback): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (EMBED_BACKEND === "hash") return texts.map(hashEmbed);

  if (!extractor) {
    const pending = loadModelWithRetry(onModelProgress);
    extractor = pending;
    // A failed download should not poison the process-wide singleton; later calls can retry.
    void pending.catch(() => {
      if (extractor === pending) extractor = null;
    });
  }
  const model = await extractor;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const t = await model(batch, { pooling: "mean", normalize: true });
    out.push(...(t.tolist() as number[][]));
  }
  for (const v of out) if (v.length !== EMBED_DIM) throw new Error(`Expected ${EMBED_DIM}-d vectors, got ${v.length}`);
  return out;
}

/** pgvector text literal: "[0.1,0.2,...]" (cast with ::vector in SQL). */
export const toVectorLiteral = (v: number[]) => "[" + v.map((x) => x.toFixed(6)).join(",") + "]";

// ---------------------------------------------------------------- hash backend (tests only)
const STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those " +
  "we you i they he she do does did can could will would should may might must not no so than then there here what which who whom how why when where " +
  "our your their his her them us me my about into over under again very just also more most some such only own same too").split(" "));

function stem(w: string): string {
  return w.replace(/(ing|edly|ed|ly|es|s)$/, (m) => (w.length - m.length >= 4 ? "" : m));
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashEmbed(text: string): number[] {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  const v = new Array<number>(EMBED_DIM).fill(0);
  const add = (token: string, weight: number) => {
    const h = fnv(token);
    v[h % EMBED_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  words.forEach((w, i) => {
    add(w, 1);
    if (i > 0) add(words[i - 1] + "_" + w, 0.5);
  });
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
