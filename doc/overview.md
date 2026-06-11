# CANRush 開発概要

CANRush は、USB-CAN アダプタを PC から利用するための CAN ビューワ / キャプチャツール群である。CLI、headless server、Tauri + React GUI を同じ `canrush-core` の上に載せ、実デバイス制御、受信ストリーム、CSV キャプチャ、将来の送信処理を GUI から独立させる。

初期ターゲットは WeActStudio USB2CANFDV1 とする。このデバイスは SLCAN 互換の仮想シリアルインターフェースを持つが、CAN FD 用の独自拡張もあるため、標準 `slcan` とは分けて `weact_slcan_fd` 系 adapter として扱う。

## 2026-06 方針転換

CANRush は、Parser / Plotter / 受信監視を単一 GUI に統合する方針を中止する。当面の製品目標は「CAN フレームを安定して受信し、欠落や異常を把握でき、再利用可能な形式で保存・配信すること」に限定する。

優先する成果物は次の 3 つとする。

1. `canrush-server`: 実デバイスを所有し、接続状態、受信、診断、ストリーム配信を担う常駐プロセス。
2. `canrush` CLI: adapter bring-up、接続管理、統計確認、確実な CSV capture を行う運用・検証手段。
3. 受信確認用 GUI: 必要な場合のみ、接続状態と最新フレームを確認する薄い monitor client。

Parser / Plotter は受信基盤の完成条件に含めない。既存の offline CLI、設定形式、sample、core 実装は直ちに削除せず保守モードとするが、次の開発は停止する。

- GUI 上の Parser / Plotter 機能追加と UI 改善。
- live parse / live plot の性能改善。
- Tauri backend における parse / plot 専用 state、timer、buffer、command の拡張。
- 受信 API を Parser / Plotter 固有の都合に合わせる変更。

受信基盤が完成した後、解析機能が必要なら別アプリケーションまたは別パッケージとして再開する。その際は CANRush の安定した stream API または capture file を入力とし、デバイス制御を直接持たせない。

この節は、後続に残る過去の GUI / Parser / Plotter 実装メモより優先する。

## ドキュメント構成

入口としてはこの文書だけを読む。詳細は目的別に分ける。

- [server-cli.md](./server-cli.md): server / CLI / capture CSV / frame model / API 境界。
- [gui.md](./gui.md): Tauri GUI、Parser / Plotter、GUI 品質・headless smoke test 方針。
- [refactoring-plan.md](./refactoring-plan.md): GUI / Tauri backend リファクタリングの具体作業手順。
- [usb-can-adapters.md](./usb-can-adapters.md): USB-CAN adapter layer 全体方針。
- [slcan.md](./slcan.md): 標準 slcan 仕様メモ。
- [weact-usb2canfdv1.md](./weact-usb2canfdv1.md): WeActStudio USB2CANFDV1 固有メモ。

## 現在の構成

```text
+-------------------+      +----------------------+      +----------------------+
| canrush CLI      |      | optional monitor GUI |      | future analysis app  |
| capture/check    |      | status/latest frames |      | stream/file input    |
+---------+---------+      +----------+-----------+      +----------+-----------+
          |                           |                             |
          | HTTP / WebSocket          | HTTP / WebSocket            | stable API/file
          v                           v                             v
+----------------------------------------------------------------------------+
| canrush-server                                                             |
| device ownership / receive / frame stream / diagnostics / capture support  |
+------------------------------------+---------------------------------------+
                                     |
                                     | adapter abstraction
                                     v
+----------------------------------------------------------------------------+
| canrush-core                                                               |
| frame model / protocol parser / adapter helpers / capture / server API     |
+------------------------------------+---------------------------------------+
                                     |
                                     v
                         USB-CAN adapters / OS CAN interfaces
```

主要ディレクトリは次の通り。

```text
crates/
  canrush-core/     共通コア。モデル、adapter、capture、server helper。
                    既存 parser / plot module は当面保守モード。
  canrush-cli/      CLI。capture、check、server 管理、stats。
                    既存 parse / plot command は当面互換維持のみ。
  canrush-server/   headless server。HTTP control API と WebSocket stream。
apps/
  desktop/          Tauri + React の受信確認用 GUI。縮小対象。
doc/
  *.md              設計・仕様メモ。
examples/
  *.csv / *.json    Parser / Plotter 確認用サンプル。
```

## 基本方針

- 実 CAN デバイスを開く責務は、通常 `canrush-server` 側に寄せる。
- GUI と CLI は同じ server stream を購読する client として扱う。
- server は GUI がなくても起動、診断、capture、終了まで完結できるようにする。
- GUI に server 自動起動を残す場合も補助機能とし、server lifecycle の正規経路は CLI とする。
- CLI 単独で adapter を開く Standalone mode は、開発時 smoke test、緊急 capture、adapter bring-up 用として残す。
- 複数バスは `CAN0`、`CAN1` のような論理名で扱う。実用上は 2 バス、最大 4 バス程度を初期想定にする。
- 受信フレームは共通 `CanFrame` に正規化し、CSV capture、stream、GUI 表示で同じ表現を使う。
- 初期 capture file は CSV のみとし、列順と表記をテストで固定する。
- GUI 内ログよりも CLI capture、接続診断、統計確認、復旧可能性を優先する。
- capture は欠落を許容しない経路、monitor GUI は表示遅延を避けるため drop を許容する経路として区別する。
- Parser / Plotter は server の内部責務に入れず、将来も stream または capture file の consumer として分離する。
- 送信機能は受信表示と capture が安定した後に追加する。定期送信は GUI timer ではなく server 側 scheduler で管理する。

## 受信基盤の完成条件

「画面にフレームが表示された」だけでは受信部分の完成とはしない。最低限、次を満たすことを完成条件とする。

- WeActStudio USB2CANFDV1 で接続、受信、切断、再接続を繰り返しても process が不安定にならない。
- Classical CAN と CAN FD の frame model、DLC、payload length、BRS、ESI、standard / extended ID を正しく保持する。
- 2 bus 同時受信で bus が混同されず、bus ごとの frame 数、rate、error、最終受信時刻を確認できる。
- capture 経路では queue overflow、I/O error、stream 切断を成功扱いにせず、終了理由と欠落有無を利用者へ返す。
- monitor 購読で drop が発生した場合は dropped count を診断情報として観測できる。
- adapter の切断、serial read error、設定失敗、server 内部エラーを区別した診断コードで取得できる。
- fake adapter を使った自動テストで server 起動から stream / capture までを再現できる。
- 実機で一定時間の連続受信試験を行い、条件、総 frame 数、error 数、drop 数を記録できる。
- server API と capture CSV の互換性をテストで固定し、GUI や将来の解析アプリから独立して変更管理できる。

性能目標値は推測で固定せず、実機計測から決める。まず「想定最大 frame rate」「連続試験時間」「許容 drop 数」を計測可能にし、その結果を基準値として文書化する。

## 開発ロードマップ

### Phase 0: スコープ固定

- GUI の Parser / Plotter を非優先機能として明示し、新規開発を止める。
- 既存機能は一度に削除せず、受信経路と結合している箇所を列挙する。
- issue、テスト、ドキュメントの完了条件を受信中心へ変更する。

2026-06-11 に desktop の画面切替と Parser / Plotter の live 処理を `App.tsx` から外し、GUI を Monitor 専用に変更した。既存の Parser / Plotter component、core module、offline CLI は将来の分離判断に備えて残しているが、通常の GUI 実行経路からは呼び出さない。

### Phase 1: adapter と受信 loop

- WeAct adapter の初期化、timeout、切断、再接続、停止処理を重点的にテストする。
- protocol parse error と serial I/O error を分離して集計する。
- adapter capability と実際に適用された bitrate / mode を状態として返す。
- worker 終了後も `connected` に見える状態をなくし、実行中の状態を server が追跡する。

### Phase 2: 配信、capture、観測性

- capture 購読と monitor 購読の queue / drop 方針を分離し、各カウンタを公開する。
- stream 切断、遅い consumer、ファイル書き込み失敗時の挙動を固定する。
- bus ごとの rate、errors、drops、last frame、uptime を CLI から取得可能にする。
- fake adapter による server + CLI の end-to-end test を追加する。

### Phase 3: 実機耐久試験

- 1 bus、2 bus、CAN FD、高負荷、ケーブル抜去、server 再起動を試験項目にする。
- capture CSV の frame 数と server 側カウンタを照合する。
- 再現可能な試験コマンドと結果を文書へ残す。

### Phase 4: 最小 monitor GUI

- GUI を残す場合は bus 接続、状態、最新 frame、rate、errors、drops、pause / clear に限定する。
- Parser / Plotter 用 hook、timer、buffer、Tauri command は受信 monitor から切り離す。
- GUI がなくても全受信試験を実行できる状態を維持する。

### Phase 5: 後続機能

受信基盤の完成後に、送信機能、解析アプリ、Parser、Plotter を個別に再評価する。再開判断では、利用目的、入出力契約、性能要件、配布単位を先に決め、再び単一 GUI に無条件で統合しない。

## 開発コマンド

Rust 側:

```powershell
cargo fmt --all
cargo clippy --workspace --all-targets
cargo test --workspace
```

GUI 側:

```powershell
cd apps\desktop
npm.cmd install
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:smoke
```

`test:smoke` は実ウィンドウを開かず、headless Chromium で browser preview を操作する。人間の PC 操作を妨げない基本動作確認として、Monitor / Parser / Plotter の最小操作をここで検出する。

GUI の pure function は `apps/desktop/src/lib/` に切り出し、Vitest の `test:unit` で固定する。現時点では frame 表示、Parser / Plotter mapping、plot 履歴 dedup / windowing、Orion dummy frame 生成を unit test 対象にしている。Plotter の canvas 描画実装は uPlot 移行前提で一旦削除済み。

GUI から Tauri command を呼ぶ処理は `apps/desktop/src/api/` に閉じ込める。`desktopClient` は `invoke()` を担当し、`previewClient` は headless browser smoke test 用の同等データを返す。React component では `getCanRushClient()` 経由で client を使い、実ウィンドウ有無の分岐を直接持たない。

GUI の realtime lifecycle は `apps/desktop/src/hooks/` に分ける。snapshot polling と dummy frame timer は hook 側で管理し、画面 component は状態合成と表示に寄せる。Live Plot timer と Canvas animation loop は現時点では削除済み。

GUI entry point の `apps/desktop/src/main.tsx` は React root 作成だけにする。画面の状態合成は `App.tsx`、再利用する表示部品は `apps/desktop/src/components/` に置く。header / status / Monitor / Parser / Plotter の主要 component は分離済み。

Tauri backend は `apps/desktop/src-tauri/src/` で module 分割する。GUI DTO は `dto.rs`、JSON path 解決は `path.rs`、Parser / Plotter preview は `parse_plot.rs`、server HTTP client は `server_client.rs`、server process 管理は `server_process.rs`、WebSocket stream worker は `stream.rs`、共有状態は `state.rs`、Tauri command は `commands.rs` に置く。`main.rs` は Tauri builder と command 登録を中心に保つ。

2026-05-28 時点の実機最小確認では、WeActStudio 系として `COM3` と `COM85` が見えており、`canrush check --adapter weact --listen-only` で各 1 frame の受信に成功している。

2026-06-11 の方針転換後の実機確認では、WeActStudio USB2CANFDV1 を `COM3` / `CAN0`、`COM85` / `CAN1` として、nominal bitrate `S8`、data bitrate `Y2`、listen-only で使用した。確認結果は次の通り。

- CLI standalone check は両ポートとも 1 frame 受信し、`status=ok`。
- headless server へ2バスを同時接続し、3秒計測で `CAN0` 約 4,024 fps、`CAN1` 約 5,613 fps、両バスとも error 0。
- server stream から全バスを2秒間 capture し、19,146 frame を CSV へ保存した。内訳は `CAN0` 7,997 frame、`CAN1` 11,149 frame。
- capture CSV は既定ヘッダーを保持し、両busの受信frameが混在していることを確認した。
- 両バスを切断して再接続した後も、`CAN0` 約 4,026 fps、`CAN1` 約 5,617 fps、error 0 で受信を再開した。
- 実機serverへTauri GUIを接続した状態でもdesktop processは応答状態を維持し、標準エラー出力は空だった。その間のserver計測は `CAN0` 約 4,028 fps、`CAN1` 約 5,622 fps、error 0。
- server diagnostics には接続・切断情報以外のerrorは記録されなかった。

Tauri 実ウィンドウで確認する場合:

```powershell
cd apps\desktop
npm.cmd run tauri dev
```

実ウィンドウ確認は、Tauri IPC、server process 起動、serial port、Windows WebView2 固有挙動など、headless smoke では切り分けられない場合に限定する。

2026-05-28 の実機切り分けでは、GUI が起動した `canrush-server-gui` に対して CLI から `stats` / `capture` / `parse` を実行し、`COM3` / `COM85` の両バスで数千 fps 規模の受信と `examples/orion.canrush-parse.json` による信号抽出を確認している。CAN 受信、server stream、parse config 適用は成立しているため、GUI の Live Plot 不具合は Tauri 側の latest frame 共有、live preview command、plot layout mapping、canvas 表示のどこで止まるかを分けて確認する。Plotter 画面には `Samples` と `Status` を表示し、Live 押下後に「sample は増えるが point が 0」「point は増えるが canvas が空」などを実ウィンドウ上で判定できるようにしている。

2026-06-02 時点で、Plotter の canvas / Live Plot / CSV Plot / current values / performance 表示は一旦削除している。直前までの軽量化検証では canvas 自前実装の複雑さと負荷が残ったため、次にプロットを戻す場合は uPlot などの専用ライブラリへ移行する。現状の Plotter 画面は layout JSON の読み込み、series 一覧、series 属性表示だけを残し、他 UI 整理の邪魔になる描画処理と timer / buffer state は持たない。

2026-06-03 時点で、Plotter 左ペインは Foxglove の Plot Panel 設定を参考に、General / Legend / X Axis / Y Axis / Series の設定セクションへ整理している。CSV 出力パスは将来追加候補だが現時点では非表示。Series では表示対象の選択と色設定のみを扱い、色が未指定の series には GUI 側で既定パレットを自動割当する。

同日、Series の色設定は自由な color picker ではなく既定パレットのプルダウン選択に変更した。右ペインは Plotter の詳細設定ではなく、左ペインで選択した series に対応するパース済み最新値をリアルタイム表示する確認ビューとして使う。これにより uPlot 実装前に「どのデータをプロット対象にするか」と「選択対象だけが値表示に流れるか」を GUI で確認できる。

Plotter は画面表示時に parse config と plot layout を自動で読み込み、選択 series を対象に live parse API のポーリングを自動開始する。現在値確認 UI の更新周期は 50ms、理論上の上限は約 20Hz とする。API 呼び出しが処理中の場合は多重呼び出しせず次回周期へ送る。Series 色は 4x4 の固定パレットからスウォッチ付きドロップダウンで選ぶ。

Plotter には暫定のパフォーマンスメトリクスを表示する。Poll は live parse polling の実周期、API は `parsePlotLiveSince` の平均応答時間、Commit は state 更新要求から次の animation frame までの平均時間、Samples は 1 poll あたりの受信 sample 数、FPS は `requestAnimationFrame` ベースの画面更新目安、Dropped は API が返す dropped frame 数を示す。preview 環境のヘッドレス計測では 1 series 選択時に Poll 約 58ms、Commit 約 10～12ms、FPS 約 60、4 series 選択時に Poll 約 56～60ms、Commit 約 9～12ms、FPS 約 60 だった。

実機では API 時間が支配的になるケースがあるため、`parse_plot_live_since` のレスポンスに Rust 内部の内訳 metrics を追加した。Rust は command 内の総処理時間、state lock と履歴取得、parse、plot point 生成、処理 frame 数を示す。API と Rust の差が大きい場合は Tauri IPC / serialize / deserialize の比率が高く、Rust 内訳のいずれかが大きい場合はその処理を優先して最適化する。

実機計測で Rust 時間の大半が Lock に出たため、`parse_plot_live_since` 内で dropped frame 判定用の oldest sequence を取得するために履歴全体を clone していた処理を削除した。`PlotFrameHistory::since_with_oldest` で oldest sequence を O(1) 取得し、clone 対象を cursor 以降の frame だけに限定する。

Plotter の描画は uPlot で復活させた。React state に全 plot point を保持せず、App 側の ref に直近 10 秒分の `PlotPointDto` を保持し、更新時に `UPlotLiveChart` が uPlot の `setData` を呼ぶ。初期表示 series は CAN に流れない mouse 系を除外し、motor/power の 4 series を選択状態にする。preview 環境の 4 series ヘッドレス計測では uPlot 更新の `Plot` が約 5.5～15.3ms、FPS が 60 で、1 フレーム 33ms 未満の条件を満たした。

後から有効化した series が描画されない問題への対策として、live parse API は表示選択とは独立して layout 上の全 series を取得し、uPlot 側で checkbox 選択された series だけを表示する。checkbox toggle 時に plot buffer と cursor は消さず、描画対象だけを切り替える。preview dummy は 1 poll あたり 64 frame、50ms poll 時に 1 series あたり 1kHz 超相当へ上げ、4 series で後から再有効化した場合も `data-point-count` が増えることを smoke / Playwright 計測で確認した。Rust 側にも 64 cycle の Orion high-rate history から motor/power の 4 series がすべて point 化され、mouse series は含まれないテストを追加した。実機ポート COM3 / COM85 は検出できたが、2026-06-03 の確認時点では 2秒 capture が両方 0 frame で、実 CAN 入力による GUI plot 確認は未成立。

## 現在の優先順位

1. adapter、server receive loop、停止・再接続処理の安定化。
2. CLI capture、server stream、drop / error 診断の信頼性向上。
3. fake adapter を使った end-to-end test と実機耐久試験の整備。
4. GUI を受信確認用 monitor に縮小し、Parser / Plotter との結合を外す。
5. 送信、Parser、Plotter、解析 GUI は受信基盤完成後に再評価する。

## 仮リリースまでの作業

仮リリースは、WeActStudio USB2CANFDV1 を Windows PC へ接続し、受信状態の確認と CSV capture を行える評価版とする。Parser、Plotter、送信機能、他adapter対応は仮リリース範囲に含めない。

### P0: リリース前に必須

- [ ] リリース対象を Windows x64、WeActStudio USB2CANFDV1、受信専用と明記する。
- [ ] nominal bitrate / data bitrate の選択肢と、`S8` / `Y2` などデバイス固有コードの対応を利用者向けに説明する。
- [x] GUI の `Capture CSV` ボタンを仮リリース画面から削除する。captureはCLIのみとする。
- [x] GUI で接続失敗、ポート未選択、server起動失敗、受信停止を利用者が判別できる表示にする。
- [x] server worker が異常終了した場合に、bus status が `connected` のまま残らないようにする。
- [x] capture中のstream切断、queue overflowを成功扱いにせず、終了理由を表示する。ファイル書き込み失敗は既存のI/O errorとして失敗終了する。
- [x] monitor用subscriberのdrop数をdiagnosticsとGUI statusから確認できるようにする。
- [ ] 実機を接続しない状態、片方のポートだけ接続した状態、使用中ポートを選択した状態を確認する。
- [ ] 2バス同時受信を一定時間継続し、frame数、error数、drop数、メモリ使用量を記録する。
- [ ] GUI起動、server自動起動、接続、受信、切断、再接続、終了を一連の手順として実機確認する。
- [x] `cargo test --workspace`、`cargo clippy --workspace --all-targets`、GUI unit test、GUI build、GUI smoke testをすべて成功させる。
- [ ] Tauriの配布用buildを作成し、開発環境の入っていないWindows環境で起動確認する。配布buildの作成とrelease実行確認は完了。別Windows環境でのinstaller確認は未実施。
- [ ] アプリ名、version、アイコン、ウィンドウタイトル、配布ファイル名を仮リリース用に確定する。
- [ ] LICENSE、利用しているOSSのライセンス、著作権表記を確認する。
- [ ] READMEを現在の構成に合わせ、インストール、起動、接続、capture、終了、既知の制約を記載する。
- [ ] 仮リリース版の既知の問題と、データ欠落を完全には保証しない評価版であることを明記する。

### P1: 仮リリースの品質を高める

- [ ] server + CLIのfake adapter end-to-end testを自動化する。
- [ ] GUIが既存serverを利用する場合と、自動起動したserverを利用する場合の両方をテストする。
- [ ] serial read error、ケーブル抜去、server停止時のdiagnosticsとGUI表示を確認する。
- [ ] capture CSVのファイル名既定値、保存先、上書き確認、空き容量不足時の挙動を決める。
- [ ] 設定値を次回起動時に復元するか決める。少なくとも誤ったポート設定を自動接続しない。
- [ ] ログの保存先、ログレベル、利用者から問題報告を受ける際に必要な情報を決める。
- [ ] version情報をGUI、CLI、server APIで確認できるようにし、同一リリースか判別可能にする。
- [ ] リリース成果物にchecksumを付ける。

### P2: 仮リリース後でもよい

- [ ] 自動再接続。
- [ ] GUIからの高度なCAN ID filterとcapture条件設定。
- [ ] installerの署名とWindows SmartScreen対策。
- [ ] 長時間耐久試験のCIまたは専用試験環境への組み込み。
- [ ] Linux、SocketCAN、gs_usb、他USB-CAN adapter対応。
- [ ] Parser / Plotterの別アプリケーション化。
- [ ] CAN送信と定期送信。

### 推奨実施順

1. 仮リリース範囲と既知の制約を固定する。
2. worker状態、drop検出、capture失敗処理を修正する。
3. GUIの未実装表示とエラー表示を整理する。
4. 自動テスト、clippy、実機耐久試験を実施する。
5. README、LICENSE、version、アイコンなどの配布情報を整える。
6. Tauri配布buildを作成し、別Windows環境でクリーンインストール試験を行う。
7. release notes、checksum、既知の問題を添えて仮リリースする。

2026-06-11 に上記の受信経路とGUI表示を更新した。WebSocket送信は10msごとに1 frameだけを送る処理を廃止し、購読queueをまとめてdrainする。queue overflow時は `subscriber-queue-overflow` diagnosticと累積drop数を送信し、CLI captureは失敗終了、GUIはstatus barへ表示する。receive workerがerror終了または予期せず終了した場合はbus statusを`error`へ変更する。

実機2バスをrelease GUIで購読した初回試験では、約9,600 fpsの入力に対して接続直後の過渡状態で12秒間に27 frameのGUI queue dropを検出した。このためGUI購読queueを256から16,384へ拡張した。monitorは引き続きdrop許容経路だが、通常負荷の短い停滞を吸収し、drop時は累積数を必ず表示する。

queue拡張後の再試験では、`CAN0` 約4,025 fps、`CAN1` 約5,616 fpsをrelease GUIで15秒間購読し、subscriber queue drop 0、両bus error 0、desktop process応答正常を確認した。

配布buildでは `apps/desktop/scripts/prepare-sidecar.ps1` がrelease版 `canrush-server.exe` を作成し、Tauri external binaryとしてinstallerへ同梱する。配布用buildコマンドは `npm.cmd run build:bundle` とする。

2026-06-11 に NSIS installer `target/release/bundle/nsis/CANRush_0.1.0_x64-setup.exe` を生成した。最終成果物のファイルサイズは 3,449,987 byte、SHA-256 は `9B3E0A78613D2045031F2817F999EA704B9BD2C2216F70D919334C865BD639CF`。release版desktopを直接起動し、同じrelease directoryのserverを自動起動して `canrush-server-gui` / `canrush.v1` へ接続できることを確認した。installerを使ったクリーン環境試験は残作業とする。

### リリース判定

次をすべて満たした場合に仮リリース可能と判断する。

- P0項目がすべて完了している。
- 2バス同時受信とCSV captureで再現性のある重大不具合がない。
- 異常終了やデータ欠落の可能性を、エラーまたはdiagnosticsで利用者が認識できる。
- 配布物だけで起動でき、開発ツールを必要としない。
- 操作手順、対応機器、設定値、制約、問題報告方法が文書化されている。

## 判断が必要な項目

- Windows で gs_usb 系デバイスを直接扱うか、WinUSB / libusb / 別ドライバを前提にするか。
- Linux では SocketCAN を主経路にするか、gs_usb を直接 USB protocol として扱う経路も用意するか。
- 想定する最大 CAN frame rate と GUI 表示上限。
- capture 経路に必要な queue 上限、backpressure 方針、ディスク書き込みが追いつかない場合の終了条件。
- 自動再接続を server が行うか、明示的な CLI 操作に限定するか。
- 実機耐久試験の時間と、許容する error / drop の基準値。
- CAN FD の最大 data bitrate と BRS 利用有無。
- capture CSV に送信 frame を含める既定値。
- 定期送信の最小周期と安全上の上限。
