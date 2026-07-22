import React from "react";

const API = `http://${window.location.hostname}:8000`;

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export default function BracketModal({ info, onClose, onSaved }) {
  const date = info.date;
  const startTime = info.start.includes("T")
    ? info.start.split("T")[1].slice(0, 5)
    : info.start;
  const endTime = info.end.includes("T")
    ? info.end.split("T")[1].slice(0, 5)
    : info.end;
  const dayOfWeek = DAY_NAMES[new Date(date + "T12:00:00").getDay()];

  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("green");
  const [description, setDescription] = React.useState("");
  const [reflections, setReflections] = React.useState("");
  const [recurring, setRecurring] = React.useState(true);
  const [mode, setMode] = React.useState("rigid");
  const [selectedDays, setSelectedDays] = React.useState([dayOfWeek]);
  const [submitting, setSubmitting] = React.useState(false);

  function toggleDay(day) {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSubmitting(true);

    await fetch(`${API}/brackets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type: color === "green" ? "schedule" : "block",
        color,
        start_time: startTime,
        end_time: endTime,
        days: recurring ? selectedDays : [],
        specific_date: recurring ? null : date,
        description,
        reflections,
        mode,
      }),
    });

    setSubmitting(false);
    onSaved();
    onClose();
  }

  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const WEEKEND = ["saturday", "sunday"];

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">New Bracket</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="checkin-form">
            {/* Name */}
            <div className="form-field">
              <label>Name</label>
              <input
                type="text"
                placeholder="e.g. Deep Work, Lunch, Admin"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {/* Type */}
            <div className="form-field">
              <label>Type</label>
              <div className="bracket-type-toggle">
                <button
                  className={color === "green" ? "active green" : ""}
                  onClick={() => setColor("green")}
                >
                  🟢 Schedule here
                </button>
                <button
                  className={color === "red" ? "active red" : ""}
                  onClick={() => setColor("red")}
                >
                  🔴 Block off
                </button>
              </div>
            </div>

            {color === "green" && (
              <div className="form-field">
                <label>Mode</label>
                <div className="bracket-type-toggle">
                  <button
                    className={mode === "rigid" ? "active green" : ""}
                    onClick={() => setMode("rigid")}
                  >
                    📌 Rigid
                  </button>
                  <button
                    className={mode === "basket" ? "active green" : ""}
                    onClick={() => setMode("basket")}
                  >
                    🧺 Basket
                  </button>
                </div>
              </div>
            )}

            {/* Time range — read only, set by drag */}
            <div className="form-field">
              <label>Time</label>
              <p className="muted" style={{ fontSize: "13px", margin: 0 }}>
                {startTime} – {endTime}
              </p>
            </div>

            {/* Recurring vs one-off */}
            <div className="form-field">
              <label>Repeat</label>
              <div className="checkin-mode-toggle">
                <button
                  className={recurring ? "active" : ""}
                  onClick={() => setRecurring(true)}
                >
                  Recurring
                </button>
                <button
                  className={!recurring ? "active" : ""}
                  onClick={() => setRecurring(false)}
                >
                  Just{" "}
                  {new Date(date + "T12:00:00").toLocaleDateString("default", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </button>
              </div>
            </div>

            {/* Day selector — only for recurring */}
            {recurring && (
              <div className="form-field">
                <label>Days</label>
                <div className="day-selector">
                  {[...WEEKDAYS, ...WEEKEND].map((day) => (
                    <button
                      key={day}
                      className={`day-btn ${selectedDays.includes(day) ? "active" : ""}`}
                      onClick={() => toggleDay(day)}
                    >
                      {day.slice(0, 2).toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div className="form-field">
              <label>
                Description <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="e.g. High or deep energy tasks only, prefer work folder"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Reflections */}
            <div className="form-field">
              <label>
                Reflections <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Notes, feedback, observations about this bracket"
                value={reflections}
                onChange={(e) => setReflections(e.target.value)}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={submitting || !name.trim()}
              style={{ width: "100%" }}
            >
              {submitting ? "Saving..." : "Save Bracket"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
