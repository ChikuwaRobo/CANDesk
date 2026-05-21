# CANRush

CANRush は、USB-CAN アダプタを PC から利用するためのデスクトップビューワツールです。初期ターゲットは WeActStudio USB2CANFDV1 とし、標準 slcan とは分けて `weact_slcan_fd` adapter profile として扱います。

詳細な設計方針は [doc/overview.md](doc/overview.md) を参照してください。

## 開発環境

現時点の推奨構成は Rust workspace を中核にし、後続で Tauri + TypeScript のデスクトップ GUI を追加する方針です。

必要なツール:

- Rust stable toolchain
- `rustfmt`
- `clippy`
- Node.js。Tauri GUI 追加後に使用します

PowerShell で `npm` が実行ポリシーにより止まる場合は、`npm.cmd` を使います。

Rust は rustup でインストールします。

```powershell
winget install Rustlang.Rustup
```

インストール後、新しい PowerShell を開いて次を確認します。

```powershell
rustc --version
cargo --version
```

## 開発コマンド

```powershell
cargo fmt --all
cargo clippy --workspace --all-targets
cargo test --workspace
```

コードを変更した場合は、少なくとも `cargo fmt --all` と `cargo test --workspace` を成功させます。

## CLI

実機なしで CSV キャプチャ経路を確認する場合は fake adapter を使います。

```powershell
cargo run -p canrush-cli -- capture --adapter fake --all-buses --duration 1s --output target\fake-capture.csv
```

シリアルポート一覧は次で確認します。

```powershell
cargo run -p canrush-cli -- list-ports
```

WeActStudio USB2CANFDV1 に接続する場合は、対象ポートを指定します。

```powershell
cargo run -p canrush-cli -- capture --adapter weact --port COM3 --bus CAN0 --duration 10s --output capture.csv
```

既定値は baudrate `1000000`、nominal bitrate `S4`、data bitrate `Y2` です。listen-only 相当の silent mode を使う場合は `--listen-only` を指定します。

## 現在の構成

```text
crates/
  canrush-core/   # 共通コア。データモデル、プロトコルパーサ、frame hub、capture
  canrush-cli/    # CSV capture CLI
doc/
  overview.md     # 全体設計と実装順序
  slcan.md
  usb-can-adapters.md
  weact-usb2canfdv1.md
```
