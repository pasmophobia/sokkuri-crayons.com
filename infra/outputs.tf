# wrangler.jsonc に書き写す値。`bun run infra:sync` が自動で反映する。

output "d1_database_name" {
  description = "wrangler.jsonc の d1_databases[].database_name"
  value       = cloudflare_d1_database.auth.name
}

output "d1_database_id" {
  description = "wrangler.jsonc の d1_databases[].database_id"
  value       = cloudflare_d1_database.auth.uuid
}

output "kv_namespace_id" {
  description = "wrangler.jsonc の kv_namespaces[].id"
  value       = cloudflare_workers_kv_namespace.auth.id
}

output "r2_bucket_name" {
  description = "wrangler.jsonc の r2_buckets[].bucket_name"
  value       = cloudflare_r2_bucket.media.name
}
