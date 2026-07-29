# そっくりクレヨンが必要とするストレージ。
#
# ここで扱うのは「デプロイをまたいで残るもの」だけ。Worker 本体・Durable Object・
# バインディングの結線は wrangler が受け持つ（理由は infra/README.md）。

# better-auth の user / session / account
resource "cloudflare_d1_database" "auth" {
  account_id            = var.account_id
  name                  = "${var.name_prefix}-auth"
  primary_location_hint = var.d1_primary_location_hint
}

# better-auth の secondary storage（セッションキャッシュ・レート制限・検証トークン）
resource "cloudflare_workers_kv_namespace" "auth" {
  account_id = var.account_id
  title      = "${var.name_prefix}-auth-kv"
}

# 投稿の元画像とアイコン
resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = "${var.name_prefix}-media"
  location   = var.r2_location
}
