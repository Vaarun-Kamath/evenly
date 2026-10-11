import postgres from "postgres";

/** The small slice of the database the app depends on. Tests pass a fake. */
export interface DbHandle {
  /** Rejects when the database cannot be reached. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDb(url: string): DbHandle {
  // postgres.js connects lazily, so a database that is still starting does not stop the server
  // booting; /readyz reports 503 until it is reachable.
  const sql = postgres(url, {
    max: 10,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  return {
    async ping() {
      await sql`select 1`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
