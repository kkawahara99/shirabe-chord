import type { SharedScore } from "@shirabe-chord/core";

/** 1 人が持てる共有の数（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。 */
export const MAX_SHARES_PER_OWNER = 20;

/** API Gateway（HTTP API・ペイロード 2.0）のイベントのうち、使う部分だけ。 */
export type ApiEvent = {
  /** 例: `GET /api/shares/{id}`。経路の振り分けはこれで行う。 */
  readonly routeKey: string;
  readonly pathParameters?: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext?: {
    readonly authorizer?: { readonly jwt?: { readonly claims?: Readonly<Record<string, unknown>> } };
  };
};

export type ApiResult = {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

/** 保存する 1 件。`ownerSub` は閲覧の応答に出さない。 */
export type StoredShare = {
  readonly id: string;
  readonly ownerSub: string;
  /** ISO 8601（UTC）。文字列の順が時刻の順になる。 */
  readonly createdAt: string;
  readonly score: SharedScore;
};

/** 一覧に出す項目。所有者の索引に写す項目と同じ。 */
export type ShareSummary = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly chordCount: number;
};

/** 保存先。失敗は例外で表す（ハンドラが 503 にする）。 */
export type ShareStore = {
  /** ID が既にあれば書かずに `id-taken` を返す（条件付き書き込み）。 */
  create(share: StoredShare): Promise<"created" | "id-taken">;
  get(id: string): Promise<StoredShare | undefined>;
  /** 並びは問わない。 */
  listByOwner(ownerSub: string): Promise<readonly ShareSummary[]>;
  countByOwner(ownerSub: string): Promise<number>;
  /** 所有者が一致するときだけ消し、消したかを返す。無い・他人のものは false。 */
  deleteOwned(id: string, ownerSub: string): Promise<boolean>;
};

/** Turnstile の確認結果。通信の失敗など、こちらの側の問題は例外にする。 */
export type SiteverifyResult = {
  readonly success: boolean;
  readonly hostname?: string | undefined;
};

export type Deps = {
  readonly store: ShareStore;
  readonly siteverify: (token: string) => Promise<SiteverifyResult>;
  /** Turnstile が返す `hostname` の期待値。 */
  readonly expectedHostname: string;
  readonly now: () => Date;
  readonly newId: () => string;
  /** 固定の文言だけを渡す。本文・タイトル・トークン・共有 ID を渡さない。 */
  readonly log: (message: string) => void;
};
