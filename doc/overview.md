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

GUI の pure function は `apps/desktop/src/lib/` に切り出し、Vitest の `test:unit` で固定する。現時点では frame 表示、Parser / Plotter mapping、plot 履歴 dedup / windowing、Orion dummy frame 生成を unit test 対象にしている。

Tauri 実ウィンドウで確認する場合:

```powershell
cd apps\desktop
npm.cmd run tauri dev
```

実ウィンドウ確認は、Tauri IPC、server process 起動、serial port、Windows WebView2 固有挙動など、headless smoke では切り分けられない場合に限定する。

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
