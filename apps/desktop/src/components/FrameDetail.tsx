import { Database } from "lucide-react";
import type { LatestFrame } from "../types";

type FrameDetailProps = {
  selectedFrame: LatestFrame | undefined;
};

export function FrameDetail({ selectedFrame }: FrameDetailProps) {
  return (
    <section className="detail-panel" aria-label="frame detail">
      <div className="panel-heading">
        <Database size={18} />
        <h2>Detail</h2>
      </div>
      {selectedFrame ? (
        <>
          <div className="detail-grid">
            <div>
              <span>Frame</span>
              <strong>
                {selectedFrame.bus} {selectedFrame.id}
              </strong>
            </div>
            <div>
              <span>Payload</span>
              <strong className="mono">{selectedFrame.data}</strong>
            </div>
            <div>
              <span>Metadata</span>
              <strong>
                {selectedFrame.frameFormat} / DLC {selectedFrame.dlc} / {selectedFrame.length} byte
              </strong>
            </div>
            <div>
              <span>Raw line</span>
              <strong className="mono">{selectedFrame.raw || "-"}</strong>
            </div>
          </div>
          {selectedFrame.mergedDetails && selectedFrame.mergedDetails.length > 1 ? (
            <div className="merged-detail-list">
              {selectedFrame.mergedDetails.map((detail) => (
                <div className="merged-detail-row" key={detail.bus}>
                  <strong>{detail.bus}</strong>
                  <span className="mono">{detail.data || "-"}</span>
                  <span>{detail.rateHz} Hz</span>
                  <span>{detail.count.toLocaleString()}</span>
                  <span className="mono">{detail.raw || "-"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="empty-detail">Select a frame</p>
      )}
    </section>
  );
}
