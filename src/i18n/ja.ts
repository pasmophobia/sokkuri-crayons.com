/**
 * 日本語の文言。鍵の集合はここが正で、他の言語はこれに型で縛られる
 * （`src/i18n/en.ts` を参照）。追加するときは必ずここから。
 *
 * 値の中の `{name}` は差し込み。`{link}` だけは特別扱いで、リンクを挟む文に
 * 使い、`tSplit()` が前後に切り分ける。
 */

export const ja = {
	"common.brand": "そっくりクレヨン",
	"common.anonymous": "名無し",
	"common.noCaption": "（キャプションなし）",
	"common.language": "言語",

	"nav.timeline": "タイムライン",
	"nav.friends": "フレンド",
	"nav.newPost": "投稿する",
	"nav.account": "アカウント",
	"nav.signIn": "ログイン",
	"nav.signUp": "登録",
	"nav.signOut": "ログアウト",
	"nav.statement": "ステートメント",
	"nav.privacy": "プライバシーポリシー",
	"nav.menuOpen": "メニューを開く",
	"nav.menuClose": "メニューを閉じる",

	"footer.tagline": "写真をなぞって落書きと歪みを重ね、フレンドと見せ合うための小さな場所です。",

	"feed.title": "タイムライン",
	"feed.empty": "まだ投稿がありません。",
	"feed.emptyPostCta": "最初の 1 枚を投稿",
	"feed.emptySignUpCta": "登録すると投稿できます",
	"feed.friendsOnly": "フレンドのみ",

	"post.title": "投稿",
	"post.friendsOnly": "フレンドのみ",
	"post.delete": "削除",
	"post.deleteWarning": "この投稿を削除します。重ねられた落書きもまとめて消え、元には戻せません。",
	"post.deleteConfirm": "削除する",
	"post.deleting": "削除中…",
	"post.deleteCancel": "やめる",
	"post.deleteFailed": "削除できませんでした",

	"canvas.live": "ライブ",
	"canvas.connecting": "接続中…",
	"canvas.tool": "道具",
	"canvas.toolStroke": "落書き",
	"canvas.toolDisplace": "歪み",
	"canvas.toolText": "文字",
	"canvas.displaceMode": "歪み方",
	"canvas.displaceSmudge": "なすりつけ",
	"canvas.displaceBulge": "膨らみ",
	"canvas.displacePinch": "へこみ",
	"canvas.displaceSwirl": "渦",
	"canvas.strength": "強さ",
	"canvas.color": "色",
	"canvas.blend": "合成",
	"canvas.blendNormal": "通常",
	"canvas.blendMultiply": "乗算",
	"canvas.blendScreen": "スクリーン",
	"canvas.blendOverlay": "オーバーレイ",
	"canvas.text": "文字",
	"canvas.textPlaceholder": "置きたい文字",
	"canvas.radius": "半径",
	"canvas.thickness": "太さ",
	"canvas.undo": "取り消す",
	"canvas.signInToEdit": "{link}すると、この画像に落書きや歪みを加えられます。",
	"canvas.imageLoadFailed": "画像を読み込めませんでした。",
	"canvas.errorPostNotPublic": "この投稿は公開されていません。",

	"newPost.title": "投稿する",
	"newPost.image": "画像",
	"newPost.camera": "カメラで撮る",
	"newPost.choosePhoto": "写真を選ぶ",
	"newPost.chooseImage": "画像を選ぶ",
	"newPost.sizeNote": "大きい写真は縮めて送ります（{mb}MB まで）。",
	"newPost.caption": "キャプション",
	"newPost.visibility": "公開範囲",
	"newPost.visibilityFriends": "フレンドのみ",
	"newPost.visibilityPublic": "全体公開",
	"newPost.noFriendsNote":
		"いまフレンドがいないので、この投稿は自分だけが見られます。{link}すると共有されます。",
	"newPost.noFriendsNoteLink": "フレンドを追加",
	"newPost.submit": "投稿する",
	"newPost.publicNote": "投稿すると、誰でもこの画像に落書きや歪みを加えられます。",
	"newPost.friendsNote": "フレンドだけが閲覧でき、落書きや歪みを加えられます。",
	"newPost.uploading": "アップロード中…",
	"newPost.posting": "投稿中…",
	"newPost.uploadFailed": "アップロードできませんでした",
	"newPost.postFailed": "投稿できませんでした",

	"image.tooLarge": "画像が大きすぎます",
	"image.loadFailed": "画像を読み込めませんでした",
	"image.processFailed": "画像を処理できませんでした",
	"image.convertFailed": "画像を変換できませんでした",

	"signIn.title": "ログイン",
	"signIn.email": "メールアドレス",
	"signIn.password": "パスワード",
	"signIn.submit": "ログイン",
	"signIn.pending": "ログイン中…",
	"signIn.failed": "ログインできませんでした",
	"signIn.unverified": "メールアドレスがまだ確認されていません。",
	"signIn.resend": "確認メールを送り直す",
	"signIn.resent": "確認メールを送り直しました。",
	"signIn.forgot": "パスワードを忘れた場合",
	"signIn.toSignUp": "アカウントがない場合は {link}。",

	"signUp.title": "アカウント登録",
	"signUp.name": "表示名",
	"signUp.username": "ユーザー名（英数字と _、3〜20 文字）",
	"signUp.email": "メールアドレス（ログイン用）",
	"signUp.password": "パスワード（8 文字以上）",
	"signUp.submit": "登録する",
	"signUp.pending": "登録中…",
	"signUp.failed": "登録できませんでした",
	"signUp.sent": "確認メールを送りました。本文のリンクを開くとアカウントが有効になります。",
	"signUp.toSignIn": "登録済みの場合は {link}。",

	"forgot.title": "パスワードの再設定",
	"forgot.pageTitle": "パスワードを忘れた",
	"forgot.lead": "登録したメールアドレスに、再設定用のリンクを送ります。",
	"forgot.email": "メールアドレス",
	"forgot.submit": "再設定リンクを送る",
	"forgot.pending": "送信中…",
	"forgot.sent":
		"再設定用のリンクを送りました。メールが届かない場合、そのアドレスは登録されていないか、迷惑メールに振り分けられている可能性があります。",
	"forgot.backToSignIn": "ログインに戻る",

	"reset.title": "パスワードの再設定",
	"reset.heading": "新しいパスワード",
	"reset.password": "新しいパスワード（8 文字以上）",
	"reset.submit": "この内容で設定する",
	"reset.pending": "設定中…",
	"reset.failed": "再設定できませんでした。リンクの期限が切れているかもしれません。",
	"reset.badToken": "リンクが正しくないか、期限が切れています。{link}ください。",
	"reset.badTokenLink": "もう一度送り直して",

	"account.title": "アカウント",
	"account.displayName": "表示名",
	"account.username": "ユーザー名",
	"account.usernameUnset": "未設定",
	"account.email": "メールアドレス",
	"account.joined": "登録日",
	"account.posts": "投稿",
	"account.friends": "フレンド",

	"account.nameSection": "表示名",
	"account.nameDescription": "投稿やフレンド一覧に出る名前です。重複してもかまいません。",
	"account.nameRequired": "表示名を入力してください",
	"account.usernameSection": "ユーザー名",
	"account.usernameDescription": "フレンドを探してもらうときに相手へ伝える名前です。",
	"account.usernameField": "ユーザー名（英数字と _、3〜20 文字）",
	"account.usernameRejected": "そのユーザー名は使えません",
	"account.emailSection": "メールアドレス",
	"account.emailDescription":
		"ログインに使うアドレスです。確認メールは送られず、その場で切り替わります。",
	"account.emailUnchanged": "現在のアドレスと同じです",
	"account.emailTakenNote":
		"すでに他の人が使っているアドレスは、そのままでは切り替わりません。変更後に表示が変わっていなければ、そのアドレスは使えません。",
	"account.passwordSection": "パスワード",
	"account.currentPassword": "現在のパスワード",
	"account.newPassword": "新しいパスワード（8 文字以上）",
	"account.passwordChanged": "パスワードを変更しました。他の端末のログインは解除されています。",
	"account.change": "変更する",
	"account.set": "設定する",
	"account.changeFailed": "変更できませんでした",

	"account.avatarChange": "変更する",
	"account.avatarSet": "アイコンを設定",
	"account.avatarClear": "外す",
	"account.avatarPending": "処理中…",
	"account.avatarUploadFailed": "アップロードできませんでした",
	"account.avatarSetFailed": "設定できませんでした",
	"account.avatarClearFailed": "外せませんでした",

	"authError.INVALID_PASSWORD": "現在のパスワードが違います",
	"authError.PASSWORD_TOO_SHORT": "パスワードが短すぎます",
	"authError.PASSWORD_TOO_LONG": "パスワードが長すぎます",
	"authError.USERNAME_IS_ALREADY_TAKEN": "そのユーザー名はすでに使われています",
	"authError.INVALID_USERNAME": "ユーザー名に使えない文字が含まれています",
	"authError.USERNAME_TOO_SHORT": "ユーザー名が短すぎます",
	"authError.USERNAME_TOO_LONG": "ユーザー名が長すぎます",
	"authError.INVALID_EMAIL": "メールアドレスの形式が正しくありません",
	"authError.USER_ALREADY_EXISTS": "そのメールアドレスは使えません",

	"friends.title": "フレンド",
	"friends.myUsername": "あなたのユーザー名",
	"friends.copy": "コピー",
	"friends.copied": "コピーしました",
	"friends.usernameUnset":
		"まだ設定されていません。{link}で決めると、相手から探してもらえるようになります。",
	"friends.usernameUnsetLink": "アカウント",
	"friends.shareHint": "これを相手に伝えると、フレンド申請してもらえます。",
	"friends.add": "フレンドを追加",
	"friends.theirUsername": "相手のユーザー名",
	"friends.request": "申請する",
	"friends.requested": "申請を送りました。相手の承認待ちです。",
	"friends.incoming": "届いている申請",
	"friends.accept": "承認",
	"friends.decline": "拒否",
	"friends.outgoing": "承認待ち",
	"friends.cancel": "取り消す",
	"friends.list": "フレンド（{count}）",
	"friends.none": "まだフレンドがいません。",
	"friends.remove": "解除",
	"friends.actionFailed": "処理できませんでした",

	"friendsError.usernameRequired": "ユーザー名を入力してください",
	"friendsError.notFound": "そのユーザー名の人は見つかりません",
	"friendsError.self": "自分には申請できません",
	"friendsError.already": "すでにフレンドです",
	"friendsError.pending": "すでに申請済みです",
	"friendsError.noSuchRequest": "その申請はありません",

	"postsError.notOwner": "自分の投稿だけ削除できます",

	"statement.title": "ステートメント",
	"statement.p1":
		"この web サイトは、漫画『ドラえもん』に登場する秘密道具「そっくりクレヨン」を実装した SNS である。「そっくりクレヨン」はスケッチした対象物の見た目をその絵にそっくりかえるクレヨンだ。本編では、のび太の描いた絵を馬鹿にしたスネ夫に対し、のび太がこの道具を使ってスネ夫の顔をぐちゃぐちゃに変えてしまう。",
	"statement.p2":
		"僕は、この道具は人間が現実を自分の意思通りに改変したい欲望を表したものだと考える。一方で、多くの人々がこの道具を手にした場合、現実は複数の人間によって際限なく書き換えられ、極めて混沌とした状態になるはずである。僕はこの混沌が行き着く先が全人類の欲望が平等に満たされた世界なのか、それとも互いの欲望が衝突した破滅的な世界なのかに関心を持った。",
	"statement.p3":
		"そこで本制作では、「そっくりクレヨン」をSNSとして再解釈し、実装した。このSNSでは他人の投稿に対し自由に落書き・変形させることができる。また、編集内容はリアルタイムで全世界に共有される。そのため、一つの投稿は特定の個人の著作物ではなく、全世界のユーザーの介入により絶えず変化していく。",
	"statement.p4":
		"本制作では、他者の作品を自由に改変できる場において、人々の行為が協調的な創作に向かうのか、荒らしや破壊行為の連鎖に向かうのかを検証する。",

	"privacy.title": "プライバシーポリシー",
	"privacy.updated": "最終更新: {date}",
	"privacy.updatedAt": "2026年7月29日",
	"privacy.intro":
		"そっくりクレヨン（以下「本サービス」）は、pasmophobia が個人で運営しています。本ポリシーは、本サービスが利用者の情報をどのように扱うかを説明するものです。",
	"privacy.h1": "1. 取得する情報",
	"privacy.collectAccountTerm": "アカウント情報",
	"privacy.collectAccount":
		"メールアドレス、パスワード（ハッシュ化して保存し、元のパスワードは保持しません）、表示名、ユーザー名、アイコン画像。",
	"privacy.collectPostTerm": "投稿",
	"privacy.collectPost":
		"アップロードした画像、その上に加えた落書きや歪みの操作、キャプション、公開範囲の設定、投稿日時。",
	"privacy.collectFriendTerm": "フレンド関係",
	"privacy.collectFriend": "申請・承認の状態と相手のアカウント。",
	"privacy.collectConnectionTerm": "接続情報",
	"privacy.collectConnection":
		"ログインセッションに紐づく IP アドレスとユーザーエージェント、および Cloudflare が接続元から推定するおおよその地域。不正なログインの検知と、リクエスト数の制限に使います。",
	"privacy.collectCookieTerm": "Cookie",
	"privacy.collectCookie": "ログイン状態を保つためのセッション Cookie。",
	"privacy.noTracking":
		"広告や外部のアクセス解析は導入していないため、行動履歴の追跡目的で情報を集めることはありません。",
	"privacy.h2": "2. 利用目的",
	"privacy.purpose1": "アカウントの作成・認証・維持",
	"privacy.purpose2": "投稿の保存と、公開範囲にしたがった表示",
	"privacy.purpose3": "フレンドの検索と申請の処理",
	"privacy.purpose4": "不正利用の防止、および障害の調査",
	"privacy.h3": "3. 公開範囲",
	"privacy.visibility":
		"投稿は「全体公開」または「フレンドのみ」を選べます。全体公開の投稿は、ログインしていない人を含め、URL を知る誰でも閲覧できます。フレンドのみの投稿は、申請が承認された相手と本人だけが閲覧できます。表示名・ユーザー名・アイコンは、あなたを見つけるための情報として他の利用者に表示されます。",
	"privacy.h4": "4. 保管と委託",
	"privacy.storage":
		"情報は Cloudflare のインフラ上に保存されます。アカウントと投稿の索引は D1、セッションなどの一時データは KV、画像は R2、投稿ごとの編集履歴は Durable Objects に置いています。これらはいずれも保管のための利用であり、上記以外の第三者に情報を渡したり、販売したりすることはありません。ただし、法令にもとづく開示請求があった場合はこの限りではありません。",
	"privacy.h5": "5. 保存期間と削除",
	"privacy.retention":
		"アカウントと投稿は、削除されるまで保存されます。セッションは有効期限が切れると自動的に失効します。アカウントや投稿の削除機能はまだ用意できていないため、削除をご希望の場合は下記の窓口までご連絡ください。削除後も、バックアップから消えるまでに時間がかかる場合があります。",
	"privacy.h6": "6. セキュリティ",
	"privacy.security":
		"通信は HTTPS で暗号化し、パスワードはハッシュ化して保存しています。ただし、いかなる方法をもってしても完全な安全を保証することはできません。心当たりのないログインに気づいた場合は、パスワードを変更のうえご連絡ください。",
	"privacy.h7": "7. お子さまの利用について",
	"privacy.children":
		"13 歳未満の方は本サービスをご利用いただけません。13 歳未満の方の情報を受け取っていることが判明した場合、当該アカウントと関連する情報を削除します。",
	"privacy.h8": "8. 本ポリシーの変更",
	"privacy.changes":
		"内容を変更した場合は、このページを更新し、冒頭の最終更新日を改めます。重要な変更については、サービス内でお知らせすることがあります。",
	"privacy.h9": "9. お問い合わせ",
	"privacy.operator": "運営者: pasmophobia",
	"privacy.contact": "お問い合わせ窓口は準備中です。用意ができ次第、このページに記載します。",

	"mail.verifySubject": "メールアドレスの確認 | そっくりクレヨン",
	"mail.verifyHeading": "メールアドレスを確認してください",
	"mail.verifyBody": "そっくりクレヨンのアカウントを有効にするには、下のボタンを押してください。",
	"mail.verifyAction": "確認する",
	"mail.verifyNote":
		"このリンクは 24 時間で切れます。心当たりがなければ、このメールは無視してください。",
	"mail.resetSubject": "パスワードの再設定 | そっくりクレヨン",
	"mail.resetHeading": "パスワードを再設定します",
	"mail.resetBody": "下のボタンから新しいパスワードを設定してください。",
	"mail.resetAction": "再設定する",
	"mail.resetNote": "心当たりがなければ、このメールは無視してください。パスワードは変わりません。",
} as const;

/** 文言の鍵。`ja` が持つものだけが有効。 */
export type MessageKey = keyof typeof ja;

/** 各言語が満たすべき形。鍵の過不足はここで型エラーになる。 */
export type Messages = Record<MessageKey, string>;
