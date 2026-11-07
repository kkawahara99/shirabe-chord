/** `sessionStorage` のうち使う部分。 */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// プライベートウィンドウやサイトデータの遮断では、読み書きが例外になる。画面は保存が無くても動くので、ここで握りつぶす。

export function readItem(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 書けたかを返す。 */
export function writeItem(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // 消せなくても、できることは無い
  }
}

/** `window.sessionStorage` にさわるだけで例外になる環境がある。そのときは、何も覚えない保存先を返す。 */
export function browserStorage(): StorageLike {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
