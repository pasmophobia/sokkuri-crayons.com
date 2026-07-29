-- サムネイルの事前生成をやめ、一覧も op をその場で描くようにした。
-- 焼いた世代を持つ必要がなくなったので列を落とす。
-- R2 の thumbs/ 配下は参照されなくなるため、別途まとめて削除してよい。
alter table "post" drop column "thumbnailUpdatedAt";
