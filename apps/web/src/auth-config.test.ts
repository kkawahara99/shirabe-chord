import { describe, expect, it } from "vitest";
import { readAuthConfig } from "./auth-config.ts";

const FULL = {
  VITE_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com",
  VITE_COGNITO_CLIENT_ID: "client-id",
  VITE_TURNSTILE_SITE_KEY: "site-key",
};

describe("readAuthConfig", () => {
  it("3つの値がそろい、ドメインが https:// で始まれば設定を返す", () => {
    expect(readAuthConfig(FULL)).toEqual({
      cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
      clientId: "client-id",
      turnstileSiteKey: "site-key",
    });
  });

  it.each(Object.keys(FULL))("%s が空なら null（ログイン・共有の画面を出さない）", (key) => {
    expect(readAuthConfig({ ...FULL, [key]: "" })).toBeNull();
    expect(readAuthConfig({ ...FULL, [key]: undefined })).toBeNull();
    expect(readAuthConfig({ ...FULL, [key]: "  " })).toBeNull();
  });

  it("ドメインが http:// や URL でない文字列なら null", () => {
    expect(readAuthConfig({ ...FULL, VITE_COGNITO_DOMAIN: "http://example.com" })).toBeNull();
    expect(readAuthConfig({ ...FULL, VITE_COGNITO_DOMAIN: "example.com" })).toBeNull();
    expect(readAuthConfig({ ...FULL, VITE_COGNITO_DOMAIN: "https://" })).toBeNull();
  });

  it("ドメイン末尾の / は落とす", () => {
    expect(readAuthConfig({ ...FULL, VITE_COGNITO_DOMAIN: "https://example.com/" })?.cognitoDomain).toBe(
      "https://example.com",
    );
  });
});
