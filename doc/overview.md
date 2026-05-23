# CANRush 開発概要

CANRush は、USB-CAN アダプタを PC から利用するためのビューワツールとして開発する。slcan だけに限定せず、gs_usb / SocketCAN 系、将来のベンダー SDK 系アダプタも扱える構成にする。

初期ターゲットの USB-CAN アダプタは WeActStudio USB2CANFDV1 とする。このデバイスは SLCAN 互換の仮想シリアルインターフェースを持つが、CAN FD 用の独自拡張も持つため、標準 `slcan` ではなく `weact_slcan_fd` adapter profile として扱う。

## 関連ドキュメント

- [slcan 仕様メモ](./slcan.md)
- [USB-CAN アダプタ対応方針](./usb-can-adapters.md)
- [WeActStudio USB2CANFDV1 対応メモ](./weact-usb2canfdv1.md)

## 想定する利用形態

CANRush は、CLI とデスクトップ GUI の両方から利用できる CAN ツール群として提供する。中核は `canrush-core` に置き、USB-CAN アダプタ制御、受信ストリーム、キャプチャ、将来の送信処理を GUI から独立させる。GUI は中核機能の利用者の 1 つとして扱い、CAN デバイス制御や長時間処理を GUI 側に閉じ込めない。

主な利用形態は次の通り。

- CLI から指定時間だけ CAN フレームをキャプチャし、CSV として保存する。
- CLI からポート列挙、接続確認、短時間モニタ、統計確認を行う。
- GUI を起動し、CAN バスをリアルタイムに観測する。
- GUI が動作している間でも、CLI からキャプチャや状態確認を行えるようにする。
- 複数の CAN バスを同時に接続し、GUI 上では CAN0、CAN1、CAN2 のようなバス識別子を付けたうえで、受信データを同一ビューに混ぜて表示する。
- GUI から CAN データを手動送信する。送信は単発送信と定期送信を選べる。
- 外部ファイルから送信データプリセットを読み込み、プリセットを選択して送信する。

ログ機能は将来的に追加する可能性がある。ただし初期設計では、GUI 内ログよりも CLI のキャプチャ、接続確認、統計確認を優先する。ログ機能は、後述するフレーム配信とキャプチャ機構の上に追加する。

同時利用する CAN バス数は、実用上は 2 バスを主対象とし、最大 4 バス程度までを想定する。UI、設定、内部データ構造は 4 バスまで自然に扱える形にするが、それ以上の大規模監視は初期スコープに含めない。

## 全体構成

推奨構成は次の通りである。

```text
+-------------------+     +----------------------+     +----------------------+
| CLI               |     | Desktop Monitor GUI  |     | Plot App / Extension |
| - capture/export  |     | - receive monitor    |     | - live plot          |
| - list/check      |     | - connection control |     | - offline plot       |
| - stats/monitor   |     | - basic detail view  |     | - signal view        |
+---------+---------+     +----------+-----------+     +----------+-----------+
          |                          |                            |
          | process API / local IPC  | process API / local IPC    | stream/file API
          v                          v                            v
+--------------------------------------------------------------------------+
| CANRush Core / optional local server                                     |
| - device/session mgmt     - frame stream hub      - capture service      |
| - latest-frame state      - diagnostics           - future tx scheduler  |
+-----------------------------------+--------------------------------------+
                                    |
                                    | adapter interface
                                    v
+--------------------------------------------------------------------------+
| CAN Adapter Layer                                                        |
| - WeAct SLCAN-FD adapter     - slcan serial adapter                      |
| - SocketCAN / gs_usb adapter - future vendor adapter implementations     |
+-----------------------------------+--------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| USB-CAN adapters / OS CAN interfaces                                     |
+--------------------------------------------------------------------------+
```

CAN デバイスまたは OS CAN interface を開く責務は `canrush-core` に集約する。CLI、Desktop Monitor GUI、Plot App は、同じ core API またはローカル IPC を通して CAN データへアクセスする。これにより、UI や CLI コマンドごとにアダプタ実装を重複させず、デバイスの取り合いや挙動差を避ける。

初期段階では、CLI は `canrush-core` をプロセス内で直接利用して単独実行できることを優先する。GUI と CLI が同じ実デバイスを同時利用する段階では、同じ core をローカルサーバーまたはデスクトップアプリ内サーバーとして動かし、各クライアントがそのサーバーに接続する構成へ拡張する。ヘッドレス運用が必要になった場合も、同じ core を単独プロセスとして起動できるようにする。

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

プロット機能は、受信モニタ GUI 本体へ多機能に組み込まない。GUI 本体はリアルタイム一覧、接続状態、基本 detail 表示を中心に保ち、ログ、送信、高度なプロットは別機能として扱う。

プロット機能は、独立性の高いアプリケーションとしても、GUI 的に統合された拡張機能としても成立するように、まずデータ境界を明確にする。Plot 側は CAN デバイスを直接開かず、core が公開する live frame stream、capture file、将来の decoded signal stream を入力にする。プロットに必要な履歴リングバッファ、対象信号選択、表示設定、描画負荷は Plot 側へ閉じ込め、受信モニタ GUI の安定性に影響させない。

プロットの提供形態は次の 2 案を比較しながら進める。

- 独立アプリ案: `canrush-plot` を受信モニタとは別プロセス、別ウィンドウ、別 package として用意する。live stream と CSV capture の両方を入力にできる。描画負荷や UI 複雑性を分離しやすく、オフライン解析ツールとしても使いやすい。
- 統合拡張案: 受信モニタ GUI から起動できる拡張画面または別ウィンドウとして Plot を提供する。GUI 的には一体に見えるが、内部的には stream API を購読する別モジュールとして扱う。bus 選択や接続状態を共有しやすい一方、release、状態同期、UI 責務の境界が曖昧になりやすい。

初期方針としては、独立アプリ案に寄せたデータ契約を先に作る。後から統合拡張案へ寄せる場合も、受信モニタ GUI が Plot の内部状態や描画履歴を直接持たないようにする。

## 受信専用 GUI 構成

当面の GUI は受信専用に限定する。送信、定期送信、送信プリセット編集、DBC 読み込み、プロットは初期 GUI から外す。最初の目的は、2 台の WeActStudio USB2CANFDV1 を 1 Mbps で接続し、`CAN0` と `CAN1` の受信状態を同一画面で安定して観測できることである。

画面は、次の構成にする。

```text
+--------------------------------------------------------------+
| Top bar                                                      |
| device refresh | connect all | disconnect all | capture CSV  |
+----------------------+---------------------------------------+
| Bus panel            | Latest frame table                    |
| - CAN0 port/settings | bus | id | fmt | len | data | rate... |
| - CAN1 port/settings |                                       |
| - status counters    |                                       |
+----------------------+---------------------------------------+
| Detail panel                                                 |
| selected frame raw data, decoded metadata, raw adapter line   |
+--------------------------------------------------------------+
| Event/status strip                                            |
+--------------------------------------------------------------+
```

各構成要素の責務は次の通り。

| 構成要素 | 内容 |
| --- | --- |
| Top bar | ポート再読み込み、全接続、全切断、CSV キャプチャ開始、グローバル状態表示 |
| Bus panel | 各バスの port、adapter、bitrate、data bitrate、listen-only、接続状態、受信数、エラー数を表示する |
| Latest frame table | `LatestFrameState` を表示する主画面。高頻度受信でも表の行数は CAN ID 単位に抑える |
| Detail panel | 選択行の payload、DLC、flags、timestamp、raw line を確認する |
| Event/status strip | 接続、切断、BEL、パース不能行、キャプチャ完了などの短い状態イベントを表示する |

Bus panel は、実用上の初期対象である 2 バスを最初から扱える形にする。既定候補は `CAN0=COM3`、`CAN1=COM85`、bitrate `S8`、data bitrate `Y2`、listen-only 有効とする。ただしポート名は環境依存なので、UI ではシリアルポート再読み込みで選び直せるようにする。将来 4 バスへ増やす場合も、同じ bus card を縦に増やせる構造にする。

Latest frame table の列は、初期実装では次を表示する。

- `bus`
- `id`
- `id_format`
- `frame_format`
- `dlc`
- `data_length`
- `data_hex`
- `flags`
- `last_seen`
- `rate_hz`
- `count`

表は、受信した生フレームを全件追加する形式にしない。Rust 側で latest-frame state を作り、GUI には一定周期で snapshot または差分を渡す。初期値は 5 Hz 程度の UI 更新でよい。内部受信は落とさず継続し、UI 更新だけを間引く。

フィルタと表示補助は、初期実装では軽量に留める。

- bus filter。`ALL`、`CAN0`、`CAN1` を選べる。
- CAN ID 検索。16 進文字列の部分一致でよい。
- pause display。受信は継続し、画面更新だけ止める。
- clear view。latest-frame state と表示上の count をクリアする。デバイス接続は維持する。

CSV キャプチャは、既存 CLI capture と同じ列定義を使う。GUI からは「保存先、期間、対象 bus」を指定してサーバー側 capture service を呼ぶ。受信専用 GUI の範囲では、キャプチャに送信フレームを含める設定は表示しない。

接続操作の最小フローは次の通り。

1. 起動時に serial port を列挙する。
2. VID/PID `0483:5740`、serial が `AA` で始まるポートを WeAct V1 候補として表示する。
3. `CAN0` と `CAN1` に port、bitrate、listen-only を割り当てる。
4. Connect を押すと、Rust 側で `C`、`M1`、`A0`、`S8`、`Y2`、`O` の順に初期化する。
5. 受信が始まったら Latest frame table を更新する。
6. Disconnect では `C` を送り、該当 bus の受信を停止する。

エラー表示は、操作を止める modal よりも状態表示を優先する。接続失敗、BEL、パース不能行、serial timeout は bus card と Event/status strip に表示する。接続中の一時的な timeout は受信フレームがない状態として扱い、即エラーにはしない。

初期 GUI の完了条件は次の通り。

- `COM3` と `COM85` を `CAN0`、`CAN1` として同時接続できる。
- 両方を `S8`、listen-only で受信できる。
- 受信一覧が CAN ID 単位で更新され、UI が高頻度フレームで固まらない。
- 選択したフレームの詳細を確認できる。
- GUI から CSV キャプチャを実行できる。
- GUI を閉じたとき、接続中の adapter に `C` を送って閉じる。

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

CLI はまず `canrush-core` をプロセス内 API として直接利用し、GUI なしで capture、接続診断、monitor/stats を実行できるようにする。複数クライアントが同じ実デバイスを同時利用する段階では、同じ core をローカルサーバー化し、デスクトップ GUI、CLI、Plot App がローカル HTTP、ローカル TCP、Unix domain socket / named pipe などで接続する方式を検討する。

ただし、IPC 形式は早期に固定しすぎない。重要なのは、CLI、GUI、Plot App が同じ core のモデルとストリーム契約を使い、CAN デバイスへの直接アクセスをアプリケーション層へ漏らさないことである。

## 具体実装案

現時点の推奨実装は、Rust の `canrush-core` を中核にした CLI / GUI 分離構成とする。CAN の受信、送信、キャプチャ、アダプタ抽象化、CLI は Rust で実装し、受信モニタ GUI は Tauri + TypeScript で構築する。GUI は表示と操作要求の発行に集中し、CAN デバイス制御、長時間 capture、定期送信の時刻管理を持たない。

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

受信モニタ GUI は次の画面構成から始める。

- デバイス/バス接続パネル: シリアルポート、adapter profile、bitrate、data bitrate、listen-only を選択する。
- 受信一覧: CAN ID ごとの最新値、周期、受信回数を表示する。
- フレーム詳細: 選択行の raw payload、DLC、flags、raw adapter line を確認する。
- 状態表示: 接続状態、受信エラー、パース失敗、概算 bus load を表示する。

GUI の送信パネル、GUI 内ログ、GUI キャプチャ操作は後続対応にする。まず CLI で capture、接続診断、短時間 monitor/stats を整備し、GUI はそれらで固めた core API と状態情報を表示する利用者として扱う。

初期 CLI は `canrush capture` を中心に始め、続いて `list-ports`、`check`、`monitor`、`stats` を追加する。CLI は GUI なしで `canrush-core` を直接利用できることを優先する。将来、GUI と CLI が同じ実デバイスを同時利用する必要が出た段階で、ローカルサーバー接続へ拡張する。CLI の例は次の形にする。

```text
canrush capture --duration 10s --bus CAN0 --output capture.csv
canrush capture --duration 30s --all-buses --include-tx --output capture.csv
canrush check --adapter weact --port COM3 --bitrate S8 --listen-only
canrush monitor --duration 5s --all-buses
canrush stats --duration 10s --all-buses
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

WeActStudio USB2CANFDV1 SLCAN Firmware のソース確認で得た実装メモは次の通り。

- `Source/App/slcan.c` では、ASCII mode の受信フレームとして Classical CAN は `t/T/r/R`、CAN FD は `d/D/b/B` を生成する。`b/B` は BRS あり、`d/D` は BRS なしである。
- `Source/App/slcan.c` の `M` と `A` は CAN が OFF_BUS のときだけ成功する。したがって初期化順は必ず `C` の後に `M0/M1` と `A0/A1` を送る。
- `Source/App/slcan.c` では `H0/H1` 自体は実装されているが、確認した実機 firmware では `H0` が BEL を返した。CANRush では verified firmware の挙動を優先し、初期化時に `H0` を送らない。
- `Source/Bsp/can.c` の初期値は nominal bitrate が 125 kbit/s、data bitrate が 2 Mbit/s、silent off、standard/extended filter は ID 0 / mask 0 である。
- `Source/Bsp/can.c` の `can_enable` は FDCAN を `FDCAN_FRAME_FD_BRS` で起動する。Classical CAN と CAN FD の両方を同じ adapter profile で扱える。
- `Source/Bsp/can.c` では `S8` が 1 Mbit/s に対応する。`Y1` から `Y5` は CAN FD data phase の 1 から 5 Mbit/s に対応する。
- `Source/Bsp/can.c` の silent mode は `FDCAN_MODE_BUS_MONITORING` で実装されており、CANRush の `--listen-only` は `M1` として扱う。
- `Source/App/slcan.h` の `SLCAN_MTU` は CAN FD 64 byte payload を ASCII 表現できる大きさで、`1 + 8 + 1 + 128 + 1` を前提にしている。

GUI の Connect で `CAN0` だけまれにエラーになる事象を確認した。CLI で `COM3` と `COM85` を交互に 20 回ずつ短時間接続した範囲では再現しなかったため、デバイス単体の恒常的な接続不良ではない可能性が高い。原因候補は、接続開始時に残っている受信フレーム行の終端 `\r` を、初期化コマンドの成功応答 `\r` と誤認することである。WeAct firmware はコマンド成功時に空の `\r`、受信フレーム時に `t... \r` や `d... \r` のような非空行を返す。CANRush ではコマンド応答待ちで非空行の `\r` を読み捨て、空行 `\r` だけを ACK として扱うようにした。

### 5. 読み取り専用 GUI

GUI は最初から多機能にしない。まず、デバイス接続と受信一覧だけを Tauri 上に載せる。

完了条件は次の通り。

- GUI からデバイスを選択して接続、切断できる。
- latest-frame state を一覧表示できる。
- バス名、CAN ID、frame format、data、受信回数、フレームレートを表示できる。
- 高頻度受信時も、生フレームを全件 DOM に流さず、一定周期の差分更新にできる。

読み取り専用 GUI の初期実装では、Tauri 側に `connect_bus`、`disconnect_bus`、`disconnect_all`、`latest_snapshot`、`clear_latest` のコマンドを用意した。`connect_bus` は WeAct 実 adapter を別スレッドで開き、`LatestFrameState` と bus 別カウンタを共有状態へ更新する。GUI は 200 ms 周期で `latest_snapshot` を取得し、受信処理そのものは止めずに表示だけを更新する。`LatestFrameState` は同じ集約キーの前回受信時刻も保持し、GUI の `Hz` 列は最新 2 回の受信間隔から概算する。既定値は実機確認済みの `CAN0=COM3`、`CAN1=COM85`、nominal bitrate `S8`、data bitrate `Y2`、listen-only 有効とする。

ブラウザ単体で Vite preview を開いた場合は Tauri API がないため、GUI はサンプルポートとサンプルフレームで表示確認できるようにしている。実デバイスの接続、切断、受信は Tauri アプリ上でのみ行う。

受信一覧は、高頻度更新時にデータ長、受信回数、時刻文字列の桁数で列幅が変わらないように、`table-layout: fixed` と `colgroup` で列幅を固定する。Data 列は固定幅の monospace 表示にし、長い CAN FD payload はセル内で省略表示する。数値列は右寄せにして桁変化による視覚的な揺れを抑える。

Bus panel には各バスの使用率を `Load` として表示する。初期実装では、受信フレームから概算ビット数を積算し、設定 nominal bitrate に対する使用率として表示する。概算は Classical CAN 2.0 と CAN FD の固定オーバーヘッド差、標準 ID と拡張 ID の差、payload の `data_length` を反映する。bit stuffing、再送、ACK 欠落、CAN FD の arbitration phase と data phase の速度差は含めず、運用中の相対的な負荷確認を目的とする。

使用率は 100 ms 単位の固定 bucket に概算占有時間を積み上げる。進行中の bucket は表示計算に混ぜず、bucket が完了した時点でその区間の占有時間だけを履歴へ記録する。`Load` はデータ取得開始から現在までの完了済み bucket 全体、つまり総計測区間に対する平均使用率として表示する。各 bucket で占有時間が 100 ms を超えた分は、新たなパケットを入れる余地がない超過時間として扱う。GUI には直近 1 秒間の完了済み bucket における超過時間を `Full 1s`、データ取得開始以降の 1 秒窓ワースト値を `Worst` として表示する。これらは測定器由来の電気的な実測値ではなく、受信フレーム列から推定した占有時間である。

GUI の表示更新は約 30 Hz、つまり 33 ms 周期で `latest_snapshot` を取得する。Data 列と Detail の payload は `00 00 00 00` のように 1 byte ごとのスペース区切りで表示する。

受信データリストの行数が増えてもウィンドウ全体のサイズやページ全体のスクロール状態が変わらないようにする。アプリ全体は viewport 高さに固定し、受信データリストは `frame-table-wrap` の内側だけでスクロールさせる。Bus panel も独立してスクロールできるが、Latest frame table の行追加によって Detail panel や status strip が押し出されないようにする。

Latest frame table は、`Bus`、`ID`、`Recent` の 3 種類で並び替えできる。`Bus` はバス名、CAN ID、フレーム形式の順、`ID` は CAN ID、バス名、フレーム形式の順、`Recent` は直近に受信した時刻の降順で表示する。

CAN バス全体と各 CAN ID の `Hz` は、表示更新タイミングに依存させない。500 ms の固定 window で受信パケット数をカウントし、window が終わったらその window のカウントだけを履歴に残して次の window を開始する。周波数表示時は、現在進行中の window を含めず、過去 1 秒分の完了済み window のカウント合計を 1 秒で割った値を表示する。これにより、GUI が 30 Hz で更新されても、表示タイミングによって周波数計算の対象パケットが変わらないようにする。

各 CAN ID の `Hz` 列には、数値の後ろにデータバーを表示する。バーは現在表示中の行における最大 Hz を 100% とした相対表示とし、絶対的な負荷ではなく、表示中 ID 同士の受信頻度の比較を目的とする。

Latest frame table は 1200 px 程度のウィンドウ幅でも Hz データバーを表示できるよう、`Hz` 列に十分な固定幅を割り当て、`Data`、`Last`、`Count` は必要に応じて省略表示する。上部のテーブル操作群は幅が足りない場合に折り返し、テーブル本体のバー表示領域を優先する。

デバッグ用に `Dummy data` トグルを用意する。ON の間は実 adapter からの snapshot 取得を止め、フロントエンド側で CAN0/CAN1 のダミーフレーム、Hz、Count、Load を定期更新する。実機なしでも、Hz データバー、Merge buses、Detail panel、スクロール、列幅の挙動を確認できるようにする。ダミーデータは表示確認専用であり、core の受信状態や実 adapter には流さない。

`Merge buses` を有効にすると、Latest frame table は CAN0/CAN1 を区別せず、`id_format + frame_format + frame_type + CAN ID` をキーにして表示上の行を統合する。内部の受信状態、bus 別カウンタ、bus 別負荷計算は分離したまま保持する。統合表示では Bus 列を `ALL` とし、Count と Hz は各バスの値を合算し、payload と最終受信時刻は最も新しいフレームを表示する。

Merge 表示中に統合行を選択した場合、Detail panel は統合行全体の最新 payload だけでなく、必要に応じて CAN0/CAN1 それぞれの payload、Hz、Count、raw line も並べて表示する。表示上は統合しても、詳細確認時にどのバスの値か追跡できるようにする。

Detail panel の選択状態は、実受信フレームの `rowKey` ではなく、Merge buses やフィルタ適用後に実際に表示されている行の `rowKey` を基準に維持する。Merge 表示中は統合行の `ALL-...` キーが選択対象になるため、受信 snapshot 更新時に CAN0/CAN1 の元フレームだけを見て選択をリセットしてはいけない。

Bus 設定は CAN FD 対応デバイスの設定をそのまま扱うため、data bitrate など FD 用項目を残す。一方、受信データリストは CAN 2.0 の監視を主眼にして、FD 専用の `Frame` と `Flags` 列は表示しない。CAN ID は標準 ID を 3 桁、拡張 ID を 8 桁の 0 埋め 16 進表記にすることで ID 表記だけで区別できるようにし、`ID fmt` 列も表示しない。DLC と Len は Data の byte 表示から読み取れるため、受信データリストでは表示しない。Detail panel では従来通り frame format、DLC、Len、raw line を表示する。内部データモデルと集約キーには `frame_format` と flags を残し、将来 CAN FD の詳細表示が必要になったときに復帰できるようにする。

### 5.5. 受信 GUI 後の機能実装方針

基本的な受信 GUI が整った後は、GUI のログや送信機能へ進む前に CLI 系を先に固める。CLI は自動テスト、実機確認、長時間 capture、将来の外部連携の土台になるため、GUI より先に API とデータ形式の安定化へ効きやすい。GUI は当面、受信モニタとして最小限の操作と状態表示に留める。

優先順位は次の通りにする。

1. CLI capture の強化: bus filter、ID filter、duration、件数上限、出力先、終了理由を安定させる。出力 CSV は GUI 表示状態や Merge 表示に依存しない raw frame を基準にする。
2. CLI 接続診断: `list-ports`、短時間 connect check、adapter firmware/version 確認、初期化コマンドの失敗理由、パース失敗数を CLI で確認できるようにする。
3. CLI monitor/stats: GUI を起動しなくても、受信中の bus 別 Hz、Load、ID 数、エラー数を短時間表示できるようにする。CI ではなく実機確認用の運用コマンドとして扱う。
4. Capture file 契約の固定: CSV header、時刻形式、ID 表記、flags、CAN FD 項目、将来の `direction=tx` の扱いを固定し、Plot App や外部ツールが読みやすい形式にする。
5. Plot 入力 API の検討: live frame stream と capture file の両方を Plot の入力として扱えるようにする。まずはファイル入力を安定させ、live stream はローカル IPC/API の設計と合わせて進める。
6. GUI 設定保存と軽量診断: CLI の診断情報を GUI でも見られるようにする。ただし GUI 内ログ、GUI 送信、GUI プロットはまだ追加しない。
7. 送信系: まず CLI 送信または core API の送信検証を行い、その後に GUI 送信へ進む。送信済みフレームは `direction=tx` として frame hub と capture に流せる形にする。

GUI 内ログ、GUI 送信、GUI 統合プロット、DBC 読み込みはこの後に回す。まず CLI と capture file を安定させ、外部アプリやプロット機能が依存できるデータ面の契約を固める。

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
- 受信 GUI が基本機能を満たした後は、GUI 内ログや GUI 送信より CLI 系機能を優先する。
- 外部 CLI キャプチャを GUI 内部ログより優先する。
- CLI キャプチャの初期出力形式は CSV のみにする。
- CLI の接続診断、短時間モニタ、統計確認を、実機検証用の標準経路として整備する。
- Capture file は Plot App や外部ツールの入力にも使えるよう、列定義と表記を安定させる。
- 送信プリセット形式も CSV にする。
- 受信処理、GUI 表示、CLI キャプチャ、将来ログは、同じフレームストリームを共有する設計にする。
- 複数バス対応を初期設計に含め、フレームのキーと表示には必ずバス名を含める。実用 2 バス、最大 4 バス程度を想定する。
- 送信の定期実行は GUI ではなくサーバー側で管理する。
- プロット機能は受信モニタ GUI 本体に作り込まず、独立アプリまたは統合拡張のどちらにも展開できるよう、live stream / capture file / decoded signal stream の入力契約を先に固める。
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
