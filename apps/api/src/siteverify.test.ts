import { describe, expect, it, vi } from "vitest";
import { createSiteverify, SITEVERIFY_URL, type FetchLike } from "./siteverify.ts";

const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => body,
});

function setup(response: ReturnType<typeof reply> | Error) {
  const fetch = vi.fn<FetchLike>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { fetch, siteverify: createSiteverify({ fetch, getSecret: async () => "the-secret" }) };
}

describe("createSiteverify", () => {
  it("secretとresponseをフォームでsiteverifyに送る", async () => {
    const { fetch, siteverify } = setup(reply({ success: true, hostname: "h.example.test" }));
    await siteverify("the-token");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toEqual({ secret: "the-secret", response: "the-token" });
    // 通信が固まっても Lambda を使い切らないよう、時間切れを付ける
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("success:trueならhostnameを返す", async () => {
    const { siteverify } = setup(reply({ success: true, hostname: "h.example.test" }));
    expect(await siteverify("t")).toEqual({ success: true, hostname: "h.example.test" });
  });

  it("利用者の側の失敗（時間切れ・重複・不正なトークン）はsuccess:falseで返す", async () => {
    for (const code of ["timeout-or-duplicate", "invalid-input-response", "missing-input-response"]) {
      const { siteverify } = setup(reply({ success: false, "error-codes": [code] }));
      expect(await siteverify("t")).toEqual({ success: false });
    }
  });

  it("こちらの側の失敗（internal-error・secret不正・理由なし）、HTTPの失敗、JSONでない応答は例外", async () => {
    const cases = [
      reply({ success: false, "error-codes": ["internal-error"] }),
      reply({ success: false }),
      reply({ success: false, "error-codes": [] }),
      reply({ success: false, "error-codes": ["invalid-input-secret"] }),
      reply({ success: false, "error-codes": ["timeout-or-duplicate", "bad-request"] }),
      reply({}, { ok: false, status: 500 }),
      reply("文字列"),
      reply(null),
      { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("json")) },
    ];
    for (const response of cases) {
      const { siteverify } = setup(response);
      await expect(siteverify("t")).rejects.toThrow();
    }
  });

  it("fetchの例外（通信失敗・時間切れ）はそのまま例外にする", async () => {
    const { siteverify } = setup(new Error("timeout"));
    await expect(siteverify("t")).rejects.toThrow("timeout");
  });
});
