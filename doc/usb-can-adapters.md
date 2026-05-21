# USB-CAN アダプタ対応方針

この文書は、CANRush で扱う USB-CAN アダプタと CAN Adapter Layer の設計方針をまとめる。SLCAN の詳細仕様は [slcan 仕様メモ](./slcan.md) に分ける。

初期ターゲットは [WeActStudio USB2CANFDV1](./weact-usb2canfdv1.md) とする。このデバイスは SLCAN 系だが CAN FD 用の拡張コマンドを持つため、標準 `slcan` ではなく `weact_slcan_fd` adapter profile として扱う。

## 基本方針

CANRush は、特定の USB-CAN プロトコルに固定しない。サーバー内部に CAN Adapter Layer を置き、アダプタごとの差異を共通インターフェースへ変換する。

初期設計では、次の系統を想定する。

| 系統 | 例 | 位置付け |
| --- | --- | --- |
| SLCAN-FD extension | WeActStudio USB2CANFDV1 | 初期ターゲット。仮想シリアル経由で CAN FD 拡張コマンドを扱う |
| serial text protocol | slcan / LAWICEL 互換 | 実装しやすい初期対応候補。標準 slcan は Classical CAN 前提 |
| OS CAN interface | Linux SocketCAN | Linux では第一候補。gs_usb 対応デバイスも通常は `can0` などとして扱える |
| USB protocol | gs_usb / candleLight 互換 | Windows/macOS で直接扱う場合の候補。libusb/WinUSB などの検討が必要 |
| vendor SDK | PEAK、Kvaser、Vector など | 将来対応候補。各社 API を adapter として包む |

GUI、CLI、キャプチャ、ログ、送信機能は、個別アダプタを直接意識しない。サーバーが公開する bus capability と共通 CAN フレームモデルだけを参照する。

## アダプタの責務

各アダプタ実装は、次を担当する。

- デバイスまたは OS CAN interface の列挙。
- 接続、切断、再接続。
- bitrate、data bitrate、listen-only、CAN FD などの設定。
- 受信フレームを共通 CAN フレームへ変換する。
- 共通 CAN フレームをアダプタ固有の送信形式へ変換する。
- エラー、bus-off、警告状態、送信失敗をサーバーへ通知する。
- アダプタの能力をサーバーへ公開する。

アダプタ層の外側では、slcan の ASCII 行や gs_usb の USB パケットなどを直接扱わない。

## Bus capability

サーバーは各バスについて、少なくとも次の能力情報を公開する。

| 項目 | 内容 |
| --- | --- |
| `adapter` | `weact_slcan_fd`、`slcan`、`socketcan`、`gs_usb`、`vendor` など |
| `display_name` | UI 表示名 |
| `supports_classic_can` | Classical CAN 対応 |
| `supports_can_fd` | CAN FD 対応 |
| `supports_bitrate_switch` | CAN FD BRS 対応 |
| `supports_listen_only` | listen-only 対応 |
| `supports_tx` | 送信対応 |
| `supports_periodic_tx` | サーバー側定期送信の可否。通常はサーバー機能として true |
| `supports_hardware_timestamp` | ハードウェアまたはドライバ由来の時刻取得 |
| `max_data_length` | 8 または 64 |
| `supported_bitrates` | 代表的な arbitration bitrate |
| `supported_data_bitrates` | CAN FD data bitrate。非対応なら空 |

GUI はこの情報に従って、CAN FD、BRS、listen-only、送信などの UI を有効化する。

## CAN FD 対応

CAN FD では、Classical CAN と異なる点がある。

- データ長は最大 64 バイト。
- DLC と実データ長は必ずしも同じ意味ではない。
- arbitration bitrate と data bitrate を分けて設定する。
- BRS により data phase を高速化できる。
- ESI により送信側の error state を示す。
- RTR フレームは CAN FD では使用しない。

内部モデルでは、Classical CAN と CAN FD を同じ構造で扱う。ただし `frame_format`、`data_length`、`bitrate_switch`、`error_state_indicator` を明示的に持つ。

送信 UI と送信プリセットでは、CAN FD の場合に 0 から 64 バイトの payload を許可する。Classical CAN の場合は 0 から 8 バイトに制限する。

## SocketCAN / gs_usb

Linux では SocketCAN を基本経路にする。SocketCAN では CAN interface が OS のネットワークインターフェースとして見え、アプリケーションは CAN RAW socket などを通して Classical CAN / CAN FD フレームを扱える。

gs_usb は Linux kernel の CAN USB ドライバで、Geschwister Schneider / candleLight 互換 USB-CAN デバイスなどで使われる。Linux 上では gs_usb デバイスも SocketCAN interface として扱う方針が自然である。

Windows/macOS で gs_usb 系デバイスを扱う場合は、OS 標準の SocketCAN がないため、libusb/WinUSB などで gs_usb プロトコルを直接扱うか、既存ライブラリを利用する必要がある。この経路は初期実装範囲を決める前に調査する。

## slcan

slcan は ASCII ベースで実装しやすいが、標準仕様は Classical CAN 前提であり、CAN FD を扱わない。CANRush では slcan を CAN Adapter Layer の一実装として扱う。

slcan アダプタの `supports_can_fd` は通常 false とする。独自拡張で CAN FD を扱うデバイスがある場合は、標準 slcan とは別 adapter profile として扱う。WeActStudio USB2CANFDV1 はこの例であり、`weact_slcan_fd` として実装する。

## 実装優先度

初期実装の優先順位は次を候補にする。

1. 共通 CAN フレームモデルを CAN FD 対応で定義する。
2. Adapter interface と bus capability を定義する。
3. `weact_slcan_fd` adapter で Classical CAN / CAN FD の受信表示を動かす。
4. `weact_slcan_fd` adapter で CAN FD の送信、BRS、data bitrate 設定に対応する。
5. 標準 slcan adapter を追加し、Classical CAN 専用デバイスを扱えるようにする。
6. Linux SocketCAN adapter を追加し、gs_usb 系デバイスを Linux 上で扱えるようにする。
7. Windows/macOS 向け gs_usb 直接対応またはベンダー SDK 対応を検討する。

この順序にすると、初期実装で WeActStudio USB2CANFDV1 を使いながらも、内部モデルと API は CAN FD と複数アダプタを前提にできる。

## 参照元

- SocketCAN - Controller Area Network, Linux Kernel Documentation
  - https://docs.kernel.org/networking/can.html
- Linux Kernel Driver DataBase: `CONFIG_CAN_GS_USB`
  - https://cateee.net/lkddb/web-lkddb/CAN_GS_USB.html
