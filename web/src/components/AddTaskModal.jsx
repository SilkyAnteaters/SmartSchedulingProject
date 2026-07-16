import React from "react";

const API = `http://${window.location.hostname}:8000`;

const STEPS = {
  INPUT: "input",
  PREVIEW: "preview",
  DUPLICATE: "duplicate",
  DONE: "done",
};

export default function AddTaskModal({ onClose, onRefresh }) {
  const [step, setStep] = React.useState(STEPS.INPUT);
  const [text, setText] = React.useState("");
  const [parsed, setParsed] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState("");

  async function handleParse() {
    if (!text.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/parse-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.status === "parsed") {
        setParsed(data.task);
        setStep(STEPS.PREVIEW);
      } else {
        setError("Failed to parse task. Try again.");
      }
    } catch (err) {
      setError("Could not reach server.");
    }
    setLoading(false);
  }

  async function handleAdd(scheduleMode) {
    setLoading(true);

    // Create the task
    const addRes = await fetch(`${API}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, force: false }),
    });
    const addData = await addRes.json();

    if (addData.status === "duplicate") {
      setStep(STEPS.DUPLICATE);
      setLoading(false);
      return;
    }

    if (addData.status !== "created") {
      setError("Failed to create task.");
      setLoading(false);
      return;
    }

    // Schedule if requested
    if (scheduleMode === "find-slot") {
      const duration = parseDurationToMinutes(parsed.duration_estimated);
      const slotRes = await fetch(`${API}/find-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: duration }),
      });
      const slotData = await slotRes.json();

      if (slotData.status === "found") {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        await fetch(`${API}/schedule-task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_title: parsed.title,
            duration_minutes: duration,
            preferred_start: slotData.start,
            preferred_date: date,
          }),
        });
        setResult(`Scheduled for ${slotData.start} – ${slotData.end}`);
      } else {
        setResult("Added to backlog — no free slot found today.");
      }
    } else if (scheduleMode === "now") {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const duration = parseDurationToMinutes(parsed.duration_estimated);

      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: parsed.title,
          duration_minutes: duration,
          preferred_start: `${hours}:${minutes}`,
          preferred_date: date,
        }),
      });
      setResult(`Scheduled now until ${getEndTime(now, duration)}`);
    } else {
      setResult("Added to backlog.");
    }

    setStep(STEPS.DONE);
    setLoading(false);
    onRefresh();
  }

  async function handleForceAdd(scheduleMode) {
    setLoading(true);
    await fetch(`${API}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, force: true }),
    });
    setResult("Created (duplicate overridden).");
    setStep(STEPS.DONE);
    setLoading(false);
    onRefresh();
  }

  function parseDurationToMinutes(duration) {
    if (!duration) return 60;
    let minutes = 0;
    const hrMatch = duration.match(/([\d.]+)\s*hr/);
    const minMatch = duration.match(/(\d+)\s*min/);
    if (hrMatch) minutes += parseFloat(hrMatch[1]) * 60;
    if (minMatch) minutes += parseInt(minMatch[1]);
    return minutes || 60;
  }

  function getEndTime(start, durationMinutes) {
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Add Task</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {/* Step 1 — Input */}
          {step === STEPS.INPUT && (
            <div className="checkin-form">
              <div className="form-field">
                <label>Describe the task</label>
                <textarea
                  rows={3}
                  placeholder="e.g. read chapter 4, due thursday, 45 min, medium energy"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                />
              </div>
              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}
              <button
                className="btn-primary"
                onClick={handleParse}
                disabled={loading || !text.trim()}
                style={{ width: "100%" }}
              >
                {loading ? "Parsing..." : "Parse →"}
              </button>
            </div>
          )}

          {/* Step 2 — Preview */}
          {step === STEPS.PREVIEW && parsed && (
            <div className="checkin-form">
              <div className="task-preview">
                <div className="preview-row">
                  <span className="preview-label">Title</span>
                  <span className="preview-value">{parsed.title}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Duration</span>
                  <span className="preview-value">
                    {parsed.duration_estimated}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Energy</span>
                  <span className="preview-value">
                    {parsed.energy_required}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Priority</span>
                  <span className="preview-value">{parsed.priority}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Deadline</span>
                  <span className="preview-value">
                    {parsed.deadline || "none"}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Folder</span>
                  <span className="preview-value">{parsed.folder}</span>
                </div>
                {parsed.tags?.length > 0 && (
                  <div className="preview-row">
                    <span className="preview-label">Tags</span>
                    <span className="preview-value">
                      {parsed.tags.join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}

              <div className="add-task-buttons">
                <button
                  className="btn-ghost"
                  onClick={() => setStep(STEPS.INPUT)}
                  disabled={loading}
                >
                  ← Edit
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => handleAdd("backlog")}
                  disabled={loading}
                >
                  Add to Unscheduled
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => handleAdd("find-slot")}
                  disabled={loading}
                >
                  {loading ? "..." : "Add & Find Slot"}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => handleAdd("now")}
                  disabled={loading}
                >
                  {loading ? "..." : "Add & Start Now"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Duplicate warning */}
          {step === STEPS.DUPLICATE && (
            <div className="checkin-form">
              <p style={{ color: "var(--amber)", fontSize: "13px" }}>
                ⚠️ A task with this title already exists.
              </p>
              <div className="add-task-buttons">
                <button
                  className="btn-ghost"
                  onClick={() => setStep(STEPS.PREVIEW)}
                >
                  ← Back
                </button>
                <button
                  className="btn-danger"
                  onClick={() => handleForceAdd("backlog")}
                  disabled={loading}
                >
                  Create Anyway
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Done */}
          {step === STEPS.DONE && (
            <div style={{ textAlign: "center", padding: "24px" }}>
              <p
                style={{
                  color: "var(--green)",
                  fontSize: "15px",
                  marginBottom: "8px",
                }}
              >
                ✓ Task created
              </p>
              <p style={{ color: "var(--ink-muted)", fontSize: "13px" }}>
                {result}
              </p>
              <button
                className="btn-ghost"
                onClick={() => {
                  setText("");
                  setParsed(null);
                  setStep(STEPS.INPUT);
                  setResult("");
                }}
                style={{ marginTop: "16px" }}
              >
                Add Another
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
