# CANRush 開発概要

CANRush は、USB-CAN アダプタを PC から利用するためのビューワツールとして開発する。slcan だけに限定せず、gs_usb / SocketCAN 系、将来のベンダー SDK 系アダプタも扱える構成にする。

初期ターゲットの USB-CAN アダプタは WeActStudio USB2CANFDV1 とする。このデバイスは SLCAN 互換の仮想シリアルインターフェースを持つが、CAN FD 用の独自拡張も持つため、標準 `slcan` ではなく `weact_slcan_fd` adapter profile として扱う。

## 関連ドキュメント

- [slcan 仕様メモ](./slcan.md)
- [USB-CAN アダプタ対応方針](./usb-can-adapters.md)
- [WeActStudio USB2CANFDV1 対応メモ](./weact-usb2canfdv1.md)

## 想定する利用形態

CANRush は、デスクトップアプリとして提供する。アプリ内部にサーバー機能を持たせ、サーバーが USB-CAN アダプタを直接管理する。GUI と CLI は同じサーバー API を通して CAN データへアクセスする。

主な利用形態は次の通り。

- GUI を起動し、CAN バスをリアルタイムに観測する。
- GUI が動作している間でも、CLI から指定時間だけ CAN フレームをキャプチャし、CSV として保存する。
- 複数の CAN バスを同時に接続し、GUI 上では CAN0、CAN1、CAN2 のようなバス識別子を付けたうえで、受信データを同一ビューに混ぜて表示する。
- GUI から CAN データを手動送信する。送信は単発送信と定期送信を選べる。
- 外部ファイルから送信データプリセットを読み込み、プリセットを選択して送信する。

ログ機能は将来的に追加する可能性がある。ただし初期設計では、ログよりも「外部から指定時間キャプチャできる機能」を優先する。ログ機能は、後述するフレーム配信とキャプチャ機構の上に追加する。

同時利用する CAN バス数は、実用上は 2 バスを主対象とし、最大 4 バス程度までを想定する。UI、設定、内部データ構造は 4 バスまで自然に扱える形にするが、それ以上の大規模監視は初期スコープに含めない。

## 全体構成

推奨構成は次の通りである。

```text
+-----------------------------+      +------------------+
| Desktop App                 |      | CLI              |
| - GUI                       |      | capture/export   |
| - extension module host     |      +---------+--------+
|                             |                |
| +-------------------------+ |                | server API
| | CANRush Server Core     |<----------------+
| | - device/session mgmt   | |
| | - frame stream hub      | |
| | - capture service       | |
| | - transmit scheduler    | |
| | - latest-frame state    | |
| +-----------+-------------+ |
+-------------|---------------+
              |
              | adapter interface
              v
+---------------------------------------------+
| CAN Adapter Layer                           |
| - WeAct SLCAN-FD adapter                    |
| - slcan serial adapter                      |
| - SocketCAN / gs_usb adapter                |
| - future vendor adapter implementations     |
+--------------------+------------------------+
                     |
                     v
+---------------------------------------------+
| USB-CAN adapters / OS CAN interfaces        |
+---------------------------------------------+
```

サーバーコアが CAN デバイスまたは OS CAN interface を排他的に管理する。GUI と CLI はシリアルポート、SocketCAN interface、USB デバイスを直接開かない。これにより、GUI で観測中に CLI キャプチャを開始しても、デバイスの取り合いが発生しない。

デスクトップアプリ起動時にサーバーコアも起動する。CLI は、起動中のデスクトップアプリ内サーバーに接続してキャプチャする。将来的にヘッドレス運用が必要になった場合は、同じサーバーコアを単独プロセスとして起動できる構成に拡張する。

## サーバーの責務

サーバーは CANRush の中核として、次の責務を持つ。

- 複数 USB-CAN アダプタの接続、切断、再接続、設定を管理する。
- 各バスに `CAN0`、`CAN1`、`CAN2` のような論理名を割り当てる。
- WeAct SLCAN-FD、slcan、SocketCAN、gs_usb、将来のベンダー API から得たフレームを内部の共通 CAN フレーム表現へ変換する。
- アダプタごとの対応能力を管理する。例: Classical CAN のみ、CAN FD 対応、listen-only 対応、送信対応、ハードウェアタイムスタンプ対応。
- 受信フレームを GUI、CLI キャプチャ、将来のログ機能へ配信する。
- CAN ID ごとの最新フレーム、最終受信時刻、フレームレートを保持する。
- CLI からの指定時間キャプチャ要求を処理する。
- 手動送信、定期送信、プリセット送信を管理する。
- エラー、デバイス状態、送信状態を API 経由で公開する。

サーバーは、短時間のキャプチャと長時間の GUI 表示を同時に扱う必要がある。そのため、受信処理は「1 つの入力ストリームを複数購読者へ配る」構造にする。

## 内部データモデル

受信 CAN フレームは、少なくとも次の情報を持つ共通構造に正規化する。

| 項目 | 内容 |
| --- | --- |
| `bus` | `CAN0`、`CAN1` などの論理バス名 |
| `timestamp_host` | PC 側で受信した時刻 |
| `timestamp_device` | デバイスまたはドライバ由来のタイムスタンプ。利用できない場合は空 |
| `direction` | `rx` または `tx` |
| `id` | CAN ID |
| `id_format` | `standard` または `extended` |
| `frame_format` | `classic` または `fd` |
| `frame_type` | `data`、`remote`、`error` など |
| `dlc` | CAN DLC。CAN FD では実データ長と一致しない値を取り得る |
| `data_length` | 実データ長。Classical CAN は 0 から 8、CAN FD は 0 から 64 |
| `data` | ペイロード |
| `bitrate_switch` | CAN FD BRS フラグ。該当しない場合は false |
| `error_state_indicator` | CAN FD ESI フラグ。該当しない場合は false |
| `adapter` | `weact_slcan_fd`、`slcan`、`socketcan`、`gs_usb` などのアダプタ種別 |
| `raw` | 必要に応じて元の WeAct SLCAN-FD 行、標準 slcan 行、SocketCAN フレーム、ドライバ固有情報 |

GUI の集約キーは、基本的に `bus + id_format + id + frame_type` とする。複数バスを混ぜて表示するため、`bus` をキーに含めないと別バスの同一 CAN ID が衝突する。

CAN FD と Classical CAN が同じ CAN ID を使う可能性を考慮し、実装上のキーには `frame_format` も含める。RTR は Classical CAN の概念であり、CAN FD フレームでは使用しない。

## フレーム配信とキャプチャ

受信フレームは、サーバー内部のフレームストリームへ流す。GUI、CLI、将来のログ機能はこのストリームを購読する。

CLI キャプチャは、サーバーへ接続して次の条件を指定する。

- キャプチャ時間
- 対象バス。未指定なら全バス
- CAN ID フィルタ。初期実装では省略可
- 出力形式。初期実装では CSV のみ
- 受信フレームのみか、送信フレームも含めるか

CSV は解析しやすいように、`timestamp_host,bus,direction,id,id_format,frame_format,frame_type,dlc,data_length,flags,data_hex` のような固定列にする。JSON Lines や単一 JSON 配列は初期実装では扱わない。必要になった場合は、同じキャプチャサービスに別 formatter を追加する。

キャプチャの時間制御は、できるだけサーバー側で行う。CLI 側の時計や処理遅延に依存すると、GUI と同時利用したときに境界が曖昧になるためである。

## GUI の機能

初期 GUI は、リアルタイム観測を中心にする。

CAN ID ごとの一覧では、次の列を表示する。

- バス名
- CAN ID
- ID 種別
- フレーム形式。Classical CAN または CAN FD
- フレーム種別
- 最新データ
- データ長
- 最終取得時刻
- フレームレート
- 受信回数

表示は複数バスを混ぜる。ただしバス名列を必ず表示し、同じ CAN ID でも別バスのデータとして区別できるようにする。

プロット機能は、GUI 本体へ多機能に組み込まない。GUI 本体はリアルタイム一覧、送信、キャプチャ操作を中心に保ち、プロットはソフトウェア側の拡張モジュールとして追加しやすい構成にする。

初期段階では、拡張モジュールがフレームストリームまたはデコード済み信号ストリームを購読できるようにする。プロットに必要な履歴リングバッファ、対象信号選択、表示設定は拡張モジュール側に閉じ込め、GUI 本体の複雑化を避ける。

## CAN データ送信

送信機能はサーバーで管理する。GUI は送信要求をサーバー API へ送る。

初期送信機能は次の通り。

- バス選択
- 標準 ID / 拡張 ID の選択
- Classical CAN / CAN FD の選択
- データフレーム / RTR フレームの選択
- DLC とデータの手動入力
- CAN FD の場合は 0 から 64 バイトのデータ長、BRS フラグを指定できるようにする
- 単発送信
- 定期送信
- 定期送信の開始、停止、周期変更

定期送信は GUI 側タイマーではなくサーバー側スケジューラで実行する。GUI が一時的に重くなっても周期送信が乱れにくく、CLI や将来の自動処理とも統一できる。

送信したフレームは、内部フレームストリームへ `direction=tx` として流す。これにより、GUI 表示、CLI キャプチャ、将来のログに送信イベントも含められる。

CAN FD、RTR、拡張 ID、listen-only などの可否はアダプタの能力に依存する。GUI は固定の操作項目を出すのではなく、サーバーから取得した bus capability に応じて入力項目を有効化する。

## 送信プリセット

外部ファイルによる自動送信は、スクリプト実行ではなく送信データプリセットとして扱う。

プリセット形式は CSV とする。CLI キャプチャも CSV のため、ファイル形式を統一でき、表計算ソフトで編集しやすい。

CSV には次の列を持たせる。

| 列 | 内容 |
| --- | --- |
| `name` | プリセット名 |
| `bus` | 対象バス。例: `CAN0` |
| `id` | CAN ID |
| `id_format` | `standard` または `extended` |
| `frame_format` | `classic` または `fd` |
| `frame_type` | `data` または `remote` |
| `dlc` | DLC |
| `data_hex` | 送信データ。空白なし 16 進文字列 |
| `flags` | CAN FD の `brs` など。複数指定は `;` 区切り |
| `mode` | `single` または `periodic` |
| `period_ms` | 定期送信周期。単発送信では空 |
| `description` | 任意の説明文 |

CSV は階層表現に向かないため、1 行を 1 送信プリセットとして扱う。複数フレームをまとめた送信シーケンスや条件分岐は、初期スコープに含めない。

プリセット読み込み時は、CAN ID、DLC、データ長、周期の妥当性を検証し、危険な高頻度送信を防ぐ上限を設ける。

## 将来のペイロードデコード

CAN ペイロードは圧縮されがちなので、将来的にはバイト列を値へ変換するデコード機能を追加する。CAN FD では最大 64 バイトまで扱う。

想定する基本型は次の通り。

- `uint8`, `uint16`, `uint32`
- `int8`, `int16`, `int32`
- `uint8[4]` から `float32` への変換

将来拡張を考えると、デコード定義は受信フレーム本体とは分離する。定義は `bus + id + signal name + byte offset + type + endian + scale + offset + unit` のような構造にし、GUI と拡張モジュールは raw frame だけでなく decode result も参照できるようにする。

初期実装ではデコード機能は実装しない。ただし raw frame の保存形式と API は、後からデコード処理を追加しても破綻しない形にする。

DBC の読み込みや DBC ベースの信号定義は、今回の実装範囲には含めない。将来対応する場合も、まずは独自の軽量デコード定義を安定させてから検討する。

## ログ機能の位置付け

ログ機能は初期優先度を下げる。重要なのは CLI から指定時間キャプチャできる機能である。

将来ログを追加する場合も、独立した受信処理を作らず、フレームストリームの購読者として実装する。これにより、GUI、CLI キャプチャ、ログの出力内容とフィルタ条件を揃えやすい。

## API 方針

API は、制御系とストリーム系を分ける。

- 制御系: デバイス一覧、接続、切断、状態取得、送信開始、送信停止、キャプチャ開始。
- ストリーム系: 受信フレーム、送信イベント、状態イベント、キャプチャデータ。

デスクトップ GUI は、サーバーコアに対してプロセス内 API またはローカル IPC で接続する。CLI は起動中のデスクトップアプリ内サーバーに接続するため、ローカル HTTP、ローカル TCP、Unix domain socket / named pipe などの候補から選ぶ。

ただし、実装言語や GUI フレームワークを選ぶ前に API 形式を固定しすぎない。重要なのは、GUI と CLI が同じサーバー API を使い、CAN デバイスへの直接アクセスをサーバーへ集約することである。

## 具体実装案

現時点の推奨実装は、Rust を中核にしたデスクトップアプリ構成とする。CAN の受信、送信、キャプチャ、アダプタ抽象化、CLI は Rust で実装し、GUI は Tauri + TypeScript で構築する。GUI は表示と操作要求の発行に集中し、CAN デバイス制御や定期送信の時刻管理を持たない。

Rust を中核にする理由は次の通り。

- GUI アプリと CLI で同じ core crate を共有できる。
- シリアル通信、SocketCAN、将来の USB/libusb やベンダー SDK 連携を adapter 単位で分離しやすい。
- CAN フレームのパース、DLC 検証、定期送信、キャプチャのような状態管理を型で表現しやすい。
- Windows を初期対象にしつつ、Linux/macOS 対応を後から完全な作り直しなしで検討できる。

想定する workspace 構成は次の通り。

```text
crates/
  canrush-core/          # 共通データモデル、frame hub、capture、tx scheduler
  canrush-adapter-slcan/ # 標準 slcan adapter
  canrush-adapter-weact/ # WeActStudio USB2CANFDV1 adapter
  canrush-cli/           # capture/export CLI
apps/
  desktop/               # Tauri desktop app
    src-tauri/           # Rust 側。core を起動し、GUI API を公開する
    src/                 # TypeScript GUI
```

初期実装では、adapter crate を細かく分けすぎず、`canrush-core` 内に `adapters::weact_slcan_fd` と `adapters::slcan` を置いてもよい。ただし公開 trait とデータモデルは、後で crate 分割しても壊れにくい形にする。

Rust 側の主要モジュールは次のように分ける。

| モジュール | 責務 |
| --- | --- |
| `model` | `CanFrame`、`BusId`、`CanId`、`FrameFormat`、`BusCapability` などの共通型 |
| `adapter` | `CanAdapter` trait、デバイス列挙、接続、受信ストリーム、送信 API |
| `protocol::slcan` | 標準 slcan の行パースと送信行生成 |
| `protocol::weact` | `d/D/b/B`、`Yx`、`H0` など WeAct SLCAN-FD 拡張 |
| `server` | 接続済みバスの管理、frame hub、状態イベント配信 |
| `capture` | 指定時間キャプチャ、CSV formatter |
| `tx` | 単発送信、定期送信、周期変更、停止 |
| `storage` | 設定、送信プリセット CSV の読み書き |

`CanAdapter` trait は、少なくとも次の操作を持つ。

```text
list_devices()
connect(device, config)
disconnect()
capability()
frames()
send(frame)
status()
```

受信フレームは adapter から server の frame hub に集約する。frame hub は、GUI の最新値一覧、CLI キャプチャ、将来ログの購読元になる。GUI 表示用にはすべての生フレームをそのまま描画せず、サーバー側で `bus + frame_format + id_format + id + frame_type` ごとの latest-frame state を作り、一定周期で UI に差分通知する。

GUI は次の画面構成から始める。

- デバイス/バス接続パネル: シリアルポート、adapter profile、bitrate、data bitrate、listen-only を選択する。
- 受信一覧: CAN ID ごとの最新値、周期、受信回数を表示する。
- フレーム詳細: 選択行の raw payload、DLC、flags、raw adapter line を確認する。
- 送信パネル: 単発送信と定期送信を扱う。
- キャプチャ操作: 出力先、時間、対象バスを指定して CSV に保存する。

初期 CLI は `canrush capture` のみに絞る。GUI 内サーバーが起動している場合はそこへ接続し、未起動時に単独でデバイスを開く機能は後続対応にする。CLI の例は次の形にする。

```text
canrush capture --duration 10s --bus CAN0 --output capture.csv
canrush capture --duration 30s --all-buses --include-tx --output capture.csv
```

テストは、実機がなくても進められる層から用意する。

- slcan / WeAct SLCAN-FD の行パースと送信行生成の単体テスト。
- CAN FD DLC と実データ長の変換テスト。
- CSV capture formatter のゴールデンファイルテスト。
- frame hub の複数購読者配信テスト。
- tx scheduler の周期、停止、周期変更テスト。
- 実機接続テストは `ignored` または手動テストとして分ける。

最初のマイルストーンは、実機なしで core の大半を検証できる形にする。

1. Rust workspace と `canrush-core` を作る。
2. 共通 CAN フレーム型、DLC 変換、slcan / WeAct SLCAN-FD parser を実装する。
3. fake adapter を作り、frame hub と latest-frame state を動かす。
4. CLI の CSV capture を fake adapter で動かす。
5. WeAct 実 adapter を追加し、受信表示を動かす。
6. Tauri GUI を追加し、latest-frame state を一覧表示する。
7. 送信、定期送信、プリセット CSV を順に追加する。

## 実装順序

実装は、CAN デバイス実機に依存しない基盤から進める。プロトコルパース、内部モデル、frame hub、CSV 出力を先に固めることで、実機接続時の問題を「シリアル通信またはデバイス固有挙動」に切り分けやすくする。

### 0. 開発基盤

最初に Rust workspace、formatter、lint、テスト実行手順を作る。ここではアプリ機能を作り込まない。

完了条件は次の通り。

- `cargo test` が空または最小テストで成功する。
- `cargo fmt` を適用できる。
- README から、開発者がテストを実行できる。
- CI をすぐ用意しない場合でも、ローカルで確認するコマンドを明記する。

開発基盤の初期決定事項は次の通り。

- Rust toolchain は stable を使う。
- repository root に Cargo workspace を置く。
- 最初の workspace member は `crates/canrush-core` とする。
- formatter は `cargo fmt --all`、テストは `cargo test --workspace` を標準確認コマンドにする。
- lint は `cargo clippy --workspace --all-targets` を使う。
- 作業開始時点では `rustc` と `cargo` が未検出だったため、Rustup を導入した。新しい PowerShell で PATH が反映されない場合は `%USERPROFILE%\.cargo\bin` を確認する。

### 1. 共通データモデルとプロトコルパーサ

次に `CanFrame`、`BusCapability`、CAN FD DLC 変換、標準 slcan parser、WeAct SLCAN-FD parser を実装する。ここはアプリ全体の土台なので、実機接続より前に単体テストを厚くする。

完了条件は次の通り。

- `t/T/r/R` の Classical CAN 行を `CanFrame` に変換できる。
- `d/D/b/B` の CAN FD 行を `CanFrame` に変換できる。
- DLC `0..F` と実データ長の変換がテストされている。
- 不正な CAN ID、DLC、データ長、16 進文字列を拒否できる。
- 送信用の `CanFrame` から slcan / WeAct 行を生成できる。

### 2. Fake adapter と frame hub

実機なしでサーバーコアを動かすため、任意のフレーム列を流せる fake adapter を作る。frame hub、latest-frame state、複数購読者配信はこの段階で検証する。

完了条件は次の通り。

- fake adapter から受信フレームを流せる。
- GUI 用 latest-frame state が `bus + frame_format + id_format + id + frame_type` で集約される。
- 複数購読者が同じ入力ストリームを受け取れる。
- 購読者が遅い場合でも、受信処理全体を止めない方針を実装または明文化する。

### 3. CLI capture と CSV 出力

GUI より先に CLI capture を作る。CLI は表示に依存しないため、frame hub と capture service の設計不備を早く見つけやすい。

完了条件は次の通り。

- `canrush capture --duration ... --output ...` が fake adapter で動く。
- CSV ヘッダと列順が固定されている。
- `--bus`、`--all-buses`、`--include-tx` の基本オプションを処理できる。
- キャプチャ時間の制御をサーバー側で行う。
- CSV formatter のゴールデンファイルテストがある。

### 4. WeAct 実 adapter の受信

ここで初めて WeActStudio USB2CANFDV1 へ接続する。最初は受信専用に絞り、送信や定期送信はまだ入れない。

完了条件は次の通り。

- シリアルポートを列挙し、手動選択で接続できる。
- `C`、`H0`、`M0/M1`、`A0`、`Sx`、必要なら `Yx`、`O` の初期化順を実行できる。
- `t/T/r/R/d/D/b/B` の受信行を共通 `CanFrame` に変換できる。
- BEL、タイムアウト、パース不能行を状態イベントとして記録できる。
- fake adapter で通っていた CLI capture が、実 adapter でも動く。

CLI 完結部分の初期実装として、1 から 4 の範囲は次の形で実装した。

- `canrush-core` に共通 CAN フレーム型、CAN FD DLC 変換、slcan parser、WeAct SLCAN-FD parser を追加した。
- `FakeAdapter` からサンプルフレームを流し、実機なしで capture と CSV 出力を確認できるようにした。
- `FrameHub` と `LatestFrameState` を追加し、GUI 予定の latest-frame 集約キーをコード化した。
- `canrush-cli` に `capture` と `list-ports` を追加した。
- `capture --adapter fake` は実機なしで動作する。
- `capture --adapter weact --port COMx` は WeActStudio USB2CANFDV1 の仮想シリアルポートへ接続し、`C`、`H0`、`M0/M1`、`A0`、`Sx`、`Yx`、`O` の順で初期化する。
- WeAct 実 adapter は受信専用で開始し、送信は後続フェーズで追加する。

実機接続確認では、WeActStudio USB2CANFDV1 の 2 台が `COM3` と `COM85` として認識された。どちらも `V` に firmware 文字列を返し、`C`、`M1`、`A0`、`S4`、`Y2`、`O`、`C` は正常応答した。一方で `H0` は BEL を返し、後続の `M0/M1` が失敗することがあったため、初期実装では `H0` を送らない。接続チェックでは、CAN bitrate を 1 Mbps の `S8` に設定すると受信できた。`COM3` は 3 秒で 13073 フレーム、`COM85` は 3 秒で 16517 フレームを通常モードで受信した。`--listen-only --bitrate S8` でも、`COM3` は 2 秒で 8622 フレーム、`COM85` は 2 秒で 11007 フレームを受信した。

### 5. 読み取り専用 GUI

GUI は最初から多機能にしない。まず、デバイス接続と受信一覧だけを Tauri 上に載せる。

完了条件は次の通り。

- GUI からデバイスを選択して接続、切断できる。
- latest-frame state を一覧表示できる。
- バス名、CAN ID、frame format、data、受信回数、フレームレートを表示できる。
- 高頻度受信時も、生フレームを全件 DOM に流さず、一定周期の差分更新にできる。

### 6. 単発送信

受信表示が安定してから単発送信を追加する。listen-only 中は送信 UI を無効化し、capability に従って CAN FD、BRS、RTR の入力可否を切り替える。

完了条件は次の通り。

- GUI から Classical CAN と CAN FD の単発送信を要求できる。
- 送信要求、成功、失敗を状態イベントとして追跡できる。
- 送信済みフレームを `direction=tx` として frame hub に流せる。
- 不正な DLC、データ長、ID、capability 不一致を送信前に拒否できる。

### 7. 定期送信

定期送信は GUI タイマーではなく server 側 scheduler で実装する。安全上の最小周期と同時ジョブ数の上限をここで決める。

完了条件は次の通り。

- 定期送信の開始、停止、周期変更ができる。
- GUI を閉じる、または接続を切ると、定期送信が確実に停止する。
- 最小周期と同時ジョブ数の上限を持つ。
- scheduler の単体テストで周期、停止、変更を検証できる。

### 8. 送信プリセット CSV

送信処理が安定してから、プリセット CSV を追加する。先にファイル形式を入れると、送信 API の変更に引きずられて CSV 互換性が揺れやすいためである。

完了条件は次の通り。

- CSV を読み込み、各行を送信プリセットとして検証できる。
- GUI からプリセットを選択して単発または定期送信できる。
- 不正行を行番号付きで報告できる。
- 高頻度送信や capability 不一致を読み込み時に検出できる。

### 9. 標準 slcan と後続 adapter

WeAct adapter の受信、送信、CLI、GUI が安定してから標準 slcan adapter を追加する。SocketCAN、gs_usb、ベンダー SDK は同じ `CanAdapter` trait で扱えることを確認しながら後続対応にする。

完了条件は次の通り。

- 標準 slcan adapter が Classical CAN 受信を扱える。
- `supports_can_fd=false` の bus capability に対して GUI が自然に制限表示できる。
- adapter 固有コードを UI と CLI に漏らさず追加できる。

各段階では、コード変更後に少なくとも `cargo fmt` と `cargo test` を通す。Tauri GUI を追加した後は、Rust 側の `cargo test` に加えて GUI の型チェック、ビルド、主要画面の手動確認を行う。

## 初期開発方針

- まずは CAN フレームの受信表示を安定させる。
- slcan の標準プロトコル仕様は `doc/slcan.md` に集約する。USB-CAN アダプタ全体の方針は `doc/usb-can-adapters.md` に集約する。WeActStudio USB2CANFDV1 固有の仕様は `doc/weact-usb2canfdv1.md` に集約する。
- UI や実装上の判断で特定アダプタ固有の挙動に依存する場合は、該当ドキュメントへの参照を残す。
- slcan を特殊扱いせず、CAN Adapter Layer の一実装として扱う。
- 初期 adapter は WeActStudio USB2CANFDV1 向けの `weact_slcan_fd` を優先する。
- 共通フレームモデルは最初から CAN FD を表現できる形にする。
- 外部 CLI キャプチャを GUI 内部ログより優先する。
- CLI キャプチャの初期出力形式は CSV のみにする。
- 送信プリセット形式も CSV にする。
- 受信処理、GUI 表示、CLI キャプチャ、将来ログは、同じフレームストリームを共有する設計にする。
- 複数バス対応を初期設計に含め、フレームのキーと表示には必ずバス名を含める。実用 2 バス、最大 4 バス程度を想定する。
- 送信の定期実行は GUI ではなくサーバー側で管理する。
- プロット機能は GUI 本体に作り込まず、拡張モジュールとして追加しやすい構成にする。
- DBC 読み込みは今回実装しない。

## 検討が必要な未確定事項

実装前に確認したい点は次の通り。

- 主な対象 OS は Windows のみか、Linux/macOS も対象にするか。
- デスクトップアプリの実装技術を何にするか。
- 初期対応は WeActStudio USB2CANFDV1 で進め、標準 slcan、gs_usb、SocketCAN、ベンダー SDK は後続対応にするか。
- Windows で gs_usb 系デバイスを扱う場合、WinUSB/libusb で直接扱うか、別ドライバやライブラリを前提にするか。
- Linux では SocketCAN 経由を基本にするか、gs_usb を直接 USB プロトコルとして扱う経路も用意するか。
- 同時接続する CAN バス数は実用 2、最大 4 程度を前提にしてよいか。
- 想定する最大 CAN フレームレート。
- CAN FD の最大データレート、BRS の利用有無。
- キャプチャには受信フレームだけを含めるか、送信フレームも含めるか。
- 定期送信の最小周期と、安全上の上限をどの程度にするか。
