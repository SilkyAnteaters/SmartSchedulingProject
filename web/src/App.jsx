import { useState, useCallback, useRef } from "react";
import "./App.css";
import CalendarGrid from "./components/CalendarGrid";
import TaskPool from "./components/TaskPool";
import ContextMenu from "./components/ContextMenu";
import WhatNowModal, { WhatNowInline } from "./components/WhatNowModal";
import CheckInModal from "./components/CheckInModal";
import AddTaskModal from "./components/AddTaskModal";

const API = `http://${window.location.hostname}:8000`;

function App() {
  const [view, setView] = useState("Day");
  const [energy, setEnergy] = useState(5);
  const [contextMenu, setContextMenu] = useState(null);
  const [mobileTab, setMobileTab] = useState("calendar");
  const calendarGridRef = useRef(null);
  const [taskPoolKey, setTaskPoolKey] = useState(0);
  const [showWhatNow, setShowWhatNow] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);

  const handleRefresh = useCallback(() => {
    calendarGridRef.current?.refresh();
    setTaskPoolKey((k) => k + 1);
  }, []);

  const handleContextMenu = useCallback((x, y, event) => {
    setContextMenu({ x, y, event });
  }, []);

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">SmartScheduler</span>
        <nav className="view-switcher">
          {["Day", "3 Day", "Week", "Month"].map((v) => (
            <button
              key={v}
              className={view === v ? "btn-ghost active" : "btn-ghost"}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="energy-bar">
          <span className="energy-label">Energy</span>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={i <= energy ? "energy-pip filled" : "energy-pip"}
              onClick={() => setEnergy(i)}
              style={{ cursor: "pointer" }}
            />
          ))}
        </div>
      </header>

      <main className="main-layout">
        <aside
          className={`task-pool ${mobileTab === "tasks" ? "mobile-active" : ""}`}
        >
          <h2>Tasks</h2>
          <TaskPool key={taskPoolKey} onRefresh={handleRefresh} />
        </aside>

        <section className="calendar-pane">
          <CalendarGrid
            ref={calendarGridRef}
            view={view}
            onRefresh={handleRefresh}
            onContextMenu={handleContextMenu}
          />
        </section>

        <aside
          className={`quick-panel ${mobileTab === "actions" ? "mobile-active" : ""}`}
        >
          <h2>Quick Actions</h2>

          <button
            className="btn-primary"
            onClick={() => setShowWhatNow(!showWhatNow)}
          >
            What Now
          </button>

          <button className="btn-ghost" onClick={() => setShowCheckIn(true)}>
            Check In
          </button>

          <button className="btn-ghost" onClick={() => setShowAddTask(true)}>
            Add Task
          </button>

          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm("Reset all scheduled tasks? No judgment.")) return;
              await fetch(`${API}/panic`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "manual reset from web app" }),
              });
              handleRefresh();
            }}
          >
            Panic
          </button>

          {showWhatNow && window.innerWidth <= 1024 && (
            <WhatNowInline onClose={() => setShowWhatNow(false)} />
          )}
        </aside>
      </main>

      <nav className="mobile-tabs">
        <button
          className={`mobile-tab ${mobileTab === "tasks" ? "active" : ""}`}
          onClick={() => setMobileTab("tasks")}
        >
          <span className="mobile-tab-icon">📋</span>
          Tasks
        </button>
        <button
          className={`mobile-tab ${mobileTab === "calendar" ? "active" : ""}`}
          onClick={() => setMobileTab("calendar")}
        >
          <span className="mobile-tab-icon">📅</span>
          Calendar
        </button>
        <button
          className={`mobile-tab ${mobileTab === "actions" ? "active" : ""}`}
          onClick={() => setMobileTab("actions")}
        >
          <span className="mobile-tab-icon">⚡</span>
          Actions
        </button>
      </nav>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          event={contextMenu.event}
          onClose={() => setContextMenu(null)}
          onRefresh={handleRefresh}
        />
      )}

      {showWhatNow && window.innerWidth > 1024 && (
        <WhatNowModal onClose={() => setShowWhatNow(false)} />
      )}

      {showCheckIn && <CheckInModal onClose={() => setShowCheckIn(false)} />}

      {showAddTask && (
        <AddTaskModal
          onClose={() => setShowAddTask(false)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}

export default App;
