import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function SuggestBracketsModal({
  onClose,
  onGenerated,
  viewedDate,
}) {
  const [context, setContext] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [dayOverride, setDayOverride] = React.useState(null); // null = use viewedDate, or "today"/"tomorrow"

  const targetDate = React.useMemo(() => {
    if (dayOverride === "today" || dayOverride === "tomorrow") {
      const d = new Date();
      if (dayOverride === "tomorrow") d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return viewedDate; // fallback to whatever day is currently navigated to
  }, [dayOverride, viewedDate]);

  async function handleSuggest() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/suggest-brackets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, target_date: targetDate }),
      });
      const data = await res.json();

      if (data.status === "error") {
        setError(data.message);
        setLoading(false);
        return;
      }

      onGenerated(data.proposals);
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
          <span className="modal-title">📋 Suggest Brackets</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="checkin-form">
            <div
              className="bracket-type-toggle"
              style={{ marginBottom: "8px" }}
            >
              <button
                className={dayOverride === null ? "active green" : ""}
                onClick={() => setDayOverride(null)}
              >
                Calendar Day
              </button>
              <button
                className={dayOverride === "today" ? "active green" : ""}
                onClick={() => setDayOverride("today")}
              >
                Today
              </button>
              <button
                className={dayOverride === "tomorrow" ? "active green" : ""}
                onClick={() => setDayOverride("tomorrow")}
              >
                Tomorrow
              </button>
            </div>
            <div className="form-field">
              <label>
                Anything to note for today?{" "}
                <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. dentist at 2pm, want to focus on the podcast project this afternoon..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
                autoFocus
              />
            </div>

            {error && (
              <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
            )}

            <button
              className="btn-primary"
              onClick={handleSuggest}
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
                  Suggesting...
                </span>
              ) : (
                "📋 Suggest Brackets"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
