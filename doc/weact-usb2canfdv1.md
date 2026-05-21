# WeActStudio USB2CANFDV1 対応メモ

この文書は、CANBlaster の初期ターゲットとして使用する WeActStudio USB2CANFDV1 の対応方針をまとめる。

## 参照元

- WeActStudio USB2CANFDV1
  - https://github.com/WeActStudio/WeActStudio.USB2CANFDV1
- WeActStudio USB2CANFDV1 SLCAN Firmware
  - https://github.com/WeActStudio/WeActStudio.USB2CANFDV1.SLCAN_Firmware

## 参考になる WeActStudio リポジトリ

WeActStudio の公開リポジトリを確認した結果、CANBlaster 実装で特に参考になるものは次の通り。

| リポジトリ | 用途 |
| --- | --- |
| `WeActStudio.USB2CANFDV1` | 製品本体の README、ファームウェアパッケージ、Python CDC 速度テスト、cangaroo 配布物、回路/ドキュメントを確認する |
| `WeActStudio.USB2CANFDV1.SLCAN_Firmware` | V1 の SLCAN-FD コマンド実装そのものを確認する。`Source/App/slcan.c` が最重要 |
| `WeActStudio.USB2CANFDV2` | V2 製品資料。V1 と同系統の後継機として、将来の互換性確認に使う |
| `WeActStudio.USB2CANFDV2.SLCAN_Firmware` | V2 の SLCAN-FD ファームウェア。V1 とプロトコル差分を比較する対象 |
| `cangaroo` | WeActStudio USB2CANFDV1/V2 対応済みの CAN GUI。シリアル検出、初期化順序、SLCAN-FD 送受信パースの参考になる |
| `CANable-2.5-firmware-Slcan-and-Candlelight` | SLCAN と Candlelight を同一コードベースで扱う CANable 系ファームウェア。将来の gs_usb / Candlelight 対応検討に使う |

## 実装時に読むべきファイル

### V1 SLCAN firmware

- `WeActStudio.USB2CANFDV1.SLCAN_Firmware/Source/App/slcan.c`
  - SLCAN-FD のコマンドパーサ本体。
  - `O/C/S/Y/M/A/H/f/F/V/E/X/t/T/r/R/d/D/b/B` の扱いを確認できる。
  - 受信 CAN フレームを ASCII SLCAN 行へ変換する `slcan_parse_frame` もここにある。
- `WeActStudio.USB2CANFDV1.SLCAN_Firmware/Source/App/slcan.h`
  - SLCAN MTU、ヘッダ文字、enhanced mode 構造体などの定義を確認する。
- `WeActStudio.USB2CANFDV1.SLCAN_Firmware/Source/Bsp/can.c`
  - bitrate、data bitrate、silent mode、autoretransmit、CAN TX/RX の下位処理を確認する。
- `WeActStudio.USB2CANFDV1.SLCAN_Firmware/Test/CDC_SpeedTest_*.py`
  - USB CDC の読み書き負荷テストの参考にする。

### cangaroo

- `cangaroo/src/driver/SLCANDriver/SLCANDriver.cpp`
  - WeActStudio USB2CANFDV1/V2 のシリアルポート検出ロジックを確認する。
  - cangaroo では VID/PID `0x0483:0x5740` を見て、serial number が `AA` で始まる場合を V1、`B2` で始まる場合を V2 と判定している。
- `cangaroo/src/driver/SLCANDriver/SLCANInterface.cpp`
  - シリアルポート設定、初期化順序、SLCAN-FD の送信文字列生成、受信パース、BEL/CR 応答処理を確認する。
  - cangaroo ではシリアル baudrate を `1000000` に設定している。
  - 初期化時に `C`、`V`、`S...`、`Y...`、`M0/M1`、`H0/H1`、フィルタ、`O` の順で設定している。
- `cangaroo/src/driver/SLCANDriver/SLCANInterface.h`
  - SLCAN-FD 用の MTU、ヘッダ文字、enhanced mode 定義を確認する。

cangaroo は参考実装として読む。コードを直接流用する場合は、CANBlaster 側のライセンス方針と cangaroo のライセンス条件を別途確認する。

### CANable / Candlelight

- `CANable-2.5-firmware-Slcan-and-Candlelight`
  - 将来、SLCAN 以外に Candlelight / gs_usb 系へ対応する場合の参考にする。
  - 初期ターゲットではないため、現時点では adapter interface の将来拡張材料として扱う。

## 調査で得た実装メモ

- WeActStudio USB2CANFDV1/V2 の SLCAN-FD ASCII mode は、標準 SLCAN の `t/T/r/R` に加えて CAN FD 用の `d/D/b/B` を使う。
- V1/V2 firmware の README と `slcan.c` は、`Y1` から `Y5` の data bitrate、`H0/H1` enhanced mode、`M0/M1` silent mode、`A0/A1` automatic retransmission を持つ点で一致している。
- `slcan.c` は DLC の妥当性を Classical CAN では `0..8`、CAN FD では `0..F` として検証し、DLC から実データ長へ変換している。CANBlaster 側も同じ検証を行う。
- cangaroo の SLCAN parser は `t/T/r/R/d/D/b/B` をすべて受信フレームとして扱い、受信時刻は PC 側で付けている。CANBlaster も初期実装では host timestamp を基準にする。
- cangaroo では送信成功を CR、送信失敗を BEL として扱い、送信キュー上のフレームと対応付けている。CANBlaster でも送信要求と応答を対応付ける必要がある。
- Enhanced mode は cangaroo と firmware の両方に実装があるが、初期実装では ASCII mode `H0` に限定する。

## 位置付け

WeActStudio USB2CANFDV1 は、仮想シリアル経由で SLCAN 互換コマンドを扱う USB-CAN FD アダプタである。標準的な LAWICEL SLCAN は Classical CAN 前提だが、このデバイスのファームウェアは CAN FD 用の拡張コマンドを持つ。

CANBlaster では、このデバイスを `weact_slcan_fd` adapter profile として扱う。標準 `slcan` adapter とは分け、CAN FD、BRS、データビットレート、拡張 DLC を扱えるようにする。

## 想定 capability

| 項目 | 値 |
| --- | --- |
| `adapter` | `weact_slcan_fd` |
| `supports_classic_can` | true |
| `supports_can_fd` | true |
| `supports_bitrate_switch` | true |
| `supports_listen_only` | true。デバイス仕様上は silent mode |
| `supports_tx` | true |
| `supports_hardware_timestamp` | false。README 上はタイムスタンプ機能の記載なし |
| `max_data_length` | 64 |

## 初期化方針

初期実装では ASCII ベースの SLCAN モードを使う。Enhanced mode は実装対象外にし、明示的に `H0` を使う方針にする。

典型的な初期化手順は次の通り。

1. 仮想シリアルポートを開く。
2. 必要なら `C\r` を送って CAN チャンネルを閉じた状態にする。
3. `H0\r` で SLCAN enhanced mode を無効化する。
4. `M0\r` で normal mode、または `M1\r` で silent mode を設定する。
5. `A0\r` で automatic retransmission を無効化する。
6. `Sx\r` で nominal bitrate を設定する。
7. CAN FD を使う場合は `Yx\r` で data segment bitrate を設定する。
8. `O\r` で CAN チャンネルを開く。
9. 終了時は `C\r` で CAN チャンネルを閉じる。

`M0/M1`、`A0/A1`、`H0/H1`、フィルタ設定は CAN チャンネルを閉じた状態で行う。README では `A1` は非推奨で、クラッシュの可能性があるとされているため、初期実装では `A0` 固定を基本にする。

## Nominal bitrate

`S` 系コマンドで arbitration phase の bitrate を設定する。

| コマンド | bitrate |
| --- | --- |
| `S0` | 10 kbit/s |
| `S1` | 20 kbit/s |
| `S2` | 50 kbit/s |
| `S3` | 100 kbit/s |
| `S4` | 125 kbit/s。デフォルト |
| `S5` | 250 kbit/s |
| `S6` | 500 kbit/s |
| `S7` | 800 kbit/s |
| `S8` | 1 Mbit/s |
| `S9` | 83.3 kbit/s |
| `SA` | 75 kbit/s |
| `SB` | 62.5 kbit/s |
| `SC` | 33.3 kbit/s |
| `SD` | 5 kbit/s |

カスタム nominal bitrate として `Sxxyy` と `Sddxxyy` も用意されている。初期 UI では定義済み bitrate のみを扱い、カスタム設定は高度な設定として後回しにする。

## CAN FD data bitrate

`Y` 系コマンドで CAN FD data phase の bitrate を設定する。

| コマンド | bitrate |
| --- | --- |
| `Y1` | 1 Mbit/s |
| `Y2` | 2 Mbit/s。デフォルト |
| `Y3` | 3 Mbit/s |
| `Y4` | 4 Mbit/s |
| `Y5` | 5 Mbit/s |

カスタム data bitrate として `Yxxyy` と `Yddxxyy` も用意されている。初期 UI では `Y1` から `Y5` を選択式にする。

## フレーム表現

Classical CAN は標準 SLCAN と同じ形式を使う。

| 先頭文字 | 内容 |
| --- | --- |
| `t` | 標準 ID の Classical CAN データフレーム |
| `T` | 拡張 ID の Classical CAN データフレーム |
| `r` | 標準 ID の RTR フレーム |
| `R` | 拡張 ID の RTR フレーム |

CAN FD は次の拡張形式を使う。

| 先頭文字 | 内容 |
| --- | --- |
| `d` | 標準 ID の CAN FD データフレーム。BRS なし |
| `D` | 拡張 ID の CAN FD データフレーム。BRS なし |
| `b` | 標準 ID の CAN FD データフレーム。BRS あり |
| `B` | 拡張 ID の CAN FD データフレーム。BRS あり |

形式は `dIIILDD...\r`、`DIIIIIIIILDD...\r`、`bIIILDD...\r`、`BIIIIIIIILDD...\r` である。`III` は標準 ID、`IIIIIIII` は拡張 ID、`L` は DLC、`DD...` はデータバイト列を 16 進 ASCII で表したもの。

README の説明は送信コマンド中心だが、PC 側パーサは受信通知にも `t/T/r/R/d/D/b/B` を受け入れられるようにする。実機確認で受信行の形式が異なる場合は、このドキュメントを更新する。

## CAN FD DLC

CAN FD の DLC は 16 進 1 桁で表現する。DLC と実データ長の対応は次の通り。

| DLC | data length |
| --- | --- |
| `0` から `8` | 0 から 8 バイト |
| `9` | 12 バイト |
| `A` | 16 バイト |
| `B` | 20 バイト |
| `C` | 24 バイト |
| `D` | 32 バイト |
| `E` | 48 バイト |
| `F` | 64 バイト |

CANBlaster の共通フレームモデルでは、元の DLC と実データ長を分けて保持する。

## その他のコマンド

| コマンド | 内容 |
| --- | --- |
| `V\r` | ファームウェアバージョンを読む |
| `E\r` | failure state を読む |
| `X\r` | firmware upgrade mode に入る |
| `H0\r` | SLCAN enhanced mode を無効化 |
| `H1\r` | SLCAN enhanced mode を有効化 |
| `fIIIMMM\r` | 標準 ID フィルタを設定 |
| `FIIIIIIIIMMMMMMMM\r` | 拡張 ID フィルタを設定 |

初期実装では `X` を UI から送信しない。誤って firmware upgrade mode に入ると通常利用を妨げるため、低レベルデバッグ機能としても保護が必要である。

## Enhanced mode

ファームウェアには、`0x80 + command` から始まる binary enhanced mode がある。ASCII 形式より効率がよい可能性はあるが、初期実装では扱わない。

初期実装は `H0` の ASCII SLCAN-FD profile に限定する。高負荷時の性能が不足した場合に、enhanced mode 対応を別タスクとして検討する。
