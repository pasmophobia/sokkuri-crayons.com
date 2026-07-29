-- フレンド関係と、投稿の公開範囲。
--
-- フレンドは相互承認制。申請から承認までを 1 行で表し、成立後は方向を持たない
-- （どちらが申請したかは残るが、意味の上では対称）。だから照会は常に
-- requesterId / addresseeId の両方向を見る。
create table "friendship" (
    "requesterId" text not null references "user" ("id") on delete cascade,
    "addresseeId" text not null references "user" ("id") on delete cascade,
    -- 'pending' | 'accepted'
    "status" text not null default 'pending',
    "createdAt" integer not null,
    "respondedAt" integer,
    primary key ("requesterId", "addresseeId")
);

create index "friendship_addressee_idx" on "friendship" ("addresseeId", "status");

create index "friendship_requester_idx" on "friendship" ("requesterId", "status");

-- 'public' | 'friends'
-- 既存の投稿はこれまでどおり全体公開のまま。
alter table "post" add column "visibility" text not null default 'public';

create index "post_visibility_idx" on "post" ("visibility");
