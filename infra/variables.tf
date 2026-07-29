variable "account_id" {
  description = "リソースを作る Cloudflare アカウントの ID。ダッシュボード右下、または `wrangler whoami` で確認できる。"
  type        = string
}

variable "name_prefix" {
  description = "作成するリソース名の接頭辞。環境を分けたい場合はここを変える（例: artc-staging）。"
  type        = string
  default     = "artc"
}

variable "d1_primary_location_hint" {
  description = "D1 の主レプリカを置きたい地域のヒント（apac / weur / eeur / wnam / enam など）。null なら Cloudflare 任せ。"
  type        = string
  default     = null
}

variable "r2_location" {
  description = "R2 バケットの地域ヒント（APAC / EU / ENAM / WNAM）。null なら Cloudflare 任せ。"
  type        = string
  default     = null
}
