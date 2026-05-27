import {
  Activity,
  Download,
  FileJson,
  LineChart,
  Plug,
  RefreshCw,
  Server,
  Unplug,
} from "lucide-react";
import { formatServerStartedAt } from "../lib/frames";
import type { ServerInfoDto, WorkspaceView } from "../types";

type AppHeaderProps = {
  serverInfo: ServerInfoDto;
  workspaceView: WorkspaceView;
  onWorkspaceViewChange: (view: WorkspaceView) => void;
  onStartServer: () => void;
  onRefreshPorts: () => void;
  onConnectAll: () => void;
  onDisconnectAll: () => void;
};

export function AppHeader({
  serverInfo,
  workspaceView,
  onWorkspaceViewChange,
  onStartServer,
  onRefreshPorts,
  onConnectAll,
  onDisconnectAll,
}: AppHeaderProps) {
  return (
    <header className="top-bar">
      <div>
        <h1>CANRush</h1>
        <div className="server-summary" aria-label="local server status">
          <span className={`server-dot ${serverInfo.connected ? "online" : "offline"}`} />
          <span>{serverInfo.endpoint}</span>
          <span>{serverInfo.server_name}</span>
          <span>{serverInfo.protocol_version}</span>
          <span>{serverInfo.owner}</span>
          <span>{serverInfo.process_state}</span>
          <span>{serverInfo.read_only ? "read-only" : "admin"}</span>
          <span>started {formatServerStartedAt(serverInfo.started_at_unix_ms)}</span>
          {serverInfo.exit_reason ? <span>{serverInfo.exit_reason}</span> : null}
        </div>
      </div>
      <div className="toolbar" aria-label="main actions">
        <div className="workspace-tabs" role="tablist" aria-label="workspace view">
          {([
            ["monitor", "Monitor", Activity],
            ["parser", "Parser", FileJson],
            ["plotter", "Plotter", LineChart],
          ] as const).map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              className={workspaceView === value ? "active" : ""}
              onClick={() => onWorkspaceViewChange(value)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onStartServer} title="ローカルサーバー起動">
          <Server size={16} />
          Start Server
        </button>
        <button type="button" onClick={onRefreshPorts} title="ポート再読み込み">
          <RefreshCw size={16} />
          Refresh
        </button>
        <button type="button" onClick={onConnectAll} title="全バス接続">
          <Plug size={16} />
          Connect
        </button>
        <button type="button" onClick={onDisconnectAll} title="全バス切断">
          <Unplug size={16} />
          Disconnect
        </button>
        <button type="button" title="GUIキャプチャは後続実装" disabled>
          <Download size={16} />
          Capture CSV
        </button>
      </div>
    </header>
  );
}
