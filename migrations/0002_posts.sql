-- 投稿の索引。キャンバスの中身 (committedOps / pendingOps) は Post Durable Object
-- 側に持ち、ここには一覧に必要なメタ情報だけを置く。
create table "post" (
    "id" text not null primary key,
    "authorId" text not null references "user" ("id") on delete cascade,
    "imageUrl" text not null,
    "aspectRatio" real not null,
    "caption" text not null default '',
    -- epoch ms
    "createdAt" integer not null
);

create index "post_createdAt_idx" on "post" ("createdAt");

create index "post_authorId_idx" on "post" ("authorId");
