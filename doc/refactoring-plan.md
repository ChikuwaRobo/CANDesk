# GUI リファクタリング作業手順

この文書は [gui.md](./gui.md) のリファクタリング方針を、実際の作業順に落としたチェックリストである。各 step は原則として単独 commit / PR にできる粒度にする。

## 共通ルール

各 step の前後で次を確認する。

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

Rust / Tauri backend に触れた step では追加で次を確認する。

```powershell
cargo test -p canrush-desktop
cargo test -p canrush-core
```

作業中に Playwright の locator を変える必要が出た場合は、先に UI の role / aria-label を整理し、smoke test の意図が変わっていないことを確認する。見た目や操作を変える必要が出た場合は、その step では進めず、別の機能変更として扱う。

## Phase 0: 現状固定

目的: リファクタリング前の基準を固定する。

作業:

- `npm.cmd run build` と `npm.cmd run test:smoke` を通す。
- 必要なら `cargo test -p canrush-desktop` を通し、Tauri backend の既存 test が通ることを確認する。
- `apps/desktop/src/main.tsx` と `apps/desktop/src-tauri/src/main.rs` の行数、主要責務を作業メモに残す。

触るファイル:

- なし。失敗した場合だけ修正する。

完了条件:

- build と smoke が成功する。
- リファクタリング前の挙動を示す基準がある。

## Phase 1: Frontend 型と fixture の抽出

目的: `main.tsx` から安全に移せる型定義と sample data を分離する。

状態: 2026-05-28 完了。`types.ts` と `fixtures/previewData.ts` に抽出済み。

作業:

1. `apps/desktop/src/types.ts` を作成する。
2. `SerialPortInfo`、`BusConfig`、`LatestFrame`、`FrameDetail`、DTO 型、`SortMode`、`WorkspaceView`、Parser / Plotter 型を移す。
3. `apps/desktop/src/fixtures/previewData.ts` を作成する。
4. `initialServerInfo`、`initialBuses`、`previewPorts`、`sampleFrames`、`sampleParserSignals`、`samplePlotSeries` を移す。
5. `main.tsx` の import を更新する。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/fixtures/previewData.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- `main.tsx` から型定義と fixture が消えている。
- UI 表示と smoke test の期待値が変わっていない。

## Phase 2: frame 表示ロジックの抽出と unit test

目的: 最新 frame 表示の変換、sort、merge を unit test 可能にする。

状態: 2026-05-28 完了。`lib/frames.ts` に抽出し、Vitest の unit test を追加済み。

作業:

1. `apps/desktop/src/lib/frames.ts` を作成する。
2. 次の関数を移す。
   - `mapSnapshotFrame`
   - `formatPayloadHex`
   - `formatCanId`
   - `parseCanId`
   - `compareFrames`
   - `mergeFramesById`
   - `toFrameDetail`
   - `sumNumericStrings`
   - `numericValue`
   - `formatServerStartedAt`
   - `rateBarWidthPercent`
3. Vitest を追加する。
4. `apps/desktop/src/lib/frames.test.ts` を作成し、次を固定する。
   - standard / extended CAN ID の表示。
   - payload hex の空白区切り。
   - sort mode `bus` / `id` / `recent`。
   - merge buses 時の count / rate 合算。
   - invalid timestamp 表示。

触るファイル:

- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/lib/frames.ts`
- `apps/desktop/src/lib/frames.test.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
npm.cmd run test:unit
```

完了条件:

- frame 表示ロジックが `main.tsx` から消えている。
- 代表ケースが unit test で固定されている。

## Phase 3: Plot / Parser 変換ロジックの抽出

状態: 2026-05-28 完了。`lib/parserMapping.ts`、`lib/plotHistory.ts`、`fixtures/orionDummy.ts` に抽出し、Vitest の unit test を追加済み。

目的: plot 履歴、dedup、10 秒窓、Parser / Plotter mapping を pure function にする。

作業:

1. `apps/desktop/src/lib/parserMapping.ts` を作成し、`mapParseConfig` と `mapPlotLayout` を移す。
2. `apps/desktop/src/lib/plotHistory.ts` を作成し、次を移す。
   - `signalSampleKey`
   - `plotPointKey`
   - `resetSeenSampleKeys`
   - `resetSeenPlotPointKeys`
   - `appendUniqueSamples`
   - `appendUniquePlotPoints`
   - `filterRecentPlotPoints`
3. `apps/desktop/src/fixtures/orionDummy.ts` を作成し、`dummyIds`、`makeDummyFrame`、`makeDummyFrames`、`makeOrionDummyPayload` を移す。
4. unit test を追加する。
   - duplicate sample / point を追加しない。
   - 最大履歴件数で末尾を残す。
   - 10 秒窓の境界。
   - Orion dummy payload が 8 byte になる。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/lib/parserMapping.ts`
- `apps/desktop/src/lib/plotHistory.ts`
- `apps/desktop/src/fixtures/orionDummy.ts`
- 対応する `*.test.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:unit
npm.cmd run test:smoke
```

完了条件:

- Parser / Plotter の主要変換が unit test 可能な場所にある。
- Plotter smoke が通り、Live preview の point 生成が維持されている。

## Phase 4: Canvas 描画の抽出

状態: 2026-05-28 完了。`lib/plotCanvas.ts` に Canvas 描画と座標計算を抽出し、座標計算・系列 grouping・間引きの unit test を追加済み。

目的: Canvas 描画処理を React component から分離し、Plotter の描画責務を明確にする。

作業:

1. `apps/desktop/src/lib/plotCanvas.ts` を作成する。
2. `drawPlotCanvas` と Canvas 専用 helper を移す。
3. `drawPlotCanvas` の入力型を `PlotSeries[]` と `PlotPointDto[]` に限定する。
4. 可能なら描画範囲計算を pure function として切り出し、unit test を付ける。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/lib/plotCanvas.ts`
- 必要なら `apps/desktop/src/lib/plotCanvas.test.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:unit
npm.cmd run test:smoke
```

完了条件:

- `main.tsx` に Canvas 描画の詳細が残っていない。
- Plotter smoke が通る。

## Phase 5: Tauri / preview client の分離

状態: 2026-05-28 完了。`api/desktopClient.ts`、`api/previewClient.ts`、`api/client.ts` に分離し、`main.tsx` から直接の `invoke()` と runtime 判定を削除済み。

目的: React component から `invoke()` と `hasTauriRuntime()` 分岐を減らす。

作業:

1. `apps/desktop/src/api/desktopClient.ts` を作成する。
2. Tauri command 呼び出しを method 化する。
   - `listSerialPorts`
   - `startLocalServer`
   - `connectBus`
   - `disconnectAll`
   - `clearLatest`
   - `loadParseConfig`
   - `loadPlotLayout`
   - `parsePlotPreview`
   - `parsePlotPreviewLive`
   - `parsePlotCaptureFile`
   - `latestSnapshot`
3. `apps/desktop/src/api/previewClient.ts` を作成し、browser preview 用の同等 method を用意する。
4. `apps/desktop/src/api/client.ts` で runtime 判定し、`desktopClient` または `previewClient` を返す。
5. `main.tsx` から直接 `invoke()` を削除する。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/api/desktopClient.ts`
- `apps/desktop/src/api/previewClient.ts`
- `apps/desktop/src/api/client.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- `main.tsx` に `invoke(` が残っていない。
- browser preview と Tauri runtime の分岐が `api` 層に閉じている。

## Phase 6: realtime hook の抽出

状態: 2026-05-28 完了。`hooks/useSnapshotPolling.ts`、`hooks/useDummyFrames.ts`、`hooks/useRealtimePlot.ts`、`hooks/usePlotCanvas.ts` に timer / polling / animation frame lifecycle を抽出済み。

目的: timer と animation frame の lifecycle を component から分ける。

作業:

1. `apps/desktop/src/hooks/useSnapshotPolling.ts` を作成する。
2. `latest_snapshot` polling effect を移す。
3. `apps/desktop/src/hooks/useDummyFrames.ts` を作成する。
4. dummy data timer を移す。
5. `apps/desktop/src/hooks/useRealtimePlot.ts` を作成する。
6. Live Plot timer を移す。
7. `apps/desktop/src/hooks/usePlotCanvas.ts` を作成する。
8. `requestAnimationFrame` loop を移す。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/hooks/*.ts`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- `main.tsx` に直接 `setInterval` と `requestAnimationFrame` が残っていない。
- pause、dummy data、Live Plot の smoke が通る。

## Phase 7: Component 分割

状態: 2026-05-28 完了。`App.tsx` を作成して `main.tsx` を entry point 化し、`AppHeader`、`StatusStrip`、`MonitorView`、`BusPanel`、`FrameTable`、`FrameDetail`、`ParserView`、`PlotterView` を `components/` に抽出済み。

目的: JSX を画面単位に分け、表示 component を props 駆動にする。

作業順:

1. `components/StatusStrip.tsx` を切り出す。
2. `components/FrameDetail.tsx` を切り出す。
3. `components/FrameTable.tsx` を切り出す。
4. `components/BusPanel.tsx` を切り出す。
5. `components/MonitorView.tsx` を切り出す。
6. `components/ParserView.tsx` を切り出す。
7. `components/PlotterView.tsx` を切り出す。
8. `App.tsx` を作成し、workspace 切替と state composition を持たせる。
9. `main.tsx` は React root 作成だけにする。

触るファイル:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/*.tsx`

検証:

```powershell
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- `main.tsx` が entry point だけになっている。
- Playwright smoke の locator を大きく変更せずに通る。
- component が Tauri IPC や timer を直接持っていない。

## Phase 8: Tauri backend DTO / path / parse_plot の分割

状態: 2026-05-28 完了。`dto.rs`、`path.rs`、`parse_plot.rs` に分離し、parse / plot preview test も `parse_plot` module 側へ移動済み。

目的: Rust backend のうち副作用が少ない部分を module 化する。

作業:

1. `apps/desktop/src-tauri/src/dto.rs` を作成し、GUI 向け DTO を移す。
2. `apps/desktop/src-tauri/src/path.rs` を作成し、`resolve_existing_path` と `read_json_file` を移す。
3. `apps/desktop/src-tauri/src/parse_plot.rs` を作成し、parse / plot preview 処理を移す。
4. 既存 test を module に合わせて移動する。
5. `main.rs` から `mod dto; mod path; mod parse_plot;` を参照する。

触るファイル:

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/src/dto.rs`
- `apps/desktop/src-tauri/src/path.rs`
- `apps/desktop/src-tauri/src/parse_plot.rs`

検証:

```powershell
cargo test -p canrush-desktop
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- parse / plot preview test が移動後も通る。
- `main.rs` の command 処理が薄くなり始めている。

## Phase 9: Tauri backend server client / process / stream の分割

状態: 2026-05-28 完了。`server_client.rs`、`server_process.rs`、`stream.rs`、`state.rs`、`commands.rs` に分割済み。`main.rs` は builder、state 初期化、command 登録、薄い共有 helper 中心に整理済み。

目的: Tauri backend の副作用境界を module 化する。

作業:

1. `server_client.rs` を作成し、`get_json`、`post_json`、`parse_response`、`server_endpoint` を移す。
2. `server_process.rs` を作成し、server 起動、既存 server 利用、終了監視、実行ファイル探索を移す。
3. `stream.rs` を作成し、WebSocket worker と frame event 変換を移す。
4. `state.rs` を作成し、`ReceiverState`、`ReceiverInner`、runtime 型を移す。
5. `commands.rs` を作成し、`#[tauri::command]` 関数を集約する。
6. `main.rs` は `tauri::Builder`、state 初期化、command 登録だけにする。

触るファイル:

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/src/server_client.rs`
- `apps/desktop/src-tauri/src/server_process.rs`
- `apps/desktop/src-tauri/src/stream.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/commands.rs`

検証:

```powershell
cargo test -p canrush-desktop
cd apps\desktop
npm.cmd run build
npm.cmd run test:smoke
```

完了条件:

- `main.rs` が builder と登録処理中心になっている。
- server process 管理、HTTP client、stream worker が別 module になっている。
- Tauri command の外部的な command 名と payload が変わっていない。

## Phase 10: 整理後の仕上げ

状態: 2026-05-28 完了。GUI 起動時の local server 自動起動、Monitor toolbar の Connect / Clear / Disconnect、Plotter CSV preview と Clear Plot の headless smoke test を追加済み。実機接続は COM3 / COM85 の WeActStudio 系ポートで listen-only の最小受信確認済み。

目的: 分割後の構造を保守しやすい状態にする。

作業:

- `doc/gui.md` の目標構造と実際の構造が一致しているか確認する。
- `doc/refactoring-plan.md` の完了済み phase に日付または完了メモを残す。
- 重複した型、unused helper、古いコメントを削除する。
- smoke test が足りない基本操作を 1 つずつ追加する。

検証:

```powershell
cargo test -p canrush-core
cargo test -p canrush-desktop
cd apps\desktop
npm.cmd run build
npm.cmd run test:unit
npm.cmd run test:smoke
```

完了条件:

- frontend と backend の大きな単一ファイルが解消している。
- 基本動作は headless test で確認できる。
- 新しい GUI 変更時に触るべき module が予測できる。

## Phase 11: Plotter Live を時系列バッファ方式へ変更

状態: 2026-05-29 一部完了。Tauri backend に Plotter 用 ring buffer と cursor 付き Live Plot API を追加し、GUI は選択 series のみを Live Plot 対象にするよう変更済み。実機なし環境では browser preview のダミー Live データで GUI 操作確認済み。

目的: Live Plot を `latest` snapshot 方式から、実受信 timestamp を持つ時系列データ方式に変更する。CAN 受信データ自体は間引かず、描画だけを最大 60fps に抑える。軽量化のため、parse / plot 対象は GUI で選択された series のみに限定する。

設計方針:

- Monitor 表示は従来通り `LatestFrameState` を使う。
- Plotter Live は `latest.values()` を使わず、Tauri backend に追加する plot 用 ring buffer を読む。
- backend は WebSocket stream で受信した frame を、単調増加 sequence と実受信 timestamp 付きで ring buffer に保存する。
- frontend は `sinceSequence` cursor を保持し、前回取得以降の frame だけを Live API から受け取る。
- GUI 側で timestamp を `Date.now()` に打ち直さない。plot point の時刻は CAN frame の実受信 timestamp を使う。
- データは保存時点では集約しない。将来必要になった場合のみ、描画時に pixel column 単位の min / max 集約を検討する。

作業:

1. `ReceiverInner` に plot 用 ring buffer と次 sequence を追加する。完了。
2. `stream.rs` の frame ingest 時に、`latest` 更新に加えて ring buffer に frame を append する。完了。
3. ring buffer の上限を決める。初期値は時間ではなく frame 件数上限とし、GUI 側の表示窓 10 秒に対して余裕を持たせる。完了。初期上限は 120,000 frame。
4. `dto.rs` に Live Plot 用 request / response DTO を追加する。完了。
   - request: `since_sequence`, `selected_series_ids`
   - response: `points`, `next_sequence`, `dropped_frames`
5. `parse_plot.rs` に cursor 付き Live Plot command を追加する。完了。
   - cached parse config / plot layout を使う。
   - selected series に必要な signal だけを対象にする。
   - `since_sequence` 以降の frame を parse し、plot point を返す。
6. `desktopClient.ts` / `previewClient.ts` / `api/types.ts` に新 API を追加する。完了。
7. `App.tsx` で Live Plot cursor を管理する。完了。
   - Live start / clear / selected series 変更時に cursor と plot 履歴をリセットする。
   - 取得した point は実 timestamp のまま append する。
8. `PlotterView.tsx` に表示対象 series のチェック UI を追加する。完了。
   - 初期 ON は先頭 series のみ。
   - 詳細表示用の selected series と、描画対象 selected series ids は別 state にする。
   - Live 中の選択変更では履歴をクリアして Live を継続または再開始する。
9. canvas 描画は `requestAnimationFrame` を使い、最大 60fps にする。完了。
   - 保存済み plot point は捨てない。
   - 描画時だけ `maxCanvasPointsPerSeries` でストライド間引きを行う。
10. 旧 `parse_plot_preview_live` の latest snapshot 依存を削除するか、preview / debug 専用として明示的に隔離する。未完了。現時点では互換用に残し、GUI Live は新 API を使用する。

触るファイル:

- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/stream.rs`
- `apps/desktop/src-tauri/src/dto.rs`
- `apps/desktop/src-tauri/src/parse_plot.rs`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src/api/types.ts`
- `apps/desktop/src/api/desktopClient.ts`
- `apps/desktop/src/api/previewClient.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/PlotterView.tsx`
- `apps/desktop/src/lib/plotHistory.ts`
- `apps/desktop/src/lib/plotCanvas.ts`
- `apps/desktop/tests/smoke.spec.ts`

検証:

```powershell
cargo test -p canrush-desktop
cd apps\desktop
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:smoke
```

実機確認:

```powershell
cd apps\desktop
npm.cmd run tauri dev
```

確認手順:

1. GUI を起動し、server が自動起動または既存 server に接続されることを確認する。
2. Monitor で COM3 / COM85 の受信が継続していることを確認する。
3. Plotter で parse config / plot layout を読み込む。
4. 表示対象 series を 1 つだけ ON にする。
5. Live を開始し、`Points` が実受信に応じて増えることを確認する。
6. 表示対象 series を切り替え、履歴がリセットされ、新しい series の点だけが描画されることを確認する。
7. 10 秒程度動かして、GUI 操作が重くならないことを確認する。

完了条件:

- Live Plot が `latest.values()` ではなく時系列 ring buffer を入力にしている。
- 60Hz 以下のデータは受信 timestamp 通りの点として表示される。
- CAN 受信データ自体は Live Plot のために間引かれていない。
- 描画更新は最大 60fps に制限されている。
- 選択されていない series は parse / plot 対象にならない。
- headless smoke と実ウィンドウ確認の両方で、選択 series の Live Plot が描画される。
