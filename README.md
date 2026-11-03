# shirabe-chord

コード進行を入れると、ギターの押さえ方の並び（手の移動が少なく弾きやすいもの）を出すサイト。ギターを弾かない作曲者が、ギター担当に渡す譜面を作る助けにする。

次の 3 つのモードを、番号順に作る（[docs/adr/0006](docs/adr/0006-product-scope-and-stages.md)）。

1. 自由にコード進行を入れて、出力を得る（ログイン不要）。
2. 出力を、各コードの押さえ方の候補から選び直して微調整する。
3. 出力を恒久的に掲載し、コメントを残せる（書き込みはログイン必須）。

状態: 設計の段階。アプリのコードはまだない（`infra/bootstrap` の Terraform のみ）。

## 構成（予定）

静的サイト（S3＋CloudFront）で、コード理論と最適化はブラウザの中で動かす。掲載（モード 3）で認証・API・データ保存を足す。実装は TypeScript（[ADR 0007](docs/adr/0007-typescript-shared-core.md)）、IaC は Terraform（[infra/](infra/README.md)）で、Organizations に依存しない。理由は [docs/adr/](docs/adr/)。

## 開発フロー

- 作業ガイドは [CLAUDE.md](CLAUDE.md) を参照。
- 設計判断（Why / Why not）は [docs/adr/](docs/adr/) に記録する。
- タスクは GitHub Issue で管理する（`.claude/skills/create-issue` → `.claude/skills/work-issue`）。

## コミット前の検査

このリポジトリは公開する前提で扱う（[docs/adr/0004](docs/adr/0004-treat-as-public-from-day-one.md)）。コミットのたびに、`private/` のファイルがステージされていないか、禁止語や秘密情報・個人情報の形が含まれていないかを検査する（[.githooks/](.githooks/)）。clone したら最初に入れる。

1. git 2.31 以上、Python 3.9 以上（検査フックの前提）、[gitleaks](https://github.com/gitleaks/gitleaks) を入れる（Windows なら `winget install Gitleaks.Gitleaks`、macOS なら `brew install gitleaks`、Linux なら [リリース](https://github.com/gitleaks/gitleaks/releases)のバイナリを PATH に置く）。PATH に置けないときは、環境変数 `GITLEAKS` に実行ファイルを指定する。
2. `git config core.hooksPath .githooks` を実行する。
3. `private/denylist.txt` に禁止語を1行1語で書く（UTF-8。空行と `#` で始まる行は無視される。全角・半角と大文字・小文字の違いは吸収する）。このファイルが無いか空のときは、検査できないのでコミットを止める。worktree からコミットしても、メインの作業ツリーの `private/denylist.txt` を使う。別の場所に置くなら、環境変数 `SHIRABE_CHORD_DENYLIST` に指定する。

検査に引っかかったときは、ファイル名・行番号・ルール番号（禁止語リストの行番号か gitleaks のルールID）だけが出る。一致した語や、禁止語を含むファイル名は出さない（何番目のファイルかだけを出す）。伏せたファイルは本人が確かめる。

防げないもの（cherry-pick と rebase のコミット、1行ごとの部分一致では拾えない書き方、`core.hooksPath` が効かないブランチなど）は [.githooks/README.md](.githooks/README.md) と [ADR 0004](docs/adr/0004-treat-as-public-from-day-one.md) を参照。

検査そのもののテストは `python -m unittest discover -s .githooks` で流す。
