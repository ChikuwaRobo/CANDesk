# Server / CLI / Capture 設計

この文書は `canrush-server`、`canrush-cli`、capture CSV、server API 境界の詳細をまとめる。全体方針は [overview.md](./overview.md) を参照する。

## 実行モード

CANRush は CLI 単独実行と server client 実行の両方を扱う。

| モード | デバイスを開く process | 主な用途 |
| --- | --- | --- |
| Standalone mode | `canrush` CLI | 開発時 smoke test、server なしの緊急 capture、adapter bring-up |
| Client mode | `canrush-server` | 通常運用、GUI 表示中の capture、stats、monitor、将来の plot live 入力 |

Windows のシリアルポートは通常 1 process が排他的に open する。GUI と CLI を併用する場合、実デバイスは `canrush-server` が開き、GUI と CLI は同じ stream を購読する。

想定コマンド:

```powershell
# Standalone mode
cargo run -p canrush-cli -- capture --adapter fake --all-buses --duration 1s --output target\fake-capture.csv
cargo run -p canrush-cli -- capture --adapter weact --port COM3 --bus CAN0 --duration 10s --output capture.csv

# Client mode
cargo run -p canrush-server -- --listen 127.0.0.1:49000
cargo run -p canrush-cli -- server connect --server 127.0.0.1:49000 --bus CAN0 --adapter fake
cargo run -p canrush-cli -- --server 127.0.0.1:49000 capture --bus CAN0 --duration 2s --output target\server-capture.csv
cargo run -p canrush-cli -- --server 127.0.0.1:49000 stats --bus CAN0 --duration 1s
```

Client mode の通常操作では、CLI は bus 接続設定を暗黙に上書きしない。接続、切断、再接続は `canrush server connect/disconnect` のような明示的な管理コマンドで行う。

## Server の責務

`canrush-server` は CANRush の device owner として、次の責務を持つ。

- 複数 USB-CAN adapter の接続、切断、設定を管理する。
- 各 bus に `CAN0`、`CAN1` などの論理名を割り当てる。
- adapter 固有 frame を共通 `CanFrame` に変換する。
- adapter capability を公開する。例: CAN FD、BRS、listen-only、tx、periodic tx、hardware timestamp。
- 受信 frame を GUI、CLI capture、将来の log / plot へ配信する。
- CAN ID ごとの最新 frame、最終受信時刻、表示用 frame rate を保持する。
- diagnostics、bus status、server status を API 経由で公開する。
- 将来の単発送信、定期送信、送信プリセットを server 側で管理する。

## Control / Stream API

現行 server は HTTP + WebSocket を使う。control は HTTP、frame stream は WebSocket に分ける。

主な endpoint:

| Endpoint | 役割 |
| --- | --- |
| `GET /api/v1/status` | server 名、protocol version、read-only、起動時刻 |
| `GET /api/v1/sessions/default/buses` | bus 状態一覧 |
| `POST /api/v1/sessions/default/buses/{bus}/connect` | bus 接続 |
| `POST /api/v1/sessions/default/buses/{bus}/disconnect` | bus 切断 |
| `GET /api/v1/sessions/default/diagnostics` | diagnostics |
| `GET /api/v1/sessions/default/stream?kind=...` | WebSocket stream |

`kind` は購読者の用途を表す。GUI、capture、plot では queue 容量と drop 許容方針が異なる。

transport / discovery は固定しすぎない。初期実装は `local` / `host:port` を同じ `ServerEndpoint` として扱い、将来の LAN 接続や discovery 名へ拡張できる余地を残す。

## Frame model

受信 frame は共通 `CanFrame` に正規化する。少なくとも次の項目を持つ。

| 項目 | 内容 |
| --- | --- |
| `bus` | `CAN0`、`CAN1` などの論理 bus 名 |
| `timestamp_host` | PC 側で受信した時刻 |
| `timestamp_device` | device / driver 由来 timestamp。ない場合は空 |
| `direction` | `rx` または `tx` |
| `id` | CAN ID |
| `id_format` | `standard` または `extended` |
| `frame_format` | `classic` または `fd` |
| `frame_type` | `data`、`remote`、`error` |
| `dlc` | CAN DLC。CAN FD では実 payload length と一致しない |
| `data_length` | 実 payload byte 数。Classical は 0..8、CAN FD は 0..64 |
| `data` | payload |
| `bitrate_switch` | CAN FD BRS |
| `error_state_indicator` | CAN FD ESI |
| `adapter` | adapter 種別 |
| `raw` | 元 protocol 行や driver 固有情報 |

GUI の最新 frame 集約キーは `bus + frame_format + id_format + id + frame_type` とする。複数 bus の同一 CAN ID 衝突を避けるため、`bus` は必ず含める。

## Capture CSV

初期 capture 出力は CSV のみとする。列順と表記は互換性のため固定する。

```text
timestamp_host,bus,direction,id,id_format,frame_format,frame_type,dlc,data_length,flags,data_hex
```

| 列 | 表記 |
| --- | --- |
| `timestamp_host` | Unix epoch 秒。ミリ秒 3 桁固定。例: `1700000000.123` |
| `bus` | 論理 bus 名 |
| `direction` | `rx` / `tx` |
| `id` | `0x` prefix 付き大文字 hex |
| `id_format` | `standard` / `extended` |
| `frame_format` | `classic` / `fd` |
| `frame_type` | `data` / `remote` / `error` |
| `dlc` | hex 1 桁表記 |
| `data_length` | 実 payload byte 数 |
| `flags` | `brs;esi` のような semicolon 区切り。該当なしは空 |
| `data_hex` | payload を空白なし大文字 hex で連結 |

この契約は `capture::tests::writes_csv_with_stable_contract` で固定する。列追加や表記変更を行う場合は、parser、plotter、外部ツール互換性、ドキュメント、golden test を同時に更新する。

## Capture 条件

Standalone mode と Client mode で、capture 条件はできるだけ揃える。

- duration
- bus。未指定なら全 bus
- CAN ID filter。`--id` と `--id-range`
- `--max-frames`
- Client mode の data size 上限として `--max-bytes`
- `include_tx`
- 出力 CSV path

終了理由は明示する。主な値は `source-ended`、`duration-elapsed`、`max-frames-reached`、`max-bytes-reached`、`stream-closed` とする。

CAN ID 指定は `0x100` と `100` のどちらも 16 進数として解釈する。

## 実機メモ

WeActStudio USB2CANFDV1 は、検証時に `COM3` と `COM85` として認識された。`COM3` を `CAN0`、`COM85` を `CAN1` とし、`--bitrate S8 --data-bitrate Y2 --listen-only` で capture できることを確認している。

`V` command の応答は受信負荷中に取得できない場合がある。version は取得できた場合のみ表示し、取得できない場合は `-` とする。残留 CAN frame 行を誤認しないよう、version 取得時は `V` で始まる応答だけを採用する。

## テスト方針

- frame model、DLC、protocol parser、capture CSV、API DTO は `canrush-core` の unit test で固定する。
- server 単体は fake adapter + CLI で確認する。
- 実 CAN adapter は `check` と短時間 capture を標準の bring-up 経路にする。
- GUI と CLI の併用は、server を device owner とする Client mode で確認する。
