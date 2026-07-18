import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function GenerateScheduleModal({
  onClose,
  onGenerated,
  currentEnergy,
}) {
  const [scope, setScope] = React.useState("today");
  const [energy, setEnergy] = React.useState(currentEnergy || 3);
  const [context, setContext] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  async function handleGenerate() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/generate-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, energy, context }),
      });
      const data = await res.json();

      if (data.status === "no_tasks") {
        setError("No tasks to schedule.");
        setLoading(false);
        return;
      }

      if (data.status === "error") {
        setError(data.message);
        setLoading(false);
        return;
      }

      onGenerated(data.placements);
      onClose();
    } catch (err) {
      setError("Failed to reach server.");
      setLoading(false);
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">✨ Generate Schedule</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="checkin-form">
            {/* Scope */}
            <div className="form-field">
              <label>Schedule for</label>
              <div className="checkin-mode-toggle">
                <button
                  className={scope === "today" ? "active" : ""}
                  onClick={() => setScope("today")}
                >
                  Today
                </button>
                <button
                  className={scope === "rest_of_week" ? "active" : ""}
                  onClick={() => setScope("rest_of_week")}
                >
                  Rest of Week
                </button>
                <button
                  className={scope === "next_7_days" ? "active" : ""}
                  onClick={() => setScope("next_7_days")}
                >
                  7 Days
                </button>
              </div>
            </div>

            {/* Energy */}
            <div className="form-field">
              <label>Energy today</label>
              <div className="generate-energy-bar">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`energy-pip ${i <= energy ? "filled" : ""}`}
                    onClick={() => setEnergy(i)}
                    style={{ cursor: "pointer", width: "20px", height: "20px" }}
                  />
                ))}
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--ink-muted)",
                    marginLeft: "8px",
                  }}
                >
                  {["", "Very Low", "Low", "Medium", "High", "Peak"][energy]}
                </span>
              </div>
            </div>

            {/* Context */}
            <div className="form-field">
              <label>
                Anything to note? <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. low energy afternoon, need to finish readings, have a headache..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>

            {error && (
              <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
            )}

            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={loading}
              style={{ width: "100%" }}
            >
              {loading ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                  <div
                    className="loading-spinner"
                    style={{ width: "14px", height: "14px" }}
                  />
                  Generating...
                </span>
              ) : (
                "✨ Generate"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
