# infra

そっくりクレヨンが必要とする Cloudflare リソースを Terraform で作る。

## 扱う範囲

Terraform が持つのは**デプロイをまたいで残るもの**だけ。

| リソース | 用途 |
| --- | --- |
| D1 `sokkuri-crayons-auth` | better-auth の user / session / account |
| KV `sokkuri-crayons-auth-kv` | better-auth の secondary storage |
| R2 `sokkuri-crayons-media` | 投稿の元画像とアイコン |

Worker 本体・Durable Object・バインディングの結線は **wrangler が持つ**。ビルド成果物は
Astro が吐くので、同じスクリプトを両方から管理すると必ず食い違う。`wrangler.jsonc`
がバインディングの正で、Terraform はその参照先を用意する係。

## 手順

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars   # account_id を埋める
export CLOUDFLARE_API_TOKEN=...                # 下記の権限が要る

terraform init
terraform plan
terraform apply
```

適用したら、採番された ID を wrangler に反映する。

```sh
bun run infra:sync    # terraform output を読んで wrangler.jsonc を書き換える
```

手で写しても動くが、環境を作り直したときに古い ID が残ると「動いてはいるが別の
リソースを見ている」という気づきにくい壊れ方をするので、スクリプトを通したほうがよい。

その後は通常どおり。

```sh
bun run db:migrate:remote   # 本番 D1 にマイグレーションを当てる
bun run deploy
```

## API トークンに要る権限

アカウント単位で以下を編集可に:

- **D1**
- **Workers KV Storage**
- **Workers R2 Storage**

## Terraform が面倒を見ないもの

- **Worker のデプロイ** — `bun run deploy`（wrangler）。
- **Durable Object** — `wrangler.jsonc` の `migrations` で宣言し、スクリプトに紐づく。
- **`BETTER_AUTH_SECRET`** — `wrangler secret put BETTER_AUTH_SECRET`。
  state に平文で残したくないので Terraform には置かない。
- **メール送信ドメインの登録** — Cloudflare Email Service（送信）は公開ベータで、
  Terraform プロバイダにリソースがまだ無い（あるのは Email *Routing* 用のみ）。
  `sokkuri-crayons.com` をダッシュボードから Email Service に登録すると
  MX / SPF / DKIM / DMARC が自動で入る。Workers Paid が要る。

## state について

いまはローカル state。複数人で触るようになったら R2 バックエンドに移す。
その場合はバケット自体が state より先に必要になるので、バケットだけ手で作るか、
別 workspace に分けることになる。
