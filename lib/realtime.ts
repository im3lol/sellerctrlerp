import { Client } from "pg";

/**
 * Realtime via Postgres LISTEN/NOTIFY (replaces Supabase Realtime).
 *
 * A single dedicated pg Client holds `LISTEN sellerctrl_events`. Every event
 * carries a `channel` (e.g. `user:<id>` or `workspace:<id>`) so SSE handlers
 * can fan out only the relevant events to each connected browser.
 */

export type RealtimeEvent = {
  channel: string; // routing key: "user:<uuid>" | "workspace:<uuid>" | "global"
  type: string; // notification | product_updated | task_moved | activity | attendance
  payload?: Record<string, unknown>;
  at: string;
};

type Listener = (event: RealtimeEvent) => void;

const PG_CHANNEL = "sellerctrl_events";
const connectionString =
  process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl";

const globalForRt = globalThis as unknown as {
  __rtClient?: Client;
  __rtListeners?: Set<Listener>;
  __rtReady?: Promise<void>;
};

const listeners: Set<Listener> = (globalForRt.__rtListeners ??= new Set());

async function ensureListening(): Promise<void> {
  if (globalForRt.__rtReady) return globalForRt.__rtReady;

  globalForRt.__rtReady = (async () => {
    const client = new Client({ connectionString });
    globalForRt.__rtClient = client;
    await client.connect();
    await client.query(`LISTEN ${PG_CHANNEL}`);
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as RealtimeEvent;
        for (const l of listeners) l(event);
      } catch {
        /* ignore malformed payloads */
      }
    });
    client.on("error", () => {
      // Drop the cached promise so the next subscribe reconnects.
      globalForRt.__rtReady = undefined;
    });
  })();

  return globalForRt.__rtReady;
}

/** Subscribe to realtime events. Returns an unsubscribe fn. */
export async function subscribe(listener: Listener): Promise<() => void> {
  await ensureListening();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Emit an event. Uses pg_notify so it works from any pooled connection.
 * Pass the pool's query method (db pool) to publish.
 */
export async function publish(
  query: (text: string, params: unknown[]) => Promise<unknown>,
  event: Omit<RealtimeEvent, "at">,
): Promise<void> {
  const full: RealtimeEvent = { ...event, at: new Date().toISOString() };
  await query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, JSON.stringify(full)]);
}
