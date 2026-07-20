import React, { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";

const API = `http://${window.location.hostname}:8000`;

const ENERGY_COLORS = {
  cantrip: "#A8C5D6",
  low: "#6BAF92",
  medium: "#D4A843",
  high: "#D4732A",
  deep: "#8B2E2E",
};

function EnergyLegend() {
  return (
    <div className="energy-legend">
      {Object.entries(ENERGY_COLORS).map(([label, color]) => (
        <div key={label} className="energy-legend-item">
          <div className="task-energy-dot" style={{ background: color }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function deadlineUrgency(deadline) {
  if (!deadline || deadline === "None") return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse as local date to avoid UTC offset issue
  const [year, month, day] = deadline.split("-").map(Number);
  const due = new Date(year, month - 1, day);

  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { label: "Overdue", color: "#8B2E2E", days };
  if (days === 0) return { label: "Due today", color: "#C4832A", days };
  if (days === 1) return { label: "Due tomorrow", color: "#D4A843", days };
  if (days <= 3) return { label: `Due in ${days}d`, color: "#D4A843", days };
  if (days <= 7) return { label: `Due in ${days}d`, color: "#6B6560", days };
  return { label: `Due in ${days}d`, color: "#6B6560", days };
}

function TaskCard({ task, onTouchStart, onTouchEnd, onRightClick }) {
  const urgency = deadlineUrgency(task.deadline);
  const isInProgress = task.status === "in-progress";

  return (
    <div
      className={`task-card ${isInProgress ? "in-progress" : ""}`}
      data-title={task.title}
      data-energy={task.energy}
      data-duration={task.durationMinutes}
      onTouchStart={(e) => onTouchStart(e, task)}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick(e, task);
      }}
    >
      <div
        className="task-energy-dot"
        style={{
          background: isInProgress
            ? "#7B5EA7"
            : ENERGY_COLORS[task.energy] || "#ccc",
        }}
      />
      <div className="task-card-body">
        <span className="task-card-title">{task.title}</span>
        {isInProgress && task.progress && (
          <span className="task-progress-badge">{task.progress}</span>
        )}
        {urgency && (
          <span
            className="task-deadline-badge"
            style={{ color: urgency.color }}
          >
            {urgency.label}
          </span>
        )}
      </div>
      {task.vault_path && (
        <a
          className="task-obsidian-link"
          href={`obsidian://open?vault=SmartScheduler&file=${encodeURIComponent(`${task.vault_path}#Notes`)}`}
          onClick={(e) => e.stopPropagation()}
          title="Open in Obsidian"
        >
          📓
        </a>
      )}
      {task.status === "scheduled" && (
        <span className="task-scheduled-badge">●</span>
      )}
    </div>
  );
}
const ENERGY_ORDER = { deep: 0, high: 1, medium: 2, low: 3, cantrip: 4 };

function sortByUrgency(tasks) {
  return [...tasks].sort((a, b) => {
    const ua = deadlineUrgency(a.deadline);
    const ub = deadlineUrgency(b.deadline);
    if (!ua && !ub) {
      // No deadline — sort by energy
      return (ENERGY_ORDER[a.energy] ?? 5) - (ENERGY_ORDER[b.energy] ?? 5);
    }
    if (!ua) return 1;
    if (!ub) return -1;
    if (ua.days === ub.days) {
      // Same deadline — sort by energy
      return (ENERGY_ORDER[a.energy] ?? 5) - (ENERGY_ORDER[b.energy] ?? 5);
    }
    return ua.days - ub.days;
  });
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

export default function TaskPool({ onRefresh, viewedDate }) {
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [taskMenu, setTaskMenu] = React.useState(null);
  const [filter, setFilter] = React.useState("all");
  const [plannedLater, setPlannedLater] = React.useState([]);
  const [showPlannedLater, setShowPlannedLater] = React.useState(false);

  const containerRef = useRef(null);
  const longPressTimer = useRef(null);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const viewedDateStr = viewedDate || todayStr;

  const isViewingFuture = viewedDateStr > todayStr;
  const viewedDateLabel = isViewingFuture
    ? new Date(viewedDateStr + "T12:00:00").toLocaleDateString("default", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  const plannedForViewedDate = isViewingFuture
    ? plannedLater.filter((t) => t.planned_date === viewedDateStr)
    : [];

  function loadTasks() {
    setLoading(true);
    fetch(`${API}/tasks/current`)
      .then((r) => r.json())
      .then((data) => {
        const allTasks = data.tasks
          .filter((t) => t.status !== "done")
          .map((t) => ({
            ...t,
            planned_date: t.planned_date === "None" ? null : t.planned_date,
            deadline: t.deadline === "None" ? null : t.deadline,
            created: t.created === "None" ? null : t.created,
            durationMinutes: parseDurationToMinutes(t.duration),
          }));
        // Split into current and planned later
        const current = allTasks.filter((t) => {
          if (!t.planned_date) return true;
          if (t.status === "in-progress") return true;
          return t.planned_date <= todayStr;
        });

        const future = allTasks
          .filter(
            (t) =>
              t.planned_date &&
              t.planned_date > todayStr &&
              t.status !== "in-progress",
          )
          .sort((a, b) => a.planned_date.localeCompare(b.planned_date));

        setTasks(current);
        setPlannedLater(future);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load tasks:", err);
        setLoading(false);
      });
  }

  React.useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const draggable = new Draggable(containerRef.current, {
      itemSelector: ".task-card",
      eventData: (el) => {
        const title = el.getAttribute("data-title");
        return {
          title,
          duration: {
            minutes: parseInt(el.getAttribute("data-duration") || "60"),
          },
          extendedProps: {
            type: "task",
            title,
            energy: el.getAttribute("data-energy"),
          },
        };
      },
    });
    return () => draggable.destroy();
  }, [tasks]);

  function handleTouchStart(e, task) {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setTaskMenu({ task, x: touch.clientX, y: touch.clientY });
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleRightClick(e, task) {
    setTaskMenu({ task, x: e.clientX, y: e.clientY });
  }

  function refreshAll() {
    loadTasks();
    if (onRefresh) onRefresh();
  }

  async function getResumeDuration(task) {
    // Try to get remaining from task details
    try {
      const res = await fetch(
        `${API}/task-details?title=${encodeURIComponent(task.title)}`,
      );
      const data = await res.json();
      const remaining = data.remaining;
      if (remaining && remaining.trim() && remaining !== "0") {
        return parseDurationToMinutes(remaining);
      }
    } catch (e) {
      console.error("Could not fetch task details:", e);
    }
    // Fall back to duration_estimated
    return task.durationMinutes;
  }

  async function handleTaskScheduleTime(task) {
    const time = prompt(
      'Schedule at what time?\n(e.g. "9:00 AM", "2pm", "tomorrow 9am", "friday 2pm")',
    );
    if (!time) return;
    setTaskMenu(null);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: task.durationMinutes,
        preferred_start: time,
        preferred_date: date,
      }),
    });
    refreshAll();
  }

  async function handleTaskScheduleFindSlot(task) {
    setTaskMenu(null);
    const slotRes = await fetch(`${API}/find-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_minutes: task.durationMinutes }),
    });
    const slotData = await slotRes.json();
    if (slotData.status === "found") {
      const slotStart = new Date(slotData.start_iso);
      const hours = String(slotStart.getHours()).padStart(2, "0");
      const minutes = String(slotStart.getMinutes()).padStart(2, "0");
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: task.title,
          duration_minutes: task.durationMinutes,
          preferred_start: `${hours}:${minutes}`,
          preferred_date: date,
        }),
      });
    }
    refreshAll();
  }

  async function handleTaskScheduleNow(task) {
    setTaskMenu(null);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: task.durationMinutes,
        preferred_start: `${hours}:${minutes}`,
        preferred_date: date,
      }),
    });
    refreshAll();
  }

  async function handleResumeTime(task) {
    const input = prompt(
      'Resume at what time and date?\n(e.g. "9:00 AM", "tomorrow 2pm", "wednesday" to plan for that day)',
    );
    if (!input) return;
    setTaskMenu(null);

    const duration = await getResumeDuration(task);
    const inputLower = input.trim().toLowerCase();

    // Check if input is date-only (no time component)
    const hasTime =
      /\d{1,2}(:\d{2})?\s*(am|pm)/i.test(input) ||
      /\b\d{2}:\d{2}\b/.test(input);
    const isDateOnly = !hasTime;

    if (isDateOnly) {
      // Plan for that date without scheduling a specific time
      await fetch(`${API}/plan-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: task.title,
          planned_date: input, // backend NLP handles "wednesday", "july 18" etc
        }),
      });
    } else {
      // Has a time — schedule it
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: task.title,
          duration_minutes: duration,
          preferred_start: input,
          preferred_date: null,
        }),
      });
    }
    refreshAll();
  }

  async function handleResumeFindSlot(task) {
    setTaskMenu(null);
    const duration = await getResumeDuration(task);
    const slotRes = await fetch(`${API}/find-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_minutes: duration }),
    });
    const slotData = await slotRes.json();
    if (slotData.status === "found") {
      const slotStart = new Date(slotData.start_iso);
      const hours = String(slotStart.getHours()).padStart(2, "0");
      const minutes = String(slotStart.getMinutes()).padStart(2, "0");
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: task.title,
          duration_minutes: duration,
          preferred_start: `${hours}:${minutes}`,
          preferred_date: date,
        }),
      });
    }
    refreshAll();
  }

  async function handleResumeNow(task) {
    setTaskMenu(null);
    const duration = await getResumeDuration(task);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: duration,
        preferred_start: `${hours}:${minutes}`,
        preferred_date: date,
      }),
    });
    refreshAll();
  }

  async function handleTaskPlan(task) {
    const date = prompt(
      `Plan for which date?\n(e.g. today, tomorrow, this thursday, ${todayStr})`,
    );
    if (!date) return;
    setTaskMenu(null);
    await fetch(`${API}/plan-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title, planned_date: date }),
    });
    refreshAll();
  }

  async function handleTaskSplit(task) {
    if (!task.id) {
      alert("This task doesn't have an id yet — try refreshing.");
      return;
    }
    const minutesStr = prompt(
      `Split "${task.title}" — how many minutes for the first chunk?`,
    );
    if (!minutesStr) return;
    const minutes = parseInt(minutesStr, 10);
    if (isNaN(minutes) || minutes <= 0) {
      alert("Enter a valid number of minutes.");
      return;
    }

    const res = await fetch(`${API}/split-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: task.id, first_chunk_minutes: minutes }),
    });
    const data = await res.json();
    if (data.status === "split") {
      onRefresh();
    } else {
      alert(data.message || "Failed to split task.");
    }
    setTaskMenu(null);
  }

  async function handleTaskUnschedule(task) {
    setTaskMenu(null);
    await fetch(`${API}/unschedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title }),
    });
    refreshAll();
  }

  async function handleTaskDelete(task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setTaskMenu(null);
    await fetch(`${API}/delete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title }),
    });
    refreshAll();
  }

  function applyFilter(taskList) {
    switch (filter) {
      case "due_soon":
        return taskList.filter((t) => {
          const u = deadlineUrgency(t.deadline);
          if (!u || u.days > 7) return false;

          // Hide recently spawned tasks unless they're genuinely urgent
          if (t.created) {
            const created = new Date(t.created);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const daysSinceCreated = Math.floor((today - created) / 86400000);
            if (daysSinceCreated <= 2 && u.days > 3) return false;
          }

          return true;
        });
      case "focused":
        return taskList.filter((t) => {
          const u = deadlineUrgency(t.deadline);
          const dueSoon = u && u.days <= 3;
          const highPriority =
            t.priority === "high" || t.priority === "critical";
          const plannedToday = t.planned_date === todayStr;
          return dueSoon || highPriority || plannedToday;
        });
      default:
        return taskList;
    }
  }

  const inProgress = sortByUrgency(
    applyFilter(tasks.filter((t) => t.status === "in-progress")),
  );
  const todayPlanned = sortByUrgency(
    applyFilter(
      tasks.filter(
        (t) =>
          t.planned_date === todayStr &&
          t.status !== "scheduled" &&
          t.status !== "in-progress",
      ),
    ),
  );
  const scheduled = sortByUrgency(
    applyFilter(tasks.filter((t) => t.status === "scheduled")),
  );
  const unscheduled = sortByUrgency(
    applyFilter(
      tasks.filter(
        (t) =>
          t.status !== "scheduled" &&
          t.status !== "in-progress" &&
          t.planned_date !== todayStr,
      ),
    ),
  );

  const isInProgressTask = taskMenu?.task?.status === "in-progress";

  return (
    <div className="task-pool-inner">
      {/* ── Energy Legend ── */}
      <EnergyLegend />

      {/* ── Filter Bar ── */}
      <div className="task-filter-bar">
        {[
          { key: "all", label: "All" },
          { key: "due_soon", label: "Due This Week" },
          { key: "focused", label: "Focused" },
        ].map((f) => (
          <button
            key={f.key}
            className={`task-filter-btn ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Task Sections ── */}
      <div className="task-list" ref={containerRef}>
        {loading && <p className="muted">Loading...</p>}

        {/* Today — planned for today, not yet scheduled */}
        {!loading && todayPlanned.length > 0 && (
          <>
            <div className="task-section-header">📋 Today</div>
            {todayPlanned.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onRightClick={handleRightClick}
              />
            ))}
          </>
        )}

        {/* Scheduled — has a specific time slot today */}
        {!loading && scheduled.length > 0 && (
          <>
            <div className="task-section-header">📅 Scheduled</div>
            {scheduled.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onRightClick={handleRightClick}
              />
            ))}
          </>
        )}

        {/* In Progress — started but paused, needs resuming */}
        {!loading && inProgress.length > 0 && (
          <>
            <div className="task-section-header" style={{ color: "#7B5EA7" }}>
              🔄 In Progress
            </div>
            {inProgress.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onRightClick={handleRightClick}
              />
            ))}
          </>
        )}

        {/* Unscheduled — everything else */}
        {!loading && unscheduled.length > 0 && (
          <>
            <div className="task-section-header">📋 Unscheduled</div>
            {unscheduled.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onRightClick={handleRightClick}
              />
            ))}
          </>
        )}
        {/* Planned for viewed date — only shows when viewing a future date */}
        {!loading && plannedForViewedDate.length > 0 && (
          <>
            <div
              className="task-section-header"
              style={{ color: "var(--green)" }}
            >
              📌 Planned for {viewedDateLabel}
            </div>
            {plannedForViewedDate.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onRightClick={handleRightClick}
              />
            ))}
          </>
        )}

        {/* Planned for Later — collapsible, excludes viewed date */}
        {!loading &&
          plannedLater.filter(
            (t) => !isViewingFuture || t.planned_date !== viewedDateStr,
          ).length > 0 && (
            <div className="planned-later-section">
              <button
                className="planned-later-header"
                onClick={() => setShowPlannedLater(!showPlannedLater)}
              >
                <span>
                  {showPlannedLater ? "▾" : "▸"} Planned for Later (
                  {
                    plannedLater.filter(
                      (t) =>
                        !isViewingFuture || t.planned_date !== viewedDateStr,
                    ).length
                  }
                  )
                </span>
              </button>

              {showPlannedLater && (
                <div className="planned-later-list">
                  {Object.entries(
                    plannedLater
                      .filter(
                        (t) =>
                          !isViewingFuture || t.planned_date !== viewedDateStr,
                      )
                      .reduce((groups, task) => {
                        const date = task.planned_date;
                        if (!groups[date]) groups[date] = [];
                        groups[date].push(task);
                        return groups;
                      }, {}),
                  ).map(([date, dateTasks]) => (
                    <div key={date}>
                      <div className="planned-later-date">
                        📅{" "}
                        {new Date(date + "T12:00:00").toLocaleDateString(
                          "default",
                          {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </div>
                      {dateTasks.map((task) => (
                        <TaskCard
                          key={task.file}
                          task={task}
                          onTouchStart={handleTouchStart}
                          onTouchEnd={handleTouchEnd}
                          onRightClick={handleRightClick}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        {/* Empty state */}
        {!loading &&
          inProgress.length === 0 &&
          todayPlanned.length === 0 &&
          scheduled.length === 0 &&
          unscheduled.length === 0 && (
            <p className="muted">No tasks match this filter.</p>
          )}
      </div>

      {/* ── Long Press Context Menu ── */}
      {taskMenu && (
        <>
          {/* Invisible overlay to catch outside clicks */}
          <div className="context-overlay" onClick={() => setTaskMenu(null)} />

          <div
            className="context-menu"
            style={{ top: taskMenu.y, left: taskMenu.x }}
          >
            <div className="context-title">{taskMenu.task.title}</div>

            {/* In Progress task — show Resume options */}
            {isInProgressTask ? (
              <>
                <div className="context-section-label">Resume</div>
                <button onClick={() => handleResumeFindSlot(taskMenu.task)}>
                  🔍 Find next slot
                </button>
                <button onClick={() => handleResumeNow(taskMenu.task)}>
                  ⚡ Start now
                </button>
                <button onClick={() => handleResumeTime(taskMenu.task)}>
                  📅 Enter time / date
                </button>
                <div className="context-divider" />
                <button
                  onClick={async () => {
                    setTaskMenu(null);
                    await fetch(`${API}/complete-task`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ task_title: taskMenu.task.title }),
                    });
                    refreshAll();
                  }}
                >
                  ✓ Complete
                </button>
                <div className="context-divider" />
                <button
                  className="danger"
                  onClick={() => handleTaskDelete(taskMenu.task)}
                >
                  ✕ Delete
                </button>
              </>
            ) : (
              /* Regular task — show Schedule options */
              <>
                <div className="context-section-label">Schedule</div>
                <button onClick={() => handleTaskScheduleTime(taskMenu.task)}>
                  📅 Enter time
                </button>
                <button
                  onClick={() => handleTaskScheduleFindSlot(taskMenu.task)}
                >
                  🔍 Find next slot
                </button>
                <button onClick={() => handleTaskScheduleNow(taskMenu.task)}>
                  ⚡ Start now
                </button>
                <div className="context-divider" />
                <button onClick={() => handleTaskPlan(taskMenu.task)}>
                  📋 Plan for Day
                </button>
                <button onClick={() => handleTaskSplit(taskMenu.task)}>
                  ✂️ Split Task
                </button>
                {/* Only show Unschedule if task is already scheduled */}
                {taskMenu.task.status === "scheduled" && (
                  <button onClick={() => handleTaskUnschedule(taskMenu.task)}>
                    ↩ Unschedule
                  </button>
                )}
                <div className="context-divider" />
                <button
                  className="danger"
                  onClick={() => handleTaskDelete(taskMenu.task)}
                >
                  ✕ Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
