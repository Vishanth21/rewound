// lib/ingest.ts  (Member A)
// Phase 2 of ingestion, shared by upload, re-embed and chunk editing:
// embed chunk texts in Node, then store the vectors with set_chunk_embeddings().
import { withUser } from "@/lib/db";
import { embed, toVectorLiteral } from "@/lib/embed";

export async function storeEmbeddings(userId: number, lectureId: number, chunks: { seq_no: number; content: string }[]) {
  const vectors = await embed(chunks.map((c) => c.content));
  const payload = chunks.map((c, i) => ({ seq: c.seq_no, v: JSON.parse(toVectorLiteral(vectors[i])) as number[] }));
  await withUser(userId, (c) => c.query("CALL set_chunk_embeddings($1, $2::jsonb)", [lectureId, JSON.stringify(payload)]));
}
