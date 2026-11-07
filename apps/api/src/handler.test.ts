import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "./handler.ts";
import { MAX_SHARES_PER_OWNER } from "./types.ts";
import type { ApiEvent, Deps } from "./types.ts";
import {
  NOW,
  OTHER,
  OWNER,
  TOKEN,
  createEvent,
  deleteEvent,
  idOf,
  json,
  listEvent,
  makeDeps,
  memoryStore,
  stored,
  validBody,
  validScore,
  viewEvent,
} from "./test-helpers.ts";

afterEach(() => vi.restoreAllMocks());

function setup(overrides: Partial<Deps> = {}) {
  const made = makeDeps(overrides);
  return { ...made, handle: createHandler(made.deps) };
}

/** 何も保存されていないこと。 */
const noWrites = (items: Map<string, unknown>) => expect(items.size).toBe(0);

describe("作成 POST /api/shares", () => {
  it("正しい本文で201と新IDを返し、所有者は認可のsub・作成日時はnowで保存する", async () => {
    const { handle, items } = setup();
    const result = await handle(createEvent(validBody()));
    expect(result.statusCode).toBe(201);
    expect(json(result)).toEqual({ id: idOf(1) });
    expect(items.get(idOf(1))).toEqual({ id: idOf(1), ownerSub: OWNER, createdAt: NOW.toISOString(), score: validScore() });
  });

  it("本文にsubを書いても無視し、認可のsubを所有者にする", async () => {
    const { handle, items } = setup();
    const body = { ...validBody(), sub: OTHER, ownerSub: OTHER, score: { ...validScore(), sub: OTHER, ownerSub: OTHER } };
    const result = await handle(createEvent(body));
    expect(result.statusCode).toBe(201);
    const saved = items.get(idOf(1));
    expect(saved?.ownerSub).toBe(OWNER);
    expect(JSON.stringify(saved)).not.toContain(OTHER);
  });

  it("Turnstileがsuccess:false（時間切れ含む）なら403で、保存しない", async () => {
    const { handle, items } = setup({ siteverify: vi.fn(async () => ({ success: false })) });
    const result = await handle(createEvent(validBody()));
    expect(result.statusCode).toBe(403);
    expect(json(result)).toEqual({ error: "turnstile-failed" });
    noWrites(items);
  });

  it("Turnstileのhostnameが期待と違えば403で、保存しない", async () => {
    for (const hostname of ["evil.example.test", undefined, ""]) {
      const { handle, items } = setup({ siteverify: vi.fn(async () => ({ success: true, hostname })) });
      const result = await handle(createEvent(validBody()));
      expect(result.statusCode).toBe(403);
      noWrites(items);
    }
  });

  it("Turnstileの確認が例外（通信失敗・時間切れ）なら503で、保存しない", async () => {
    const { handle, items } = setup({ siteverify: vi.fn(async () => Promise.reject(new Error("network"))) });
    const result = await handle(createEvent(validBody()));
    expect(result.statusCode).toBe(503);
    expect(json(result)).toEqual({ error: "unavailable" });
    noWrites(items);
  });

  it("受け取ったトークンを、そのままTurnstileに渡す", async () => {
    const { handle, deps } = setup();
    await handle(createEvent(validBody()));
    expect(deps.siteverify).toHaveBeenCalledWith(TOKEN);
  });

  it("譜面が#74の検証に落ちれば400で、理由は返さず保存しない", async () => {
    const { handle, items } = setup();
    for (const score of [{ ...validScore(), title: "" }, { ...validScore(), capo: 99 }, "文字列", undefined]) {
      const result = await handle(createEvent({ turnstileToken: TOKEN, score }));
      expect(result.statusCode).toBe(400);
      expect(json(result)).toEqual({ error: "invalid-request" });
    }
    noWrites(items);
  });

  it("本文がJSONでない・トークンが不正・本文が大きすぎるときは400で、Turnstileも呼ばない", async () => {
    const { handle, deps, items } = setup();
    const bodies: (string | object)[] = [
      "これはJSONではない",
      "null",
      "[]",
      {},
      { score: validScore() },
      { turnstileToken: "", score: validScore() },
      { turnstileToken: 123, score: validScore() },
      { turnstileToken: "t".repeat(2049), score: validScore() },
      JSON.stringify({ ...validBody(), padding: "x".repeat(70 * 1024) }),
    ];
    for (const body of bodies) {
      const result = await handle(createEvent(body));
      expect(result.statusCode).toBe(400);
    }
    expect(deps.siteverify).not.toHaveBeenCalled();
    noWrites(items);
  });

  it("base64で届いた本文も読む", async () => {
    const { handle } = setup();
    const event: ApiEvent = { ...createEvent(validBody()), isBase64Encoded: true };
    const result = await handle({ ...event, body: Buffer.from(event.body ?? "").toString("base64") });
    expect(result.statusCode).toBe(201);
  });

  it("自分の件数が19なら作成でき、20なら409", async () => {
    const mine = (n: number) => Array.from({ length: n }, (_, i) => stored(idOf(100 + i), OWNER));
    const { store } = memoryStore(mine(MAX_SHARES_PER_OWNER - 1));
    const ok = await createHandler(makeDeps({ store }).deps)(createEvent(validBody()));
    expect(ok.statusCode).toBe(201);

    const full = memoryStore(mine(MAX_SHARES_PER_OWNER));
    const made = makeDeps({ store: full.store });
    const result = await createHandler(made.deps)(createEvent(validBody()));
    expect(result.statusCode).toBe(409);
    expect(json(result)).toEqual({ error: "limit-reached" });
    expect(full.store.create).not.toHaveBeenCalled();
  });

  it("件数は自分の分だけ数える（他人の20件は影響しない）", async () => {
    const others = Array.from({ length: MAX_SHARES_PER_OWNER }, (_, i) => stored(idOf(100 + i), OTHER));
    const { store } = memoryStore(others);
    const result = await createHandler(makeDeps({ store }).deps)(createEvent(validBody()));
    expect(result.statusCode).toBe(201);
    expect(store.countByOwner).toHaveBeenCalledWith(OWNER);
  });

  it("Turnstileに失敗したら検証も件数確認もせず、検証に失敗したら件数を引かない", async () => {
    const failing = setup({ siteverify: vi.fn(async () => ({ success: false })) });
    await failing.handle(createEvent({ turnstileToken: TOKEN, score: "不正" }));
    expect(failing.deps.store.countByOwner).not.toHaveBeenCalled();

    const invalid = setup();
    await invalid.handle(createEvent({ turnstileToken: TOKEN, score: "不正" }));
    expect(invalid.deps.siteverify).toHaveBeenCalledTimes(1);
    expect(invalid.deps.store.countByOwner).not.toHaveBeenCalled();
  });

  it("IDが重複したら別のIDで保存し、続けて重複するなら503", async () => {
    const taken = [stored(idOf(1), OTHER)];
    const retry = memoryStore(taken);
    const ok = await createHandler(makeDeps({ store: retry.store }).deps)(createEvent(validBody()));
    expect(ok.statusCode).toBe(201);
    expect(json(ok)).toEqual({ id: idOf(2) });

    const always = memoryStore();
    always.store.create.mockResolvedValue("id-taken");
    const result = await createHandler(makeDeps({ store: always.store }).deps)(createEvent(validBody()));
    expect(result.statusCode).toBe(503);
    expect(always.store.create.mock.calls.length).toBeGreaterThan(1);
  });

  it("保存先の失敗は503", async () => {
    for (const operation of ["countByOwner", "create"] as const) {
      const { store } = memoryStore();
      store[operation].mockRejectedValue(new Error("dynamodb"));
      const result = await createHandler(makeDeps({ store }).deps)(createEvent(validBody()));
      expect(result.statusCode).toBe(503);
      expect(json(result)).toEqual({ error: "unavailable" });
    }
  });

  it("認可のsubが無ければ401で、Turnstileも呼ばない", async () => {
    const { handle, deps } = setup();
    for (const event of [createEvent(validBody(), null), { ...createEvent(validBody()), requestContext: undefined }]) {
      const result = await handle(event);
      expect(result.statusCode).toBe(401);
      expect(json(result)).toEqual({ error: "unauthorized" });
    }
    expect(deps.siteverify).not.toHaveBeenCalled();
  });
});

describe("閲覧 GET /api/shares/{id}", () => {
  const sharedBy = (sub: string) => memoryStore([stored(idOf(5), sub)]);

  it("存在するIDで200、譜面と作成日時を返す", async () => {
    const { store } = sharedBy(OWNER);
    const result = await createHandler(makeDeps({ store }).deps)(viewEvent(idOf(5)));
    expect(result.statusCode).toBe(200);
    expect(json(result)).toEqual({ score: validScore(), createdAt: NOW.toISOString() });
  });

  it("応答に所有者の識別子（sub）が一切含まれない", async () => {
    const { store } = sharedBy(OWNER);
    const result = await createHandler(makeDeps({ store }).deps)(viewEvent(idOf(5)));
    expect(result.body).not.toContain(OWNER);
  });

  it("認証なしでも見られ、閲覧者のsubも結果に影響しない", async () => {
    const { store } = sharedBy(OWNER);
    const handle = createHandler(makeDeps({ store }).deps);
    expect((await handle(viewEvent(idOf(5)))).statusCode).toBe(200);
    expect((await handle(viewEvent(idOf(5), OTHER))).statusCode).toBe(200);
  });

  it("存在しないIDは404", async () => {
    const { handle } = setup();
    const result = await handle(viewEvent(idOf(9)));
    expect(result.statusCode).toBe(404);
    expect(json(result)).toEqual({ error: "not-found" });
  });

  it("形式が不正なIDは404で、保存先を引かない", async () => {
    const { handle, deps } = setup();
    for (const id of ["", "short", "a".repeat(23), `${"a".repeat(21)}!`, `${"a".repeat(21)}/`]) {
      expect((await handle(viewEvent(id))).statusCode).toBe(404);
    }
    expect((await handle({ routeKey: "GET /api/shares/{id}" })).statusCode).toBe(404);
    expect(deps.store.get).not.toHaveBeenCalled();
  });

  it("保存先の失敗は503", async () => {
    const { store } = memoryStore();
    store.get.mockRejectedValue(new Error("dynamodb"));
    const result = await createHandler(makeDeps({ store }).deps)(viewEvent(idOf(5)));
    expect(result.statusCode).toBe(503);
  });
});

describe("一覧 GET /api/shares", () => {
  const at = (minute: number) => `2026-11-07T09:0${minute}:00.000Z`;

  it("自分の分だけ返し、保存先が古い順で返しても新しい順にそろえる", async () => {
    const { store } = memoryStore([
      stored(idOf(1), OWNER, at(1)),
      stored(idOf(3), OWNER, at(3)),
      stored(idOf(2), OWNER, at(2)),
      stored(idOf(4), OTHER, at(4)),
    ]);
    const result = await createHandler(makeDeps({ store }).deps)(listEvent());
    expect(result.statusCode).toBe(200);
    const { shares } = json(result) as { shares: { id: string }[] };
    expect(shares.map((s) => s.id)).toEqual([idOf(3), idOf(2), idOf(1)]);
  });

  it("各件はID・タイトル・作成日時・コード数だけを返す（保存先が余分な項目を返しても出さない）", async () => {
    const share = stored(idOf(1), OWNER);
    const { store } = memoryStore([share]);
    store.listByOwner.mockResolvedValue([{ id: share.id, title: share.score.title, createdAt: share.createdAt, chordCount: 2, ownerSub: OWNER, note: "ひと言" } as never]);
    const result = await createHandler(makeDeps({ store }).deps)(listEvent());
    expect(json(result)).toEqual({ shares: [{ id: idOf(1), title: "朝の曲", createdAt: NOW.toISOString(), chordCount: 2 }] });
    expect(result.body).not.toContain(OWNER);
  });

  it("0件なら空の配列", async () => {
    const { handle } = setup();
    const result = await handle(listEvent());
    expect(result.statusCode).toBe(200);
    expect(json(result)).toEqual({ shares: [] });
  });

  it("subが無ければ401、保存先の失敗は503", async () => {
    const { handle } = setup();
    expect((await handle(listEvent(null))).statusCode).toBe(401);

    const { store } = memoryStore();
    store.listByOwner.mockRejectedValue(new Error("dynamodb"));
    expect((await createHandler(makeDeps({ store }).deps)(listEvent())).statusCode).toBe(503);
  });
});

describe("削除 DELETE /api/shares/{id}", () => {
  it("自分の共有を削除して204、以後の閲覧は404", async () => {
    const { store, items } = memoryStore([stored(idOf(5), OWNER)]);
    const handle = createHandler(makeDeps({ store }).deps);
    const result = await handle(deleteEvent(idOf(5)));
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
    expect(items.size).toBe(0);
    expect((await handle(viewEvent(idOf(5)))).statusCode).toBe(404);
  });

  it("他人の共有の削除は404で、共有は残る", async () => {
    const { store, items } = memoryStore([stored(idOf(5), OTHER)]);
    const result = await createHandler(makeDeps({ store }).deps)(deleteEvent(idOf(5)));
    expect(result.statusCode).toBe(404);
    expect(items.has(idOf(5))).toBe(true);
  });

  it("存在しないIDも形式不正のIDも、他人の共有と同じ404", async () => {
    const { store } = memoryStore([stored(idOf(5), OTHER)]);
    const handle = createHandler(makeDeps({ store }).deps);
    const others = await handle(deleteEvent(idOf(5)));
    for (const id of [idOf(9), "short", `${"a".repeat(21)}!`]) {
      const result = await handle(deleteEvent(id));
      expect(result).toEqual(others);
    }
  });

  it("subが無ければ401、保存先の失敗は503", async () => {
    const { handle } = setup();
    expect((await handle(deleteEvent(idOf(5), null))).statusCode).toBe(401);

    const { store } = memoryStore();
    store.deleteOwned.mockRejectedValue(new Error("dynamodb"));
    expect((await createHandler(makeDeps({ store }).deps)(deleteEvent(idOf(5)))).statusCode).toBe(503);
  });
});

describe("共通", () => {
  it("すべての応答にX-Robots-Tag: noindexとJSONのcontent-typeが付く", async () => {
    const { store } = memoryStore([stored(idOf(5), OWNER)]);
    const handle = createHandler(makeDeps({ store }).deps);
    const events: ApiEvent[] = [
      createEvent(validBody()),
      createEvent("不正"),
      viewEvent(idOf(5)),
      viewEvent(idOf(9)),
      listEvent(),
      listEvent(null),
      deleteEvent(idOf(5)),
      { routeKey: "GET /api/unknown" },
    ];
    for (const event of events) {
      const result = await handle(event);
      expect(result.headers["x-robots-tag"]).toBe("noindex");
      expect(result.headers["content-type"]).toBe("application/json; charset=utf-8");
    }
  });

  it("未知の経路は404", async () => {
    const { handle } = setup();
    for (const routeKey of ["GET /api/unknown", "PUT /api/shares", "$default", ""]) {
      expect((await handle({ routeKey })).statusCode).toBe(404);
    }
  });

  it("ログに本文・タイトル・トークン・共有IDが出ない（成功も各失敗も、例外のメッセージに含まれていても）", async () => {
    const secrets = ["秘密のタイトル", "秘密のひと言", TOKEN, idOf(1), idOf(5)];
    const output: string[] = [];
    const record = (...args: unknown[]) => void output.push(args.map(String).join(" "));
    for (const name of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, name).mockImplementation(record);

    const score = { ...validScore(), title: "秘密のタイトル", note: "秘密のひと言" };
    const leaky = new Error(`failed ${secrets.join(" ")}`);
    const run = async (overrides: Partial<Deps>, event: ApiEvent) => {
      const { deps } = makeDeps({ ...overrides, log: (message) => record(message) });
      return createHandler(deps)(event);
    };
    const withShare = () => memoryStore([stored(idOf(5), OWNER, NOW.toISOString(), score)]).store;
    const failing = (operation: "create" | "countByOwner" | "get" | "listByOwner" | "deleteOwned") => {
      const { store } = memoryStore();
      store[operation].mockRejectedValue(leaky);
      return store;
    };

    await run({}, createEvent({ turnstileToken: TOKEN, score }));
    await run({ siteverify: vi.fn(async () => ({ success: false })) }, createEvent({ turnstileToken: TOKEN, score }));
    await run({ siteverify: vi.fn(async () => Promise.reject(leaky)) }, createEvent({ turnstileToken: TOKEN, score }));
    await run({}, createEvent({ turnstileToken: TOKEN, score: { ...score, capo: 99 } }));
    await run({ store: failing("countByOwner") }, createEvent({ turnstileToken: TOKEN, score }));
    await run({ store: failing("create") }, createEvent({ turnstileToken: TOKEN, score }));
    await run({ store: withShare() }, viewEvent(idOf(5)));
    await run({ store: failing("get") }, viewEvent(idOf(5)));
    await run({ store: withShare() }, listEvent());
    await run({ store: failing("listByOwner") }, listEvent());
    await run({ store: withShare() }, deleteEvent(idOf(5)));
    await run({ store: failing("deleteOwned") }, deleteEvent(idOf(5)));

    // 失敗の記録が何も無いと、下の検査が空振りになる
    expect(output.length).toBeGreaterThan(0);
    for (const line of output) for (const secret of secrets) expect(line).not.toContain(secret);
  });

  it("期待するhostnameはdepsから渡された値を使う", async () => {
    const { handle, items } = setup({ expectedHostname: "other.example.test" });
    const result = await handle(createEvent(validBody()));
    expect(result.statusCode).toBe(403);
    noWrites(items);
  });
});
