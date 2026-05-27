# GUI 設計と品質方針

この文書は Tauri + React GUI、Parser / Plotter、GUI の自動検証方針をまとめる。全体方針は [overview.md](./overview.md)、server / CLI 境界は [server-cli.md](./server-cli.md) を参照する。

## GUI の位置付け

Desktop GUI は CAN データの受信監視、接続操作、Parser / Plotter preview を提供する。ただし、実 CAN デバイスの owner にはしない。通常は `canrush-server` が device owner となり、GUI は Tauri backend 経由で server HTTP / WebSocket API に接続する。

この方針により、GUI 表示中でも CLI capture や stats が同じ stream を購読できる。Windows のシリアルポート排他制約にも合う。

## 現行 GUI の責務

Tauri backend:

- serial port 一覧取得。
- local `canrush-server` の起動または既存 server の利用。
- server HTTP API への connect / disconnect / status request。
- WebSocket stream の購読。
- 最新 frame state の保持。
- `canrush-core::parser` / `canrush-core::plot` を使った preview 生成。

React frontend:

- Monitor 画面。bus 設定、接続状態、最新 frame table、detail 表示。
- Parser 画面。parse config 読み込み、signal 一覧、sample preview。
- Plotter 画面。plot layout 読み込み、Canvas preview、live preview。
- browser preview mode。Tauri runtime がない状態で dummy data と sample config を使う。

## Monitor

Monitor は受信 frame の最新状態を見る画面である。表示の基本方針は次の通り。

- bus は `CAN0` / `CAN1` を初期対象にし、内部設計は最大 4 bus 程度まで自然に拡張できるようにする。
- frame table は `bus + frame_format + id_format + id + frame_type` の集約キーで表示する。
- bus filter、CAN ID search、sort、merge buses、pause、clear を扱う。
- bus load、saturated time、bus 全体 Hz は server 側 stats DTO と統合するまで `-` 表示を許容する。
- GUI 表示は drop を許容する。欠落を許容しない記録用途には CLI capture を使う。

## Parser / Plotter

Parser / Plotter は capture CSV や最新受信 frame を信号値に変換し、plot point として表示する確認機能である。

既定の sample は次を使う。

- `examples/orion.canrush-parse.json`
- `examples/orion.canrush-layout.json`
- `examples/orion-sample-capture.csv`

Parser:

- parse config JSON を読み込む。
- signal 一覧に `bus / CAN ID / data_type` を表示する。
- preview 表に timestamp、bus、frame、signal、value、unit、quality を表示する。
- GUI と CLI の `parse` は同じ `canrush-core::parser` 実装を使う。

Plotter:

- plot layout JSON を読み込む。
- plot point を `canrush-core::plot::build_plot_points()` で生成する。
- 描画は Canvas を使い、`requestAnimationFrame` を 30 fps 相当に間引く。
- 表示対象は常に最新時刻から過去 10 秒に限定する。
- frontend 側履歴は最大 10000 sample / 20000 point に制限する。
- React の表表示は末尾 200 行に制限する。

Live Plot:

- Tauri backend が保持する最新 frame state を 100 ms 周期で parse する。
- 設定 JSON は Live 中に毎回読み直さず、Load 時に backend へ cache する。
- 現段階では server stream 全量ではなく latest frame state を入力にするため、表示用 preview として扱う。

Dummy data:

- Plotter 確認用に Orion sample config と一致する `0x200`、`0x215`、`0x230`、`0x241` の Classical CAN 8 byte payload を生成する。
- browser preview では Tauri backend がないため、Live Plot は同じ系列に対して時刻付きの擬似 sample を 100 ms 周期で追加する。

## 構造整理方針

現行の `apps/desktop/src/main.tsx` は、画面部品、状態変換、dummy data、server polling、parse / plot preview、Canvas 描画が 1 ファイルに集まっている。GUI バグを減らすため、今後は次の境界に分ける。

- 表示専用 React component。props から表示を作るだけにし、Tauri IPC や timer を直接持たせない。
- GUI state / reducer。`SnapshotDto`、`BusStatusDto`、`LatestFrameDto` を画面用 state に変換する純粋関数を寄せる。
- Tauri client。`invoke()` 名、request / response 型、失敗時の error message を 1 箇所に集約する。
- realtime loop。`setInterval`、WebSocket、`requestAnimationFrame` は custom hook または backend worker に閉じ込める。
- debug fixture。browser preview dummy、fake server stream、Orion sample CSV を区別する。

React 側では、`useEffect` を外部システムとの同期に限定する。外部システムとは timer、WebSocket、DOM / Canvas、Tauri IPC などである。props / state から導出できる値は render 中の計算または `useMemo` にし、`useEffect` 内で別 state にコピーしない。

`useEffect` を追加する場合は、cleanup、依存配列、React Strict Mode の再 mount で二重接続や二重 timer が起きないことを確認する。

## リファクタリング方針

リファクタリングの目的は、見た目や機能を大きく変えることではなく、変更時に壊れる範囲を小さくし、自動テストで基本動作を守れる構造にすることである。現状では frontend の `main.tsx` が 2000 行を超え、Tauri backend の `src-tauri/src/main.rs` も 1000 行を超えているため、どちらも段階的に責務を分ける。

### 基本ルール

- 振る舞い変更と構造変更を同じ差分に混ぜない。リファクタリング PR / commit は原則として既存機能の見た目と操作を維持する。
- 1 回の変更では 1 つの境界だけを切る。例: pure function 抽出だけ、component 分割だけ、Tauri client 分離だけ。
- 各段階で `npm.cmd run build` と `npm.cmd run test:smoke` を通す。core 契約や Tauri backend に触れる場合は `cargo test -p canrush-core` または該当 Rust test も通す。
- 先に test 可能な pure function を切り出し、unit test を付ける。component や hook の分割は、その後に行う。
- browser preview / dummy data / sample CSV は refactor 中も維持する。実 CAN 機がないと確認できない構造にはしない。
- `useEffect`、timer、WebSocket、Canvas、Tauri IPC は副作用境界として明示し、cleanup のない抽出をしない。

### Frontend の目標構造

`apps/desktop/src` は次のような構成へ寄せる。

```text
src/
  main.tsx                  React entry point だけを持つ
  App.tsx                   画面全体の composition と route 相当の切替
  types.ts                  DTO と view model 型
  api/
    desktopClient.ts        Tauri invoke の wrapper
    previewClient.ts        browser preview 用 client
  fixtures/
    previewData.ts          sample frame / port / parser / plotter data
    orionDummy.ts           Orion dummy payload 生成
  lib/
    frames.ts               CAN ID format、filter、sort、merge、rate helper
    plotHistory.ts          sample / point dedup、10 秒窓、履歴上限
    plotCanvas.ts           Canvas 描画
    parserMapping.ts        ParseConfigDto / PlotLayoutDto の view model 変換
  hooks/
    useSnapshotPolling.ts   latest_snapshot polling
    useDummyFrames.ts       dummy data timer
    useRealtimePlot.ts      live plot timer
    usePlotCanvas.ts        requestAnimationFrame 描画
  components/
    MonitorView.tsx
    ParserView.tsx
    PlotterView.tsx
    BusPanel.tsx
    FrameTable.tsx
    FrameDetail.tsx
    StatusStrip.tsx
```

この分割では、`api/*` と `hooks/*` だけが副作用を持つ。`lib/*` と `fixtures/*` は unit test 可能な純粋処理にする。`components/*` は props を受け取って表示することに寄せる。

### Frontend の実装順序

1. `types.ts` と `fixtures/*` を切り出す。振る舞いは変えない。
2. `lib/frames.ts` に `formatCanId`、`mapSnapshotFrame`、filter / sort、merge buses、rate helper を移す。Vitest を追加し、代表ケースを固定する。
3. `lib/plotHistory.ts` と `lib/plotCanvas.ts` に plot point dedup、10 秒窓、Canvas 描画を移す。10 秒窓と履歴上限を unit test で固定する。
4. `api/desktopClient.ts` と `api/previewClient.ts` を作り、React component から `invoke()` を直接呼ばない形にする。
5. `hooks/*` に polling、dummy frame、live plot、Canvas draw loop を移す。cleanup と多重起動防止をテストまたは smoke で確認する。
6. `components/*` へ Monitor / Parser / Plotter を分割する。分割後も Playwright smoke の locator を極力変えない。
7. 最後に `App.tsx` を composition だけに近づけ、`main.tsx` は React root 作成だけにする。

### Tauri backend の目標構造

`apps/desktop/src-tauri/src/main.rs` は、Tauri command、server process 管理、HTTP client、WebSocket stream、parse / plot preview、DTO 変換が同居している。次の構成へ分ける。

```text
src-tauri/src/
  main.rs              tauri::Builder と command 登録
  commands.rs          #[tauri::command] 関数
  state.rs             ReceiverState / ReceiverInner / runtime state
  server_process.rs    canrush-server 起動、既存 server 検出、終了監視
  server_client.rs     HTTP get/post、ServerEndpoint、response parse
  stream.rs            WebSocket worker、FrameEventDto -> CanFrame 変換
  parse_plot.rs        parse / plot preview、config cache
  path.rs              設定 / CSV path 解決
  dto.rs               GUI 向け DTO
```

Tauri command は薄い wrapper にし、実処理は通常関数として test できる module に寄せる。WebSocket worker と process lifecycle は副作用が強いため、まず DTO 変換、path 解決、parse / plot preview のような純粋または準純粋な箇所から分ける。

### Tauri backend の実装順序

1. `dto.rs` と `path.rs` を切り出す。既存 test を維持する。
2. `parse_plot.rs` を切り出し、既存の parse / plot preview test を移す。
3. `server_client.rs` を切り出す。HTTP timeout、error message、endpoint 解決を 1 箇所に集約する。
4. `server_process.rs` を切り出す。GUI owned / external server の区別、起動待ち、終了検出を test 可能にする。
5. `stream.rs` を切り出す。`FrameEventDto -> CanFrame` 変換と WebSocket worker を分け、変換部分を unit test する。
6. 最後に `commands.rs` を薄い command layer にし、`main.rs` は builder と state 初期化だけにする。

### 優先順位

最初に frontend の pure function 抽出を行う。理由は、現在の GUI バグの多くが表示 state、dummy data、plot 履歴、timer の絡みで再現しやすく、headless smoke と unit test の効果がすぐ出るためである。

次に Tauri client / preview client を分ける。これにより、browser preview と Tauri runtime の差を明示でき、component 側が `hasTauriRuntime()` 分岐を持たずに済む。

Rust backend の大きな分割はその後に行う。backend は既に Rust test があるため、先に test を移しながら module 分割する。

### 中止条件

次の状態になった場合は、その段階の分割を止めて小さく戻す。

- `npm.cmd run test:smoke` が、対象外の画面で失敗する。
- component 分割のために Playwright locator を大きく変える必要が出た。
- 抽出先 module が元ファイルの state を広く参照し、props や引数が不自然に増えた。
- `useEffect` の依存配列が説明できない形になった。
- Tauri command の error message が変わり、CLI / GUI の切り分けが難しくなった。

## Headless-first デバッグ方針

GUI の基本動作確認は、人間の PC 操作を妨げない headless browser test を第一候補にする。

`apps/desktop` では次を標準の GUI smoke test とする。

```powershell
npm.cmd run test:smoke
```

このコマンドは Playwright Chromium を確認し、Vite dev server をテスト用 port で起動し、headless Chromium から browser preview を操作する。Tauri runtime は使わない。Monitor / Parser / Plotter の最小操作、dummy data、sample config、Canvas 描画の基本破綻を人手なしで検出する。

現在の smoke test 対象:

- Monitor preview: Start Server、Dummy data、latest frame 表示。
- Parser preview: Load、Parse、sample signal 表示。
- Plotter preview: Live 開始、plot point 生成、Canvas 表示。

Tauri WebView や `tauri-driver` を使う検証は、Tauri IPC、server process 起動、serial port、Windows WebView2 固有挙動の確認が必要な場合だけに限定する。日常の regression test と CI gate には、実ウィンドウを表示しない `npm.cmd run test:smoke` を先に置く。

## 手動デバッグ手順

基本順序:

1. `npm.cmd run build` で TypeScript と Vite build を通す。
2. `npm.cmd run test:smoke` で実ウィンドウなしの GUI 基本動作を確認する。
3. Rust 契約に関わる場合は `cargo test -p canrush-core` を通す。
4. server 単体を fake adapter + CLI で確認する。
5. headless smoke と server 単体確認で切り分けられない場合だけ `npm.cmd run tauri dev` を使う。

Windows の Tauri WebView では `Ctrl+Shift+I` で DevTools を開く。Rust 側の panic / error 調査では PowerShell で `RUST_BACKTRACE=1` 相当を有効にする。

GUI で再現した問題は、`event_log` だけに頼らず、server status、bus status、stream event、frontend state のどれが期待と違うかを記録する。

## 自動テストの追加方針

- 最初に `main.tsx` から純粋関数を切り出し、Vitest で `mapSnapshotFrame`、filter / sort、merge buses、plot 10 秒窓、dummy payload 生成をテストする。
- Tauri IPC を伴う frontend test では `@tauri-apps/api/mocks` の `mockIPC` を使い、`invoke()` の command 名、payload、成功 / 失敗時の表示を確認する。
- 画面 interaction は Testing Library 系の role / label / text query を優先する。
- Playwright では固定 sleep ではなく auto-retry される locator assertion を使う。
- `tauri-driver` + WebDriver は Windows / Linux CI または手元検証に限定し、再現性が必要な regression test から順に追加する。

## GUI 開発の完了条件

GUI の新機能は、少なくとも次を満たしてから完了とする。

- `npm.cmd run build` が成功する。
- `npm.cmd run test:smoke` が成功する。
- core 契約に触れた場合は `cargo test -p canrush-core` が成功する。
- 実 CAN 機が必要な UI には、fake adapter、dummy stream、sample CSV のいずれかの代替入力を用意する。
- 手動確認しかできない場合は、確認手順と未自動化理由をドキュメントまたは issue に残す。
