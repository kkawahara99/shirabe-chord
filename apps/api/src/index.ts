// Lambda の入口。実体（DynamoDB・Turnstile・SSM）の組み立てだけを行う。振る舞いは handler.ts（テスト済み）。
// 環境変数は infra/app（#77）が渡す。AWS SDK は Lambda のランタイム付属のものを使う（ビルドでまとめない）。
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { createHandler } from "./handler.ts";
import { newShareId } from "./share-id.ts";
import { createSiteverify } from "./siteverify.ts";
import type { ShareStore, ShareSummary, StoredShare } from "./types.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing environment variable: ${name}`);
  return value;
}

const tableName = requireEnv("SHARES_TABLE");
/** 所有者（`ownerSub`）で引く索引。並びのキーは `createdAt`。ID・タイトル・コード数を写す。 */
const ownerIndexName = requireEnv("SHARES_OWNER_INDEX");

const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const store: ShareStore = {
  async create(share) {
    try {
      await documents.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            id: share.id,
            ownerSub: share.ownerSub,
            createdAt: share.createdAt,
            // 索引に写す項目（一覧用）
            title: share.score.title,
            chordCount: share.score.chords.length,
            score: share.score,
          },
          ConditionExpression: "attribute_not_exists(#id)",
          ExpressionAttributeNames: { "#id": "id" },
        }),
      );
      return "created";
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return "id-taken";
      throw error;
    }
  },

  // 作成・削除の直後の閲覧で古い結果を返さないよう、強い整合性で読む
  async get(id) {
    const { Item } = await documents.send(new GetCommand({ TableName: tableName, Key: { id }, ConsistentRead: true }));
    return Item === undefined ? undefined : (Item as StoredShare);
  },

  async listByOwner(ownerSub) {
    const { Items } = await documents.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: ownerIndexName,
        KeyConditionExpression: "#owner = :owner",
        ExpressionAttributeNames: { "#owner": "ownerSub" },
        ExpressionAttributeValues: { ":owner": ownerSub },
        ScanIndexForward: false,
      }),
    );
    return (Items ?? []) as ShareSummary[];
  },

  async countByOwner(ownerSub) {
    const { Count } = await documents.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: ownerIndexName,
        KeyConditionExpression: "#owner = :owner",
        ExpressionAttributeNames: { "#owner": "ownerSub" },
        ExpressionAttributeValues: { ":owner": ownerSub },
        Select: "COUNT",
      }),
    );
    return Count ?? 0;
  },

  async deleteOwned(id, ownerSub) {
    try {
      await documents.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { id },
          ConditionExpression: "#owner = :owner",
          ExpressionAttributeNames: { "#owner": "ownerSub" },
          ExpressionAttributeValues: { ":owner": ownerSub },
        }),
      );
      return true;
    } catch (error) {
      // 項目が無い場合も、条件に合わないので同じ例外になる
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  },
};

// Turnstile の秘密鍵は SSM のパラメータ（SecureString）から読み、Lambda の実行環境が生きているあいだは使い回す
const ssm = new SSMClient({});
let secret: Promise<string> | undefined;
function getSecret(): Promise<string> {
  secret ??= ssm
    .send(new GetParameterCommand({ Name: requireEnv("TURNSTILE_SECRET_PARAMETER"), WithDecryption: true }))
    .then(({ Parameter }) => {
      if (Parameter?.Value === undefined) throw Object.assign(new Error("secret not found"), { name: "TurnstileSecretNotFound" });
      return Parameter.Value;
    })
    .catch((error: unknown) => {
      secret = undefined; // 失敗を覚え込まない（次の呼び出しで読み直す）
      throw error;
    });
  return secret;
}

export const handler = createHandler({
  store,
  siteverify: createSiteverify({ fetch, getSecret }),
  expectedHostname: requireEnv("TURNSTILE_HOSTNAME"),
  now: () => new Date(),
  newId: newShareId,
  log: (message) => console.error(message),
});
