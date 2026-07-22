import React from "react";

const API = `http://${window.location.hostname}:8000`;
const PERIOD_LABELS = {
  morning: "🌅 Morning",
  afternoon: "☀️ Afternoon",
  evening: "🌙 Evening",
};
const PERIOD_ORDER = ["morning", "afternoon", "evening"];

export default function HabitsList({ onToggled, onOpenBasket }) {
  const [habits, setHabits] = React.useState([]);
  const [status, setStatus] = React.useState({});
  const [currentPeriod, setCurrentPeriod] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newPeriod, setNewPeriod] = React.useState("morning");
  const [currentBasket, setCurrentBasket] = React.useState(null);

  async function fetchHabits() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/habits/today`);
      const data = await res.json();
      setHabits(data.habits || []);
      setCurrentPeriod(data.current_period);
      const statusMap = {};
      (data.habits || []).forEach((h) => (statusMap[h.id] = h.done));
      setStatus(statusMap);
    } catch (err) {
      console.error("Failed to fetch habits:", err);
    }
    setLoading(false);
  }

  React.useEffect(() => {
    fetchHabits();
  }, []);

  React.useEffect(() => {
    fetch(`${API}/baskets/current`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "ok") setCurrentBasket(data);
      })
      .catch(() => {});
  }, []);

  async function handleToggle(habitId) {
    setStatus((prev) => ({ ...prev, [habitId]: !prev[habitId] }));
    try {
      await fetch(`${API}/habits/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habit_id: habitId }),
      });
      if (onToggled) onToggled();
    } catch (err) {
      console.error("Failed to toggle habit:", err);
      fetchHabits();
    }
  }

  async function handleAddHabit() {
    if (!newTitle.trim()) return;
    await fetch(`${API}/habits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, period: newPeriod }),
    });
    setNewTitle("");
    setShowAddForm(false);
    fetchHabits();
  }

  if (loading) return <p className="muted">Loading habits...</p>;

  return (
    <div className="habits-list">
      {currentBasket && (
        <button
          className="btn-primary"
          style={{ width: "100%", marginBottom: "8px" }}
          onClick={() => onOpenBasket && onOpenBasket(currentBasket.bracket)}
        >
          🧺 {currentBasket.bracket.name} is open now
        </button>
      )}

      {PERIOD_ORDER.map((period) => {
        const periodHabits = habits.filter((h) => h.period === period);
        if (periodHabits.length === 0) return null;

        return (
          <div key={period} className="habit-period-group">
            <div
              className={`habit-period-header ${period === currentPeriod ? "current" : ""}`}
            >
              {PERIOD_LABELS[period]}
            </div>
            {periodHabits.map((h) => (
              <label key={h.id} className="habit-item">
                <input
                  type="checkbox"
                  checked={!!status[h.id]}
                  onChange={() => handleToggle(h.id)}
                />
                <span className={status[h.id] ? "habit-done" : ""}>
                  {h.title}
                </span>
              </label>
            ))}
          </div>
        );
      })}

      {habits.length === 0 && (
        <p className="muted">No habits yet — add one below.</p>
      )}

      {showAddForm ? (
        <div className="habit-add-form">
          <input
            type="text"
            placeholder="Habit name"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <div className="checkin-mode-toggle">
            {PERIOD_ORDER.map((p) => (
              <button
                key={p}
                className={newPeriod === p ? "active" : ""}
                onClick={() => setNewPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={handleAddHabit}>
            Add
          </button>
        </div>
      ) : (
        <button className="btn-ghost" onClick={() => setShowAddForm(true)}>
          + Add Habit
        </button>
      )}
    </div>
  );
}
