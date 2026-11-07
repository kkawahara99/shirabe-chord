import type { SharedScore } from "@shirabe-chord/core";
import { vi } from "vitest";
import type { ApiEvent, ApiResult, Deps, ShareStore, ShareSummary, StoredShare } from "./types.ts";

export const NOW = new Date("2026-11-07T09:00:00.000Z");
export const HOSTNAME = "chord.example.test";
export const TOKEN = "turnstile-token-secret";
export const OWNER = "owner-sub-aaaa";
export const OTHER = "other-sub-bbbb";

/** 形式に合う ID（22 文字）。 */
export const idOf = (n: number) => `${"a".repeat(21)}${n}`.slice(-22);

export const validScore = (): SharedScore => ({
  title: "朝の曲",
  note: "サビは強めに",
  displayName: "作曲者",
  capo: 0,
  chords: [
    { symbol: "C", voicing: [null, 3, 2, 0, 1, 0] },
    { symbol: "G", voicing: [3, 2, 0, 0, 0, 3] },
  ],
});

export const stored = (id: string, ownerSub: string, createdAt = NOW.toISOString(), score = validScore()): StoredShare => ({
  id,
  ownerSub,
  createdAt,
  score,
});

export const summaryOf = (share: StoredShare): ShareSummary => ({
  id: share.id,
  title: share.score.title,
  createdAt: share.createdAt,
  chordCount: share.score.chords.length,
});

/** メモリ上の保存先。各操作は呼び出しを記録するよう vi.fn で包む。 */
export function memoryStore(initial: readonly StoredShare[] = []) {
  const items = new Map(initial.map((share) => [share.id, share]));
  const store = {
    create: vi.fn(async (share: StoredShare) => {
      if (items.has(share.id)) return "id-taken" as const;
      items.set(share.id, share);
      return "created" as const;
    }),
    get: vi.fn(async (id: string) => items.get(id)),
    listByOwner: vi.fn(async (ownerSub: string) => [...items.values()].filter((s) => s.ownerSub === ownerSub).map(summaryOf)),
    countByOwner: vi.fn(async (ownerSub: string) => [...items.values()].filter((s) => s.ownerSub === ownerSub).length),
    deleteOwned: vi.fn(async (id: string, ownerSub: string) => {
      if (items.get(id)?.ownerSub !== ownerSub) return false;
      items.delete(id);
      return true;
    }),
  } satisfies ShareStore;
  return { store, items };
}

export function makeDeps(overrides: Partial<Deps> = {}) {
  const { store, items } = memoryStore();
  let next = 1;
  const deps = {
    store,
    siteverify: vi.fn(async (_token: string) => ({ success: true, hostname: HOSTNAME })),
    expectedHostname: HOSTNAME,
    now: () => NOW,
    newId: () => idOf(next++),
    log: vi.fn<(message: string) => void>(),
    ...overrides,
  } satisfies Deps;
  return { deps, items };
}

/** `null` は認可の結果に sub が無いこと。 */
export const asUser = (sub: string | null) => ({
  authorizer: { jwt: { claims: sub === null ? {} : { sub } } },
});

export const createEvent = (body: unknown, sub: string | null = OWNER): ApiEvent => ({
  routeKey: "POST /api/shares",
  body: typeof body === "string" ? body : JSON.stringify(body),
  requestContext: asUser(sub),
});

export const validBody = () => ({ turnstileToken: TOKEN, score: validScore() });

export const viewEvent = (id: string, sub?: string): ApiEvent => ({
  routeKey: "GET /api/shares/{id}",
  pathParameters: { id },
  ...(sub === undefined ? {} : { requestContext: asUser(sub) }),
});

export const listEvent = (sub: string | null = OWNER): ApiEvent => ({
  routeKey: "GET /api/shares",
  requestContext: asUser(sub),
});

export const deleteEvent = (id: string, sub: string | null = OWNER): ApiEvent => ({
  routeKey: "DELETE /api/shares/{id}",
  pathParameters: { id },
  requestContext: asUser(sub),
});

export const json = (result: ApiResult): unknown => JSON.parse(result.body);
