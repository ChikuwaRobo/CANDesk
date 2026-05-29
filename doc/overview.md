# CANRush 開発概要

CANRush は、USB-CAN アダプタを PC から利用するための CAN ビューワ / キャプチャツール群である。CLI、headless server、Tauri + React GUI を同じ `canrush-core` の上に載せ、実デバイス制御、受信ストリーム、CSV キャプチャ、将来の送信処理を GUI から独立させる。

初期ターゲットは WeActStudio USB2CANFDV1 とする。このデバイスは SLCAN 互換の仮想シリアルインターフェースを持つが、CAN FD 用の独自拡張もあるため、標準 `slcan` とは分けて `weact_slcan_fd` 系 adapter として扱う。

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
| canrush CLI      |      | Tauri Desktop GUI    |      | future plot/log app  |
| capture/check    |      | monitor/parser/plot  |      | stream/file input    |
+---------+---------+      +----------+-----------+      +----------+-----------+
          |                           |                             |
          | HTTP / WebSocket          | Tauri IPC + HTTP/WS         | future API
          v                           v                             v
+----------------------------------------------------------------------------+
| canrush-server                                                             |
| bus session management / frame stream / diagnostics / future tx scheduler  |
+------------------------------------+---------------------------------------+
                                     |
                                     | adapter abstraction
                                     v
+----------------------------------------------------------------------------+
| canrush-core                                                               |
| frame model / protocol parser / adapter helpers / capture / parser / plot  |
+------------------------------------+---------------------------------------+
                                     |
                                     v
                         USB-CAN adapters / OS CAN interfaces
```

主要ディレクトリは次の通り。

```text
crates/
  canrush-core/     共通コア。モデル、adapter、capture、server helper、parser、plot。
  canrush-cli/      CLI。capture、check、server 管理、stats、parse、plot。
  canrush-server/   headless server。HTTP control API と WebSocket stream。
apps/
  desktop/          Tauri + React GUI。
doc/
  *.md              設計・仕様メモ。
examples/
  *.csv / *.json    Parser / Plotter 確認用サンプル。
```

## 基本方針

- 実 CAN デバイスを開く責務は、通常 `canrush-server` 側に寄せる。
- GUI と CLI は同じ server stream を購読する client として扱う。
- GUI 起動時に local server が見つからない場合は自動起動する。手動の Start Server 操作は置かず、利用者は Refresh / Connect から開始する。
- CLI 単独で adapter を開く Standalone mode は、開発時 smoke test、緊急 capture、adapter bring-up 用として残す。
- 複数バスは `CAN0`、`CAN1` のような論理名で扱う。実用上は 2 バス、最大 4 バス程度を初期想定にする。
- 受信フレームは共通 `CanFrame` に正規化し、CSV capture、GUI 表示、parser、plotter で同じ表現を使う。
- 初期 capture file は CSV のみとし、列順と表記をテストで固定する。
- GUI 内ログよりも CLI capture、接続診断、統計確認を優先する。
- 送信機能は受信表示と capture が安定した後に追加する。定期送信は GUI timer ではなく server 側 scheduler で管理する。

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

GUI の pure function は `apps/desktop/src/lib/` に切り出し、Vitest の `test:unit` で固定する。現時点では frame 表示、Parser / Plotter mapping、plot 履歴 dedup / windowing、Canvas 座標計算、Orion dummy frame 生成を unit test 対象にしている。

GUI から Tauri command を呼ぶ処理は `apps/desktop/src/api/` に閉じ込める。`desktopClient` は `invoke()` を担当し、`previewClient` は headless browser smoke test 用の同等データを返す。React component では `getCanRushClient()` 経由で client を使い、実ウィンドウ有無の分岐を直接持たない。

GUI の realtime lifecycle は `apps/desktop/src/hooks/` に分ける。snapshot polling、dummy frame timer、Live Plot timer、Canvas animation loop は hook 側で管理し、画面 component は状態合成と表示に寄せる。

GUI entry point の `apps/desktop/src/main.tsx` は React root 作成だけにする。画面の状態合成は `App.tsx`、再利用する表示部品は `apps/desktop/src/components/` に置く。header / status / Monitor / Parser / Plotter の主要 component は分離済み。

Tauri backend は `apps/desktop/src-tauri/src/` で module 分割する。GUI DTO は `dto.rs`、JSON path 解決は `path.rs`、Parser / Plotter preview は `parse_plot.rs`、server HTTP client は `server_client.rs`、server process 管理は `server_process.rs`、WebSocket stream worker は `stream.rs`、共有状態は `state.rs`、Tauri command は `commands.rs` に置く。`main.rs` は Tauri builder と command 登録を中心に保つ。

2026-05-28 時点の実機最小確認では、WeActStudio 系として `COM3` と `COM85` が見えており、`canrush check --adapter weact --listen-only` で各 1 frame の受信に成功している。

Tauri 実ウィンドウで確認する場合:

```powershell
cd apps\desktop
npm.cmd run tauri dev
```

実ウィンドウ確認は、Tauri IPC、server process 起動、serial port、Windows WebView2 固有挙動など、headless smoke では切り分けられない場合に限定する。

2026-05-28 の実機切り分けでは、GUI が起動した `canrush-server-gui` に対して CLI から `stats` / `capture` / `parse` を実行し、`COM3` / `COM85` の両バスで数千 fps 規模の受信と `examples/orion.canrush-parse.json` による信号抽出を確認している。CAN 受信、server stream、parse config 適用は成立しているため、GUI の Live Plot 不具合は Tauri 側の latest frame 共有、live preview command、plot layout mapping、canvas 表示のどこで止まるかを分けて確認する。Plotter 画面には `Samples` と `Status` を表示し、Live 押下後に「sample は増えるが point が 0」「point は増えるが canvas が空」などを実ウィンドウ上で判定できるようにしている。

Live Plot の描画では、1 系列 1 点だけの初期状態でも見えるように canvas 上で線に加えて点マーカーを描く。Live は server の latest snapshot を周期的に読むため、GUI 表示用の plot point はポーリング時刻で刻んで履歴に追加する。これにより latest snapshot が同じ CAN ID 群だけを返す状態でも、時間軸上に値が積まれ、実ウィンドウで `Points` が増え続けることを確認できる。

次の Plotter Live 改修では、上記の latest snapshot 方式を暫定実装として扱い、実受信 timestamp を持つ時系列 ring buffer 方式へ変更する。CAN 受信データ自体は間引かず、描画更新だけを最大 60fps に制限する。軽量化のため、Live Plot の parse / plot 対象は GUI で選択された series のみに限定する。詳細な作業順は `doc/refactoring-plan.md` の Phase 11 に残す。

2026-05-29 時点で、Tauri backend には Plotter 用 ring buffer と cursor 付き Live Plot API を追加済み。GUI Live は選択 series のみを API に渡し、browser preview のダミーデータでは 1 series / 2 series の切り替えに応じて描画点数が増えることを確認済み。実機確認は未実施。

Plotter では大量の plot point をテキスト表として表示しない。履歴点は canvas 描画用に保持し、画面上のテキスト表示は選択 series の現在値だけにする。負荷確認用に Plotter 画面へ Live request 時間、Live points、Canvas draw 時間、Canvas points を表示する。2026-05-29 の browser preview ダミーデータ確認では、2 series 表示時に約 576 points の保持で Live request 0.0ms、Canvas draw 0.7ms 程度だった。

Plotter canvas は高密度時に raw point を直接すべて描かず、描画時だけ pixel bucket の min/max envelope に変換する。元データは捨てず、canvas へ渡す点数だけを series あたり最大 400 点に抑える。2026-05-29 の browser benchmark では、10 series × 10,000 点、合計 100,000 点の合成データで、最適化前の目安が平均 3.5ms / p95 7.0ms、初期 min/max 実装が平均 23.2ms / p95 29.4ms、最終実装が平均 8.4ms / p95 10.3ms だった。通常の preview Live 4 series 条件では raw 3,600 点に対して drawable 1,252 点、Canvas draw 約 1.0ms を確認している。

## 現在の優先順位

1. 受信表示、CLI capture、server stream の安定化。
2. GUI 基本動作の headless smoke test 維持。
3. Parser / Plotter の sample CSV / JSON 経路を安定化。
4. GUI の責務分割。`main.tsx` から state 変換、Tauri client、realtime loop、表示 component を段階的に切り出す。
5. 送信、定期送信、送信プリセットは後続フェーズで実装する。

## 判断が必要な項目

- Windows で gs_usb 系デバイスを直接扱うか、WinUSB / libusb / 別ドライバを前提にするか。
- Linux では SocketCAN を主経路にするか、gs_usb を直接 USB protocol として扱う経路も用意するか。
- 想定する最大 CAN frame rate と GUI 表示上限。
- CAN FD の最大 data bitrate と BRS 利用有無。
- capture CSV に送信 frame を含める既定値。
- 定期送信の最小周期と安全上の上限。
