import { validateSharedScore } from "@shirabe-chord/core";
import { isShareId } from "./share-id.ts";
import { MAX_SHARES_PER_OWNER, type ApiEvent, type ApiResult, type Deps, type ShareSummary } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 2048;
/** ID が重複したときに、別の ID で試し直す回数（最初を含む）。 */
const MAX_CREATE_ATTEMPTS = 3;

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // 共有は URL を知る人だけが見られる。検索エンジンに載せない（ADR 0035）
  "x-robots-tag": "noindex",
  "cache-control": "no-store",
} as const;

// 文言は固定。入力の値や失敗の詳しい理由は返さない
const respond = (statusCode: number, body?: unknown): ApiResult => ({
  statusCode,
  headers: HEADERS,
  body: body === undefined ? "" : JSON.stringify(body),
});
const failure = (statusCode: number, error: string) => respond(statusCode, { error });

const invalidRequest = () => failure(400, "invalid-request");
const unauthorized = () => failure(401, "unauthorized");
const turnstileFailed = () => failure(403, "turnstile-failed");
const notFound = () => failure(404, "not-found");
const limitReached = () => failure(409, "limit-reached");
const unavailable = () => failure(503, "unavailable");

/** API Gateway の認可が渡す `sub`。リクエストの本文の値は信用しない。 */
function ownerOf(event: ApiEvent): string | undefined {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.["sub"];
  return typeof sub === "string" && sub !== "" ? sub : undefined;
}

export function createHandler(deps: Deps): (event: ApiEvent) => Promise<ApiResult> {
  return async (event) => {
    try {
      return await route(deps, event);
    } catch (error) {
      // 例外のメッセージには入力の値が入りうるので、種類（name）だけ残す
      deps.log(`unexpected error: ${error instanceof Error ? error.name : "unknown"}`);
      return unavailable();
    }
  };
}

function route(deps: Deps, event: ApiEvent): Promise<ApiResult> {
  switch (event.routeKey) {
    case "POST /api/shares":
      return withOwner(event, (sub) => create(deps, event, sub));
    case "GET /api/shares/{id}":
      return view(deps, event.pathParameters?.["id"]);
    case "GET /api/shares":
      return withOwner(event, (sub) => list(deps, sub));
    case "DELETE /api/shares/{id}":
      return withOwner(event, (sub) => remove(deps, event.pathParameters?.["id"], sub));
    default:
      return Promise.resolve(notFound());
  }
}

async function withOwner(event: ApiEvent, run: (sub: string) => Promise<ApiResult>): Promise<ApiResult> {
  const sub = ownerOf(event);
  return sub === undefined ? unauthorized() : run(sub);
}

/** 作成の本文 `{ turnstileToken, score }`。読めなければ undefined。 */
function parseCreateBody(event: ApiEvent): { token: string; score: unknown } | undefined {
  if (event.body === undefined) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const { turnstileToken, score } = parsed as Record<string, unknown>;
  if (typeof turnstileToken !== "string" || turnstileToken === "" || turnstileToken.length > MAX_TOKEN_LENGTH) return undefined;
  return { token: turnstileToken, score };
}

async function create(deps: Deps, event: ApiEvent, ownerSub: string): Promise<ApiResult> {
  const body = parseCreateBody(event);
  if (body === undefined) return invalidRequest();

  const verified = await deps.siteverify(body.token);
  if (!verified.success || verified.hostname !== deps.expectedHostname) return turnstileFailed();

  const checked = validateSharedScore(body.score);
  if (!checked.ok) return invalidRequest();

  if ((await deps.store.countByOwner(ownerSub)) >= MAX_SHARES_PER_OWNER) return limitReached();

  const createdAt = deps.now().toISOString();
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const id = deps.newId();
    if ((await deps.store.create({ id, ownerSub, createdAt, score: checked.score })) === "created") {
      return respond(201, { id });
    }
  }
  deps.log("share id collided repeatedly");
  return unavailable();
}

async function view(deps: Deps, id: string | undefined): Promise<ApiResult> {
  if (!isShareId(id)) return notFound();
  const share = await deps.store.get(id);
  if (share === undefined) return notFound();
  // 保存した項目のうち、所有者を除いて明示的に選ぶ
  return respond(200, { score: share.score, createdAt: share.createdAt });
}

async function list(deps: Deps, ownerSub: string): Promise<ApiResult> {
  const summaries = await deps.store.listByOwner(ownerSub);
  const newestFirst = summaries
    .map(({ id, title, createdAt, chordCount }): ShareSummary => ({ id, title, createdAt, chordCount }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return respond(200, { shares: newestFirst });
}

async function remove(deps: Deps, id: string | undefined, ownerSub: string): Promise<ApiResult> {
  // 無い・他人のもの・形式が不正なものは区別せず、同じ 404 を返す
  if (!isShareId(id)) return notFound();
  return (await deps.store.deleteOwned(id, ownerSub)) ? respond(204) : notFound();
}
