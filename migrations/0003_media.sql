-- 画像を外部 URL 参照から R2 のキー参照に移す。あわせてサムネイルの世代を持つ。
--
-- 破壊的: imageUrl から imageKey への意味のある変換ができないため、既存行は
-- 引き継がない。リモート D1 はまだ作成されておらず、対象はローカルの
-- 開発データのみ。
drop table if exists "post";

create table "post" (
    "id" text not null primary key,
    "authorId" text not null references "user" ("id") on delete cascade,
    -- R2 のオブジェクトキー (originals/<uuid>.<ext>)
    "imageKey" text not null,
    "aspectRatio" real not null,
    "caption" text not null default '',
    -- epoch ms
    "createdAt" integer not null,
    -- サムネイルを最後に焼いた時刻。null なら未生成。URL のキャッシュ破棄にも使う。
    "thumbnailUpdatedAt" integer
);

create index "post_createdAt_idx" on "post" ("createdAt");

create index "post_authorId_idx" on "post" ("authorId");
