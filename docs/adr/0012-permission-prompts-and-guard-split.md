# 0012. 権限の確認は取り返しのつかない操作に絞り、文章の公開は検査に任せる

- **Status**: Active
- **Date**: 2026-11-03

## Context

Auto モードでも確認が頻繁に出て、作業が止まる。原因は、確認を必ず出すルール（`ask`）に置いた操作が多すぎたことと、許可するルール（`allow`）が足りなかったこと（テスト・Terraform の検査・`git` の日常操作）。確認を必ず出すルールは、Auto モードでも効く。

公開する文章は [0010](0010-check-gh-writes-before-sending.md) のフックが、push するコミットは [0011](0011-scan-before-push-and-whole-history.md) の検査が、すでに実行前に止めている。Issue と PR の書き込みは、確認とフックの二重になっていた。

権限のルールはコマンド全体に対する文字列のグロブ照合で、同じ意味でも書き方が違うと抜ける。確認を外すと、そのルールが最後の受け皿だった書き方が素通しになる。実際、`git push` と `cp`・`mv` を許可にする案は、レビューで抜けが見つかり採らなかった。

## Decision

- `allow` に移す: `gh issue` の create・edit・comment・close・reopen、`gh pr` の create・edit・comment、`mkdir`・`touch`。`gh` の書き込みは 0010 のフックの検査だけで通す。0010 の「権限の確認を置き換えず、重ねる」は、この範囲に限り改める。
- `allow` に足す: `python -m unittest`、`git` の fetch・pull・checkout・switch・merge・rebase、`gh pr` の diff・checks、`gh run` の view・list、Terraform の fmt・init・validate・test（`-chdir=infra/bootstrap` 付きは固定。付かない形も許す）。他人の PR を取り込む `gh pr checkout` は許さない（公開リポジトリの PR は信用できない入力で、取り込むと、許可済みのテストやコミットのフックがそのコードを走らせる）。
- `ask` のまま残す: `git push`、`cp`、`mv`、`node`、`npx`、`npm install`、`pip install`、`terraform apply|destroy`（`-chdir=` 付きも）、`git reset --hard`、`gh pr merge`、`gh issue delete`。`gh repo` は `delete|edit|create` に絞る（それ以外は 0010 のフックが止める）。
- 範囲外を指す `ls` の確認は外す。保護した場所の列挙は `block_sensitive_paths` のフックが止める。ホーム直下などの一覧は、名前が見えるだけなので引き受ける。
- `ask` に足す:
  - 任意のコマンドを走らせられる `git` の書き方: `rebase` の `-x`・`--exec`、`--upload-pack`、`--receive-pack`。
  - 作業中の変更を捨てる `git` の書き方: `restore`、`checkout` の `--`・`.`・`-f`・`-B`、`switch` の `--discard-changes`・`--force`・`-f`・`-C`。
- `deny` に足す: `git push*--force*`、`git push* -f*`（オプションが後ろに来る形も止める）。`--force-with-lease` も止まるので、rebase したブランチの更新は本人が実行する。
- 信頼するリポジトリと定常操作の説明は、各自のユーザー設定（`autoMode.environment`）に書く。リポジトリには置かない。

## Consequences

- 日常の操作（Issue・PR・テスト・`git` の基本）は確認なしで進む。push は PR ごとに 1 回、確認が出る。
- 文字列のルールでは防ぎきれない書き方が残る。束ねた短いオプション（`git push -uf`、`git rebase -ix`）、`git checkout <パス>`、変更を捨てる `git stash drop|clear`・`git branch -D`・`git worktree remove --force`。安全な形でも確認が出ることがある（`git restore --staged`、`-x` を含むブランチ名。否定が書けない）。
- テストの実行（`python -m unittest`、`npm run`、`terraform test`）は、書き換えたテストや script の任意のコードを走らせられる。たとえば `terraform test` は、模擬のプロバイダーを外して実際に適用する形に書き換えれば、`terraform apply` の確認を迂回する。自分が書いたコードの範囲では引き受ける。
- `.githooks/` や `.claude/` を `Edit` で書き換えて検査を外す経路は、これまでどおり権限では止めていない。
- main の force push と削除を GitHub のルールセットで止めると、さらに安全になる。設定はリポジトリの管理画面で本人が行う。main 直接運用でも使える（PR 必須にしなければ）。
- `infra/` に Terraform のルートモジュールが増えたら、`-chdir=` 付きの許可を足す。

## Why not

- **push を許可にする**: 保護のない公開リポジトリでは、束ねたオプションや `HEAD:main` など、書き方の違いで main への force push が確認なしで通る。push は PR ごとに 1 回で、確認が出ても手離れへの影響は小さい。
- **ファイルのコピー・移動を許可にする**: `cp -r $HOME work/h` で資格情報を作業ツリーに写せる（写した先は、Read の拒否ルールにもフックにも止められない）。プロジェクトの外のファイルも書き換えられる。
- **Node.js の実行と、パッケージの取得・インストールを許可にする**: `node -e` のように 1 行で任意のコードを走らせ、`curl`・`wget` の拒否や各フックの検査を回避できる。Auto モードでは広く当たる許可が外される可能性もある。
- **ルールをさらに足して文字列で全部防ぐ**: 書き方の数が際限なく、権限設定が読めなくなる。
- **ラッパースクリプトだけを許可し、直接実行を拒否する**: 0010 と同じ理由で、前方一致の拒否は抜けやすい。
