-- ユーザー名（better-auth の username プラグイン）。
-- ログイン ID はメールのまま。これは人を探すための一意な handle。
-- SQLite は ADD COLUMN に UNIQUE 制約を付けられないので、索引側で一意にする。
alter table "user" add column "username" text;

alter table "user" add column "displayUsername" text;

create unique index "user_username_idx" on "user" ("username");

-- 投稿の既定を friends に変える。
-- 既定値の変更は列の作り直しが要るので、テーブルごと作り替える。
-- 既存の行の値はそのまま引き継ぐ（過去の公開投稿を勝手に隠さない）。
create table "post_new" (
    "id" text not null primary key,
    "authorId" text not null references "user" ("id") on delete cascade,
    "imageKey" text not null,
    "aspectRatio" real not null,
    "caption" text not null default '',
    "createdAt" integer not null,
    "visibility" text not null default 'friends'
);

insert into "post_new" ("id", "authorId", "imageKey", "aspectRatio", "caption", "createdAt", "visibility")
select "id", "authorId", "imageKey", "aspectRatio", "caption", "createdAt", "visibility" from "post";

drop table "post";

alter table "post_new" rename to "post";

create index "post_createdAt_idx" on "post" ("createdAt");

create index "post_authorId_idx" on "post" ("authorId");

create index "post_visibility_idx" on "post" ("visibility");
