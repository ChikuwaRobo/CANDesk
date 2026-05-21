# CANBlaster 開発概要

CANBlaster は、slcan デバイスを PC から利用するためのビューワツールとして開発する。

## 関連ドキュメント

- [slcan 仕様メモ](./slcan.md)

## 初期開発方針

- まずは CAN フレームの受信表示を安定させる。
- slcan のプロトコル仕様は `doc/slcan.md` に集約する。
- UI や実装上の判断で slcan 固有の挙動に依存する場合は、`doc/slcan.md` への参照を残す。
