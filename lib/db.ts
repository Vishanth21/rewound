// lib/db.ts
// NOTE: Member B owns this file (design plan section 13). This is the agreed interface,
// written out so Member A's pages and routes can run; if B's version differs, keep B's
// as long as withUser(userId, fn) keeps the same signature.
//
// Every request runs as "the logged-in user" inside ONE transaction: withUser() sets the
// transaction-local setting lecturelens.user_id, which current_app_user() in SQL reads.
import { Pool, type PoolClient } from "pg";

const globalForPool = globalThis as unknown as { llPool?: Pool };

export const pool: Pool =
  globalForPool.llPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }); // lecturelens_app role
if (process.env.NODE_ENV !== "production") globalForPool.llPool = pool;

export async function withUser<T>(userId: number, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // transaction-local: current_app_user() in SQL reads this, then it vanishes at COMMIT
    await c.query("SELECT set_config('lecturelens.user_id', $1, true)", [String(userId)]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
