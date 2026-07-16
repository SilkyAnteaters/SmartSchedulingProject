import React from "react";

const API = `http://${window.location.hostname}:8000`;

const isMobile = window.innerWidth <= 1024;

export default function ContextMenu({ x, y, event, onClose, onRefresh }) {
  const [view, setView] = React.useState("main");
  const [progress, setProgress] = React.useState("50%");
  const [continuationNote, setContinuationNote] = React.useState("");
  const [retryTime, setRetryTime] = React.useState("");
  const [extendMinutes, setExtendMinutes] = React.useState(15);
  const [submitting, setSubmitting] = React.useState(false);

  if (!event) return null;

  const isTask = event.extendedProps.type === "task";
  const title = event.title;

  async function handleComplete() {
    setSubmitting(true);
    await fetch(`${API}/complete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  async function handleStoppingNow() {
    setSubmitting(true);
    await fetch(`${API}/stopping-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        progress,
        remaining: "",
        continuation_note: continuationNote,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleRetry() {
    if (!retryTime.trim()) return;
    setSubmitting(true);
    await fetch(`${API}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        retry_time: retryTime,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleExtend() {
    setSubmitting(true);
    await fetch(`${API}/extend-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        additional_minutes: extendMinutes,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${title}"?`)) return;
    await fetch(`${API}/delete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  async function handleUnschedule() {
    setSubmitting(true);
    await fetch(`${API}/unschedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  return (
    <>
      <div className="context-overlay" onClick={onClose} />
      <div className="context-menu" style={{ top: y, left: x }}>
        <div className="context-title">{title}</div>

        {/* Main menu */}
        {view === "main" && isTask && (
          <>
            <button onClick={handleComplete}>✓ Complete</button>
            <button onClick={() => setView("stopping")}>⏸ Stopping Now</button>
            <button onClick={() => setView("retry")}>↩ Retry Later</button>
            <button onClick={handleUnschedule}>📋 Unschedule</button>
            {isMobile && (
              <button onClick={() => setView("extend")}>⏱ Extend</button>
            )}
            <div className="context-divider" />
            <button className="danger" onClick={handleDelete}>
              ✕ Delete
            </button>
          </>
        )}

        {view === "main" && !isTask && (
          <div className="context-note">Calendar event — view only</div>
        )}

        {/* Stopping Now form */}
        {view === "stopping" && (
          <div className="context-form">
            <div className="form-field">
              <label>Progress</label>
              <select
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              >
                <option value="10%">10%</option>
                <option value="25%">25%</option>
                <option value="50%">50%</option>
                <option value="75%">75%</option>
                <option value="90%">90%</option>
                <option value="Almost done">Almost done</option>
              </select>
            </div>
            <div className="form-field">
              <label>
                Continuation note <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="where did you leave off?"
                value={continuationNote}
                onChange={(e) => setContinuationNote(e.target.value)}
              />
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleStoppingNow}
                disabled={submitting}
              >
                {submitting ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Retry Later form */}
        {view === "retry" && (
          <div className="context-form">
            <div className="form-field">
              <label>Retry at</label>
              <input
                type="text"
                placeholder="e.g. 3pm today, tomorrow 9am"
                value={retryTime}
                onChange={(e) => setRetryTime(e.target.value)}
                autoFocus
              />
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleRetry}
                disabled={submitting || !retryTime.trim()}
              >
                {submitting ? "..." : "Set"}
              </button>
            </div>
          </div>
        )}

        {/* Extend form (mobile only) */}
        {view === "extend" && (
          <div className="context-form">
            <div className="form-field">
              <label>Add minutes</label>
              <select
                value={extendMinutes}
                onChange={(e) => setExtendMinutes(parseInt(e.target.value))}
              >
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={20}>20 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleExtend}
                disabled={submitting}
              >
                {submitting ? "..." : "Extend"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
