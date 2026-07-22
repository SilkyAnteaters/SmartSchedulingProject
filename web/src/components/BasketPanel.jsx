import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function BasketPanel({ bracket, onClose, onRefresh }) {
  const [habits, setHabits] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  async function fetchPool() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/baskets/${bracket.id}/pool`);
      const data = await res.json();
      if (data.status !== "ok") {
        setError(data.message || "Failed to load basket.");
      } else {
        setHabits(data.habits || []);
        setTasks(data.tasks || []);
      }
    } catch (err) {
      setError("Could not reach server.");
    }
    setLoading(false);
  }

  React.useEffect(() => {
    fetchPool();
  }, [bracket.id]);

  async function handleToggleHabit(habitId) {
    setHabits((prev) =>
      prev.map((h) => (h.id === habitId ? { ...h, done: !h.done } : h)),
    );
    try {
      await fetch(`${API}/habits/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habit_id: habitId }),
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      fetchPool();
    }
  }

  async function handleCompleteTask(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await fetch(`${API}/complete-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_title: task.title }),
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      fetchPool();
    }
  }

  async function handleExcludeTask(task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await fetch(`${API}/baskets/${bracket.id}/exclude-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.id }),
      });
    } catch (err) {
      fetchPool();
    }
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">🧺 {bracket.name}</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="muted">Loading...</p>}
          {error && (
            <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
          )}

          {!loading && !error && (
            <div className="habits-list">
              {habits.length > 0 && (
                <div className="habit-period-group">
                  <div className="habit-period-header current">Habits</div>
                  {habits.map((h) => (
                    <label key={h.id} className="habit-item">
                      <input
                        type="checkbox"
                        checked={!!h.done}
                        onChange={() => handleToggleHabit(h.id)}
                      />
                      <span className={h.done ? "habit-done" : ""}>
                        {h.title}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {tasks.length > 0 && (
                <div className="habit-period-group">
                  <div className="habit-period-header current">Tasks</div>
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <label
                        className="habit-item"
                        style={{ flex: 1 }}
                        onClick={(e) => {
                          e.preventDefault();
                          handleCompleteTask(t);
                        }}
                      >
                        <input type="checkbox" checked={false} readOnly />
                        <span>
                          {t.title}{" "}
                          <span className="muted" style={{ fontSize: "11px" }}>
                            ({t.duration_estimated})
                          </span>
                        </span>
                      </label>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: "11px", padding: "4px 8px" }}
                        onClick={() => handleExcludeTask(t)}
                        title="Don't show this task in this basket"
                      >
                        🚫
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {habits.length === 0 && tasks.length === 0 && (
                <p className="muted">Nothing in this basket right now.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
