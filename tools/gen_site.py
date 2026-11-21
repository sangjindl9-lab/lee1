#!/usr/bin/env python3
"""Railway에 올리는 정적 안내 사이트(개인정보처리방침·지원) 4개 언어 생성. 사용: python3 tools/gen_site.py"""
import os, html
OUT = os.path.join(os.path.dirname(__file__), "..", "site", "public")
EMAIL = "pm999@naver.com"
DEV = "이음소프트웨어 (EUM Software)"
DATE = "2026-11-21"  # 쇼핑몰 가져오기 추가 반영
LANGS = ["ko", "en", "ja", "es"]
NAMES = {"ko": "한국어", "en": "English", "ja": "日本語", "es": "Español"}

T = {
"ko": dict(
 app="이음 구매노트", tag="주문 화면이나 영수증을 공유하면 구매를 기록하고, 반품·교환·AS 기한을 챙기고, 필요할 때 증빙을 바로 찾는 앱",
 points=["가입·로그인 없이 바로 사용", "기록과 사진은 이 휴대폰 안에만 저장 (서버로 보내지 않음)", "사진 속 글자는 휴대폰 안에서 읽고, 맞는 값을 직접 골라 저장",
         "기한 3일 전·당일 알림 (바꾸거나 끌 수 있음)", "큰 글씨·간편 보기, 한국어·영어·일본어·스페인어"],
 status="현재 사내 테스트 중이며 스토어에 출시되지 않았습니다.",
 privacy="개인정보 처리방침", support="도움말·문의", home="처음으로",
 p_title="이음 구매노트 개인정보 처리방침",
 p=[("요약", ["이음 구매노트(이하 ‘앱’)는 개인정보를 수집하거나 외부로 보내지 않습니다. 가입·로그인·광고·추적·외부 분석 도구가 없습니다.",
              "구매 기록과 사진은 휴대폰 밖으로 보내지 않습니다. 인터넷은 아래 ‘쇼핑몰 화면 가져오기’에만 사용합니다."]),
    ("쇼핑몰 화면 가져오기", ["사용자가 고른 쇼핑몰(예: 쿠팡, 네이버, 아마존) 공식 사이트를 앱 안 브라우저로 엽니다. 로그인은 사용자가 그 사이트에 직접 하며, 앱은 아이디·비밀번호를 읽거나 저장하지 않습니다.",
              "사용자가 ‘이 화면 가져오기’를 누를 때만 지금 보이는 주문 내역 화면의 글자를 휴대폰 안에서 읽어 구매 기록으로 만듭니다. 이 내용은 운영자 서버로 보내지 않습니다.",
              "쇼핑몰 사이트와의 통신과 로그인 상태(쿠키)는 해당 쇼핑몰의 개인정보 처리방침을 따릅니다. 설정 > ‘쇼핑몰 로그인 정보 지우기’로 언제든 지울 수 있습니다.",
              "가져오기 규칙(쇼핑몰 화면을 읽는 방법)은 이 안내 서버에서 내려받습니다. 이때 개인정보는 보내지 않습니다."]),
    ("앱이 휴대폰 안에 저장하는 정보", ["사용자가 입력하거나 고른 구매 정보: 상품명, 구매처, 주문일, 금액·통화, 주문번호, 구매처 링크, 메모, 반품·교환·AS 기한, 상태, 알림 설정.",
              "사용자가 공유하거나 직접 고른 사진의 사본과, 그 사진에서 휴대폰 안에서 읽은 글자.",
              "이 정보는 앱 전용 저장 공간에만 있으며 운영자는 볼 수 없습니다. 안드로이드 자동 클라우드 백업·기기 간 이전 대상에서도 제외했습니다."]),
    ("사진과 글자 인식", ["앱은 사용자가 공유하거나 시스템 사진 선택 화면에서 고른 파일만 읽습니다. 사진·저장소 전체 접근 권한을 요청하지 않으며, 갤러리의 원본 사진을 지우거나 바꾸지 않습니다.",
              "글자 인식은 앱에 포함된 Google ML Kit 기기 내 모델로 휴대폰 안에서 처리하며, 사진이나 인식 결과를 외부로 보내지 않습니다. ML Kit의 사용 통계 전송 기능은 앱에서 제거했습니다."]),
    ("권한", ["인터넷: 쇼핑몰 화면 가져오기와 가져오기 규칙 받기에만 사용합니다.", "알림(선택): 사용자가 정한 기한 알림을 보내기 위해 사용합니다. 거부해도 앱 안에서 기한을 볼 수 있습니다. 잠금 화면에는 상품명·주문번호가 보이지 않는 알림만 표시됩니다.",
              "부팅 완료 수신: 휴대폰을 다시 켠 뒤 알림을 다시 예약하기 위해 사용합니다."]),
    ("백업", ["사용자가 요청할 때만, 사용자가 고른 위치에 암호를 건 백업 파일(AES-256)을 만듭니다. 그 위치가 클라우드 서비스라면 해당 서비스의 정책이 적용됩니다. 암호를 잊으면 운영자도 복원할 수 없습니다."]),
    ("보관과 삭제", ["정보는 사용자가 지우거나 앱을 삭제할 때까지 휴대폰에 남습니다. 설정 > ‘모든 데이터 삭제’로 언제든 지울 수 있습니다.",
              "백업 파일 없이 앱을 삭제하면 기록을 되살릴 수 없습니다."]),
    ("제3자 제공", ["운영자는 정보를 받지 않으므로 제3자에게 제공하거나 판매하지 않습니다."]),
    ("아동", ["이 앱은 연령을 묻지 않으며, 어린이를 주 대상으로 만든 앱이 아닙니다. 어떤 연령의 사용자 정보도 수집하지 않습니다."]),
    ("이 안내 페이지", ["이 웹페이지를 제공하는 서버(Railway)는 일반적인 접속 기록(IP 주소, 시각, 요청 주소)을 운영 목적으로 일정 기간 남길 수 있습니다. 이 페이지는 쿠키나 분석 도구를 쓰지 않습니다."]),
    ("문의·변경", [f"문의: {EMAIL} ({DEV})", f"방침이 바뀌면 이 페이지에 게시합니다. 시행일: {DATE} (사내 테스트 버전 기준)"])],
 s_title="도움말·문의",
 s=[("주문 화면을 어떻게 저장하나요?", "쇼핑 앱에서 주문 내역을 열고 ‘공유’를 누른 뒤 ‘이음 구매노트’를 고르세요. 캡처한 화면은 갤러리에서 열고 공유하면 됩니다. 홈의 ‘구매 추가’로 직접 입력할 수도 있습니다."),
    ("글자를 잘못 읽었어요", "앱은 읽은 값을 자동으로 넣지 않습니다. 후보 중 맞는 값을 누르거나 직접 고쳐 주세요. ‘글자 언어’를 바꿔 다시 읽을 수도 있습니다."),
    ("기한은 자동으로 정해지나요?", "아니요. 영수증에 적혀 있고 사용자가 확인한 날짜나 직접 입력한 날짜만 저장합니다. ‘수령 후 7일’처럼 기준일이 분명하지 않으면 비워 두고 안내합니다."),
    ("알림이 늦게 오거나 안 와요", "휴대폰 절전 설정에 따라 늦을 수 있습니다. 알림 권한이 꺼져 있으면 설정에서 켜 주세요. 기한은 앱 홈에서 항상 볼 수 있습니다."),
    ("휴대폰을 바꾸면요?", "설정 > 백업·복원에서 암호 백업 파일을 만들어 새 휴대폰으로 옮긴 뒤 복원하세요. 암호를 잊으면 복원할 수 없습니다."),
    ("데이터를 지우고 싶어요", "설정 > ‘모든 데이터 삭제’를 누르세요. 갤러리의 원본 사진은 지워지지 않습니다.")],
 contact=f"문의: {EMAIL}"),
"en": dict(
 app="EUM Purchase Note", tag="Share an order screen or receipt to log a purchase, keep track of return, exchange and repair deadlines, and find your proof of purchase when you need it.",
 points=["No sign-up or login", "Records and photos stay on your phone (never sent to a server)", "Text in photos is read on the phone; you pick the right values",
         "Reminders 3 days before and on the day (changeable or off)", "Large text and Easy view; Korean, English, Japanese, Spanish"],
 status="Currently in internal testing. Not yet released on any store.",
 privacy="Privacy policy", support="Help & contact", home="Home",
 p_title="EUM Purchase Note Privacy Policy",
 p=[("Summary", ["EUM Purchase Note (“the app”) does not collect personal data or send it anywhere. There is no sign-up, login, advertising, tracking or third-party analytics.",
                 "Your records and photos never leave your phone. The internet is used only for “Import from a shopping site” below."]),
    ("Import from a shopping site", ["The app opens the official site of a shop you choose (e.g. Coupang, Naver, Amazon) in an in-app browser. You sign in on that site yourself; the app never reads or saves your ID or password.",
                 "Only when you tap “Import this page”, the text of the order page you are viewing is read on your phone and turned into purchase records. It is not sent to our server.",
                 "Traffic with the shopping site and its sign-in state (cookies) follow that shop's privacy policy. You can clear them any time in Settings > “Clear shopping site sign-ins”.",
                 "Import rules (how to read shop pages) are downloaded from this site. No personal data is sent."]),
    ("What the app stores on your phone", ["Purchase details you enter or choose: product name, store, order date, amount and currency, order number, store link, memo, return/exchange/repair deadlines, status and reminder settings.",
                 "Copies of photos you share or pick, and the text read from them on the phone.",
                 "This stays in the app's private storage; we cannot see it. It is excluded from Android's automatic cloud backup and device-to-device transfer."]),
    ("Photos and text recognition", ["The app only reads files you share with it or pick in the system photo picker. It does not ask for access to all photos or storage, and never deletes or changes originals in your gallery.",
                 "Text is read on the phone with Google ML Kit's on-device models bundled in the app; photos and recognized text are not sent anywhere. ML Kit's usage-statistics upload has been removed from the app."]),
    ("Permissions", ["Internet: only for importing from shopping sites and downloading import rules.", "Notifications (optional): to send the deadline reminders you set. If you decline, you can still see deadlines in the app. The lock screen shows only a version without product name or order number.",
                 "Run at startup (boot completed): to re-schedule reminders after the phone restarts."]),
    ("Backup", ["Only when you ask, the app writes a password-encrypted backup file (AES-256) to a location you choose. If that location is a cloud service, that service's policy applies. If you forget the password, nobody can restore it."]),
    ("Retention and deletion", ["Data stays on your phone until you delete it or uninstall the app. Use Settings > “Delete all data” at any time.",
                 "If you uninstall without a backup file, your records cannot be recovered."]),
    ("Sharing with third parties", ["We do not receive your data, so we do not share or sell it."]),
    ("Children", ["The app does not ask for age and is not designed primarily for children. It collects no data from users of any age."]),
    ("This web page", ["The server that hosts this page (Railway) may keep standard access logs (IP address, time, requested URL) for operations. This page uses no cookies or analytics."]),
    ("Contact and changes", [f"Contact: {EMAIL} ({DEV})", f"Changes will be posted on this page. Effective: {DATE} (internal test version)"])],
 s_title="Help & contact",
 s=[("How do I save an order?", "Open the order in your shopping app, tap Share and choose “EUM Purchase Note”. For a screenshot, open it in your gallery and share it. You can also tap “Add purchase” and type it in."),
    ("The text was read wrong", "Nothing is filled in automatically. Tap the correct suggestion or fix it yourself. You can also change “Text language” and read again."),
    ("Are deadlines set automatically?", "No. Only dates written on the receipt that you confirm, or dates you enter, are saved. If the start date is unclear (e.g. “within 7 days of delivery”) the deadline is left empty."),
    ("Reminders are late or missing", "Battery saving can delay them. If notifications are off, turn them on in Settings. Deadlines are always shown on the home screen."),
    ("Changing phones", "Make an encrypted backup in Settings > Backup and restore, move the file to the new phone and restore it. Without the password it can't be restored."),
    ("Deleting my data", "Tap Settings > “Delete all data”. Photos in your gallery are not deleted.")],
 contact=f"Contact: {EMAIL}"),
"ja": dict(
 app="EUM 購入ノート", tag="注文画面やレシートを共有して購入を記録し、返品・交換・修理の期限を管理し、必要なときに証明をすぐ見つけられるアプリです。",
 points=["登録・ログイン不要", "記録と写真はこの端末だけに保存(サーバーに送信しない)", "写真の文字は端末内で読み取り、正しい値を自分で選択",
         "期限の3日前と当日に通知(変更・オフ可)", "大きな文字・かんたん表示、韓国語・英語・日本語・スペイン語"],
 status="現在は社内テスト中で、ストアでは公開していません。",
 privacy="プライバシーポリシー", support="ヘルプ・お問い合わせ", home="トップ",
 p_title="EUM 購入ノート プライバシーポリシー",
 p=[("概要", ["EUM 購入ノート(以下「本アプリ」)は個人情報を収集せず、外部へ送信しません。登録・ログイン・広告・追跡・外部分析ツールはありません。",
             "購入記録と写真は端末の外に送りません。インターネットは下記「ショッピングサイトから取り込む」にのみ使います。"]),
    ("ショッピングサイトから取り込む", ["利用者が選んだショップ(例:Coupang、NAVER、Amazon)の公式サイトをアプリ内ブラウザで開きます。ログインは利用者がそのサイトで行い、アプリはIDやパスワードを読み取ったり保存したりしません。",
             "「この画面を取り込む」を押したときだけ、表示中の注文履歴画面の文字を端末内で読み取り購入記録にします。運営者のサーバーには送りません。",
             "ショッピングサイトとの通信とログイン状態(Cookie)はそのショップのプライバシーポリシーに従います。設定 >「ログイン情報を消去」でいつでも消せます。",
             "取り込みルールはこのサイトからダウンロードします。個人情報は送りません。"]),
    ("端末内に保存する情報", ["利用者が入力・選択した購入情報:商品名、購入先、注文日、金額・通貨、注文番号、購入先リンク、メモ、返品・交換・修理期限、状態、通知設定。",
             "利用者が共有または選択した写真のコピーと、端末内で読み取った文字。",
             "これらはアプリ専用領域にのみ保存され、運営者は見ることができません。Android の自動クラウドバックアップ・端末間移行の対象外です。"]),
    ("写真と文字認識", ["本アプリは利用者が共有したファイル、またはシステムの写真選択画面で選んだファイルだけを読み取ります。写真・ストレージ全体へのアクセス権限は求めず、ギャラリーの元の写真を削除・変更しません。",
             "文字認識はアプリに含まれる Google ML Kit の端末内モデルで行い、写真や認識結果は送信しません。ML Kit の利用統計送信機能はアプリから削除しています。"]),
    ("権限", ["インターネット:ショッピングサイトからの取り込みとルール取得にのみ使います。", "通知(任意):利用者が設定した期限の通知に使います。拒否しても期限はアプリで確認できます。ロック画面には商品名・注文番号を含まない通知だけが表示されます。",
             "起動完了の受信:端末の再起動後に通知を再設定するために使います。"]),
    ("バックアップ", ["利用者が依頼したときだけ、選んだ場所にパスワードで暗号化したファイル(AES-256)を作成します。保存先がクラウドの場合はそのサービスの規約が適用されます。パスワードを忘れると運営者も復元できません。"]),
    ("保存期間と削除", ["情報は利用者が削除するかアプリを削除するまで端末に残ります。設定 >「すべてのデータを削除」でいつでも削除できます。",
             "バックアップなしでアプリを削除すると、記録は復元できません。"]),
    ("第三者提供", ["運営者は情報を受け取らないため、第三者への提供・販売は行いません。"]),
    ("子ども", ["本アプリは年齢を尋ねず、子どもを主な対象としたアプリではありません。どの年齢の利用者の情報も収集しません。"]),
    ("このページについて", ["このページを提供するサーバー(Railway)は、運用のため一般的なアクセス記録(IPアドレス、時刻、要求URL)を一定期間保存する場合があります。このページは Cookie や分析ツールを使いません。"]),
    ("お問い合わせ・変更", [f"お問い合わせ:{EMAIL}({DEV})", f"変更はこのページに掲載します。施行日:{DATE}(社内テスト版)"])],
 s_title="ヘルプ・お問い合わせ",
 s=[("注文画面の保存方法は?", "ショッピングアプリで注文内容を開き「共有」をタップし「EUM 購入ノート」を選びます。スクリーンショットはギャラリーで開いて共有します。ホームの「購入を追加」から手入力もできます。"),
    ("文字が正しく読めていません", "読み取った値は自動入力されません。正しい候補をタップするか、直接修正してください。「文字の言語」を変えて読み直すこともできます。"),
    ("期限は自動で決まりますか?", "いいえ。レシートに書かれ利用者が確認した日付、または入力した日付だけを保存します。「受け取り後7日」のように起算日が不明な場合は空欄のままにします。"),
    ("通知が遅い・来ない", "省電力設定により遅れることがあります。通知がオフの場合は設定でオンにしてください。期限はホーム画面でいつでも確認できます。"),
    ("機種変更するときは?", "設定 > バックアップと復元で暗号化バックアップを作り、新しい端末に移して復元します。パスワードがないと復元できません。"),
    ("データを削除したい", "設定 >「すべてのデータを削除」をタップします。ギャラリーの元の写真は削除されません。")],
 contact=f"お問い合わせ:{EMAIL}"),
"es": dict(
 app="EUM Notas de Compra", tag="Comparte la pantalla del pedido o el recibo para registrar la compra, controlar los plazos de devolución, cambio y garantía, y encontrar el comprobante cuando lo necesites.",
 points=["Sin registro ni inicio de sesión", "Los datos y fotos se quedan en tu teléfono (no se envían a ningún servidor)", "El texto de las fotos se lee en el teléfono; tú eliges los valores correctos",
         "Avisos 3 días antes y el mismo día (se pueden cambiar o desactivar)", "Letra grande y vista fácil; coreano, inglés, japonés y español"],
 status="En pruebas internas. Todavía no está publicada en ninguna tienda.",
 privacy="Política de privacidad", support="Ayuda y contacto", home="Inicio",
 p_title="Política de privacidad de EUM Notas de Compra",
 p=[("Resumen", ["EUM Notas de Compra (“la app”) no recopila datos personales ni los envía a ningún lugar. No hay registro, inicio de sesión, publicidad, seguimiento ni analítica de terceros.",
                 "Tus datos y fotos nunca salen del teléfono. Internet solo se usa para «Importar de una tienda en línea»."]),
    ("Importar de una tienda en línea", ["La app abre la web oficial de la tienda que elijas (p. ej. Coupang, Naver, Amazon) en un navegador integrado. Inicias sesión tú en esa web; la app nunca lee ni guarda tu usuario o contraseña.",
                 "Solo cuando tocas «Importar esta página», el texto de la página de pedidos que estás viendo se lee en el teléfono y se convierte en compras. No se envía a nuestro servidor.",
                 "La comunicación con la tienda y su sesión (cookies) se rigen por la política de privacidad de esa tienda. Puedes borrarlas en Ajustes > «Borrar inicios de sesión de tiendas».",
                 "Las reglas de importación se descargan de esta web. No se envían datos personales."]),
    ("Qué guarda la app en tu teléfono", ["Los datos de compra que escribes o eliges: producto, tienda, fecha del pedido, importe y moneda, número de pedido, enlace, nota, plazos de devolución/cambio/garantía, estado y avisos.",
                 "Copias de las fotos que compartes o eliges, y el texto leído de ellas en el teléfono.",
                 "Todo queda en el almacenamiento privado de la app; nosotros no podemos verlo. Está excluido de la copia automática en la nube de Android y de la transferencia entre dispositivos."]),
    ("Fotos y lectura de texto", ["La app solo lee los archivos que compartes con ella o eliges en el selector de fotos del sistema. No pide acceso a todas las fotos ni al almacenamiento, y nunca borra ni cambia los originales de tu galería.",
                 "El texto se lee en el teléfono con los modelos de Google ML Kit incluidos en la app; las fotos y el texto no se envían. Se eliminó de la app el envío de estadísticas de uso de ML Kit."]),
    ("Permisos", ["Internet: solo para importar de tiendas y descargar las reglas de importación.", "Notificaciones (opcional): para enviar los avisos de plazos que configures. Si las rechazas, puedes seguir viendo los plazos en la app. En la pantalla de bloqueo solo se muestra una versión sin producto ni número de pedido.",
                 "Inicio del sistema: para volver a programar los avisos tras reiniciar el teléfono."]),
    ("Copia de seguridad", ["Solo cuando lo pides, la app crea un archivo cifrado con contraseña (AES-256) en el lugar que elijas. Si ese lugar es un servicio en la nube, se aplica su política. Si olvidas la contraseña, nadie puede restaurarlo."]),
    ("Conservación y eliminación", ["Los datos quedan en el teléfono hasta que los borres o desinstales la app. Usa Ajustes > «Eliminar todos los datos» cuando quieras.",
                 "Si desinstalas sin un archivo de copia, no podrás recuperar tus datos."]),
    ("Terceros", ["No recibimos tus datos, así que no los compartimos ni los vendemos."]),
    ("Menores", ["La app no pregunta la edad y no está diseñada principalmente para niños. No recopila datos de usuarios de ninguna edad."]),
    ("Esta página web", ["El servidor que aloja esta página (Railway) puede guardar registros de acceso habituales (dirección IP, hora, URL) para su funcionamiento. Esta página no usa cookies ni analítica."]),
    ("Contacto y cambios", [f"Contacto: {EMAIL} ({DEV})", f"Los cambios se publicarán en esta página. Vigente desde: {DATE} (versión de prueba interna)"])],
 s_title="Ayuda y contacto",
 s=[("¿Cómo guardo un pedido?", "Abre el pedido en la app de compras, toca Compartir y elige «EUM Notas de Compra». Si es una captura, ábrela en la galería y compártela. También puedes tocar «Añadir compra» y escribirlo."),
    ("Leyó mal el texto", "No se rellena nada automáticamente. Toca la sugerencia correcta o corrígela. También puedes cambiar el «Idioma del texto» y leer de nuevo."),
    ("¿Los plazos se ponen solos?", "No. Solo se guardan fechas escritas en el recibo que confirmas, o las que escribes. Si no está clara la fecha de inicio (p. ej. «7 días desde la entrega»), el plazo queda vacío."),
    ("Los avisos llegan tarde o no llegan", "El ahorro de batería puede retrasarlos. Si las notificaciones están desactivadas, actívalas en Ajustes. Los plazos siempre se ven en la pantalla de inicio."),
    ("Cambiar de teléfono", "Crea una copia cifrada en Ajustes > Copia de seguridad y restauración, pásala al nuevo teléfono y restáurala. Sin la contraseña no se puede restaurar."),
    ("Borrar mis datos", "Toca Ajustes > «Eliminar todos los datos». Las fotos de tu galería no se borran.")],
 contact=f"Contacto: {EMAIL}"),
}

CSS = """:root{color-scheme:light dark;--fg:#191c1b;--muted:#3f4947;--bg:#f8faf9;--card:#eef2f1;--brand:#1f5e57}
@media(prefers-color-scheme:dark){:root{--fg:#e1e3e1;--muted:#c0c9c6;--bg:#111413;--card:#1d2120;--brand:#8dd3c8}}
*{box-sizing:border-box}body{margin:0;font:17px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans KR","Noto Sans JP",sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:760px;margin:0 auto;padding:28px 20px 64px}a{color:var(--brand)}h1{font-size:1.7rem;line-height:1.3;margin:.2em 0 .4em}
h2{font-size:1.15rem;margin:1.8em 0 .4em}nav{display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:18px}nav a{display:inline-block;min-height:44px;padding:10px 0}
.card{background:var(--card);border-radius:14px;padding:16px 20px;margin:14px 0}.muted{color:var(--muted)}ul{padding-left:1.2em}li{margin:.3em 0}
.lang a{display:inline-block;min-height:44px;padding:10px 14px;margin:4px;border:1px solid var(--muted);border-radius:10px;text-decoration:none}"""

def page(lang, title, body):
    langs = " · ".join(f'<a href="/{l}/" hreflang="{l}">{NAMES[l]}</a>' for l in LANGS)
    t = T[lang]
    return f"""<!DOCTYPE html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>{CSS}</style></head><body><main>
<nav aria-label="menu"><a href="/{lang}/">{t['home']}</a><a href="/{lang}/privacy.html">{t['privacy']}</a><a href="/{lang}/support.html">{t['support']}</a></nav>
{body}<p class="muted" style="margin-top:40px">{langs}</p></main></body></html>"""

def esc(s): return html.escape(s)
for lang in LANGS:
    t = T[lang]; d = os.path.join(OUT, lang); os.makedirs(d, exist_ok=True)
    idx = f"<h1>{esc(t['app'])}</h1><p>{esc(t['tag'])}</p><div class='card'><ul>" + "".join(f"<li>{esc(x)}</li>" for x in t['points']) + \
          f"</ul></div><p class='muted'>{esc(t['status'])}</p><p>{esc(t['contact'])}</p>"
    open(os.path.join(d, "index.html"), "w").write(page(lang, t['app'], idx))
    pr = f"<h1>{esc(t['p_title'])}</h1>" + "".join(f"<h2>{esc(h)}</h2>" + "".join(f"<p>{esc(x)}</p>" for x in ps) for h, ps in t['p'])
    open(os.path.join(d, "privacy.html"), "w").write(page(lang, t['p_title'], pr))
    su = f"<h1>{esc(t['s_title'])}</h1>" + "".join(f"<div class='card'><h2 style='margin-top:0'>{esc(q)}</h2><p>{esc(a)}</p></div>" for q, a in t['s']) + f"<p>{esc(t['contact'])}</p>"
    open(os.path.join(d, "support.html"), "w").write(page(lang, t['s_title'], su))
root = "<h1>EUM Purchase Note · 이음 구매노트</h1><p class='lang'>" + "".join(f'<a href="/{l}/" hreflang="{l}">{NAMES[l]}</a>' for l in LANGS) + "</p>"
open(os.path.join(OUT, "index.html"), "w").write(page("en", "EUM Purchase Note", root))
print("ok")
