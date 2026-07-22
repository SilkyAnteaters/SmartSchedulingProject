import { useState, useCallback, useRef, useEffect } from "react";
import "./App.css";
import CalendarGrid from "./components/CalendarGrid";
import TaskPool from "./components/TaskPool";
import ContextMenu from "./components/ContextMenu";
import WhatNowModal, { WhatNowInline } from "./components/WhatNowModal";
import CheckInModal from "./components/CheckInModal";
import AddTaskModal from "./components/AddTaskModal";
import BracketModal from "./components/BracketModal";
import BracketManager from "./components/BracketManager";
import GenerateScheduleModal from "./components/GenerateScheduleModal";
import BracketProposalModal from "./components/BracketProposalModal";
import SuggestBracketsModal from "./components/SuggestBracketsModal";
import HabitsList from "./components/HabitsList";
import BasketPanel from "./components/BasketPanel";

const API = `http://${window.location.hostname}:8000`;
const ENERGY_LABELS = ["Cantrip", "Low", "Medium", "High", "Deep"];

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
  const [showAdmin, setShowAdmin] = useState(false);
  const [viewedDate, setViewedDate] = useState(null);
  const [newBracket, setNewBracket] = useState(null);
  const [showBrackets, setShowBrackets] = useState(false);
  const [showGenerateSchedule, setShowGenerateSchedule] = useState(false);
  const [showSuggestBrackets, setShowSuggestBrackets] = useState(false);
  const ghostBlocksRef2 = useRef([]);
  const [ghostCount, setGhostCount] = useState(0);
  const bracketProposalsRef2 = useRef([]);
  const [proposalCount, setProposalCount] = useState(0);
  const [editingProposal, setEditingProposal] = useState(null);
  const [habitBadgeCount, setHabitBadgeCount] = useState(0);
  const [showHabits, setShowHabits] = useState(false);
  const [openBasket, setOpenBasket] = useState(null);
  const [hoveredEnergy, setHoveredEnergy] = useState(null);

  const handleRefresh = useCallback(() => {
    calendarGridRef.current?.refresh();
    setTaskPoolKey((k) => k + 1);
  }, []);

  const handleContextMenu = useCallback((x, y, event) => {
    setContextMenu({ x, y, event });
  }, []);

  const handleDateClick = useCallback((dateStr) => {
    setView("Day");
    setTimeout(() => {
      calendarGridRef.current?.gotoDate(dateStr);
    }, 50);
  }, []);

  const handleDateChange = useCallback((date) => {
    setViewedDate(date);
  }, []);

  const handleBracketCreate = useCallback((info) => {
    setNewBracket(info);
  }, []);

  const handleGenerated = useCallback((placements) => {
    if (!placements) return;
    ghostBlocksRef2.current = placements;
    setGhostCount(placements.length);
    calendarGridRef.current?.setGhostBlocks(placements);
    setMobileTab("calendar");
  }, []);

  const handleGhostReject = useCallback((idx) => {
    ghostBlocksRef2.current = ghostBlocksRef2.current.filter(
      (_, i) => i !== idx,
    );
    setGhostCount(ghostBlocksRef2.current.length);
    calendarGridRef.current?.updateGhostBlocks(ghostBlocksRef2.current);
  }, []);

  const handleGhostMove = useCallback((idx, date, startTime) => {
    ghostBlocksRef2.current = ghostBlocksRef2.current.map((b, i) =>
      i === idx ? { ...b, date, start_time: startTime } : b,
    );
    calendarGridRef.current?.updateGhostBlocks(ghostBlocksRef2.current);
  }, []);

  const handleBracketProposalsGenerated = useCallback((proposals) => {
    if (!proposals) return;
    bracketProposalsRef2.current = proposals;
    setProposalCount(proposals.length);
    calendarGridRef.current?.setBracketProposals(proposals);
    setMobileTab("calendar");
  }, []);

  const handleBracketProposalEdit = useCallback((proposal) => {
    setEditingProposal(proposal);
  }, []);

  const handleBracketProposalReject = useCallback((proposalId) => {
    bracketProposalsRef2.current = bracketProposalsRef2.current.filter(
      (p) => p.proposal_id !== proposalId,
    );
    setProposalCount(bracketProposalsRef2.current.length);
    calendarGridRef.current?.removeBracketProposal(proposalId);
  }, []);

  const handleBracketProposalMove = useCallback(
    (proposalId, date, startTime, endTime) => {
      bracketProposalsRef2.current = bracketProposalsRef2.current.map((p) =>
        p.proposal_id === proposalId
          ? {
              ...p,
              specific_date: date,
              start_time: startTime,
              end_time: endTime,
            }
          : p,
      );
    },
    [],
  );

  const handleBracketProposalResize = useCallback(
    (proposalId, date, startTime, endTime) => {
      bracketProposalsRef2.current = bracketProposalsRef2.current.map((p) =>
        p.proposal_id === proposalId
          ? {
              ...p,
              specific_date: date,
              start_time: startTime,
              end_time: endTime,
            }
          : p,
      );
    },
    [],
  );

  const handleBracketProposalAccept = useCallback((proposalId) => {
    bracketProposalsRef2.current = bracketProposalsRef2.current.filter(
      (p) => p.proposal_id !== proposalId,
    );
    setProposalCount(bracketProposalsRef2.current.length);
    calendarGridRef.current?.removeBracketProposal(proposalId);
    calendarGridRef.current?.refresh();
  }, []);

  const refreshHabitBadge = useCallback(async () => {
    try {
      const res = await fetch(`${API}/habits/today`);
      const data = await res.json();
      setHabitBadgeCount(data.badge_count || 0);
    } catch (err) {
      console.error("Failed to fetch habit badge:", err);
    }
  }, []);

  const handleBasketOpen = useCallback((bracket) => {
    setOpenBasket(bracket);
    setShowHabits(false);
  }, []);

  useEffect(() => {
    refreshHabitBadge();
    const interval = setInterval(refreshHabitBadge, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshHabitBadge]);

  return (
    <div className="app">
      <header className="header">
        <span
          className="header-title"
          onClick={handleRefresh}
          style={{ cursor: "pointer" }}
          title="Click to refresh"
        >
          SmartScheduler
        </span>
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

        <div className="nav-controls">
          <button
            className="btn-ghost"
            onClick={() => calendarGridRef.current?.prev()}
          >
            ‹
          </button>
          <button
            className="btn-ghost"
            onClick={() => calendarGridRef.current?.today()}
          >
            Today
          </button>
          <button
            className="btn-ghost"
            onClick={() => calendarGridRef.current?.next()}
          >
            ›
          </button>
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div className="admin-dropdown-wrapper">
            <button
              className="btn-ghost"
              onClick={() => setShowAdmin(!showAdmin)}
              style={{ fontSize: "16px", padding: "4px 8px" }}
            >
              ⚙️
            </button>
            {showAdmin && (
              <>
                <div
                  className="context-overlay"
                  onClick={() => setShowAdmin(false)}
                />
                <div className="admin-dropdown">
                  <div className="context-title">Admin</div>
                  <button
                    onClick={async () => {
                      setShowAdmin(false);
                      const res = await fetch(`${API}/propose-refinements`, {
                        method: "POST",
                      });
                      const data = await res.json();
                      alert(data.message);
                    }}
                  >
                    📝 Propose Refinements
                  </button>
                  <button
                    onClick={async () => {
                      setShowAdmin(false);
                      const res = await fetch(`${API}/apply-refinements`, {
                        method: "POST",
                      });
                      const data = await res.json();
                      alert(data.message);
                    }}
                  >
                    ✅ Apply Refinements
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("Rebuild core instructions from scratch?"))
                        return;
                      setShowAdmin(false);
                      const res = await fetch(`${API}/reinitialize`, {
                        method: "POST",
                      });
                      const data = await res.json();
                      alert(data.message);
                    }}
                  >
                    🔄 Reinitialize Core
                  </button>
                  <div className="context-divider" />
                  <button
                    onClick={async () => {
                      setShowAdmin(false);
                      const res = await fetch(`${API}/consolidate-ideas`, {
                        method: "POST",
                      });
                      const data = await res.json();
                      alert(data.message);
                    }}
                  >
                    💡 Consolidate Ideas
                  </button>
                  <div className="context-divider" />
                  <button
                    onClick={async () => {
                      setShowAdmin(false);
                      const res = await fetch(`${API}/check-stale-scheduled`);
                      const data = await res.json();
                      alert(data.message);
                    }}
                  >
                    🕵️ Check Stale Scheduled
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="energy-bar">
            <span className="energy-label">
              Energy: {ENERGY_LABELS[(hoveredEnergy ?? energy) - 1]}
            </span>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={i <= energy ? "energy-pip filled" : "energy-pip"}
                onClick={() => setEnergy(i)}
                onMouseEnter={() => setHoveredEnergy(i)}
                onMouseLeave={() => setHoveredEnergy(null)}
                style={{ cursor: "pointer" }}
              />
            ))}
          </div>
        </div>
      </header>

      <main className="main-layout">
        <aside
          className={`task-pool ${mobileTab === "tasks" ? "mobile-active" : ""}`}
        >
          <h2>Tasks</h2>
          <TaskPool
            key={taskPoolKey}
            onRefresh={handleRefresh}
            viewedDate={viewedDate}
          />
        </aside>

        <section className="calendar-pane">
          {/* Mobile nav controls */}
          <div className="mobile-calendar-nav">
            <button
              className="btn-ghost"
              onClick={() => calendarGridRef.current?.prev()}
            >
              ‹
            </button>
            <button
              className="btn-ghost"
              onClick={() => calendarGridRef.current?.today()}
            >
              Today
            </button>
            <button
              className="btn-ghost"
              onClick={() => calendarGridRef.current?.next()}
            >
              ›
            </button>
          </div>

          <CalendarGrid
            ref={calendarGridRef}
            view={view}
            onRefresh={handleRefresh}
            onContextMenu={handleContextMenu}
            onDateClick={handleDateClick}
            onDateChange={handleDateChange}
            onBracketCreate={handleBracketCreate}
            onGhostReject={handleGhostReject}
            onGhostMove={handleGhostMove}
            onBracketProposalEdit={handleBracketProposalEdit}
            onBracketProposalReject={handleBracketProposalReject}
            onBracketProposalMove={handleBracketProposalMove}
            onBracketProposalResize={handleBracketProposalResize}
            onBasketOpen={handleBasketOpen}
          />
        </section>

        <aside
          className={`habits-panel ${mobileTab === "habits" ? "mobile-active" : ""}`}
        >
          <h2>Habits</h2>
          <HabitsList
            onToggled={refreshHabitBadge}
            onOpenBasket={handleBasketOpen}
          />
        </aside>

        <aside
          className={`quick-panel ${mobileTab === "actions" ? "mobile-active" : ""}`}
        >
          <h2>Quick Actions</h2>

          <div className="quick-panel-section">
            <div className="quick-panel-section-label">Daily Ritual</div>
            <div className="quick-panel-row">
              <button
                className="btn-ghost"
                onClick={() => setShowSuggestBrackets(true)}
              >
                📋 Suggest
              </button>
              <button
                className="btn-primary"
                onClick={() => setShowGenerateSchedule(true)}
              >
                ✨ Generate
              </button>
            </div>
          </div>

          <div className="quick-panel-section">
            <div className="quick-panel-section-label">Quick Actions</div>
            <button
              className="btn-primary"
              onClick={() => setShowWhatNow(!showWhatNow)}
            >
              What Now
            </button>
            <div className="quick-panel-row">
              <button
                className="btn-ghost"
                onClick={() => setShowCheckIn(true)}
              >
                Check In
              </button>
              <button
                className="btn-ghost"
                onClick={() => setShowAddTask(true)}
              >
                Add Task
              </button>
            </div>
          </div>

          <div className="quick-panel-section">
            <div className="quick-panel-section-label">Manage</div>
            <div className="quick-panel-row">
              <button
                className="btn-ghost"
                onClick={() => setShowBrackets(true)}
              >
                ⬡ Brackets
              </button>
              {window.innerWidth > 1024 && (
                <button
                  className="btn-ghost"
                  onClick={() => setShowHabits(true)}
                >
                  🔁 Habits {habitBadgeCount > 0 && `(${habitBadgeCount})`}
                </button>
              )}
            </div>
          </div>

          <button
            className="btn-danger quick-panel-panic"
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
          className={`mobile-tab ${mobileTab === "habits" ? "active" : ""}`}
          onClick={() => setMobileTab("habits")}
        >
          <span className="mobile-tab-icon">
            🔁
            {habitBadgeCount > 0 && (
              <span className="tab-badge">{habitBadgeCount}</span>
            )}
          </span>
          Habits
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

      {newBracket && (
        <BracketModal
          info={newBracket}
          onClose={() => {
            setNewBracket(null);
            calendarGridRef.current?.unselect();
          }}
          onSaved={() => {
            setNewBracket(null);
            calendarGridRef.current?.refresh();
          }}
        />
      )}

      {showBrackets && (
        <BracketManager
          onClose={() => setShowBrackets(false)}
          onSaved={() => calendarGridRef.current?.refresh()}
        />
      )}

      {showGenerateSchedule && (
        <GenerateScheduleModal
          onClose={() => setShowGenerateSchedule(false)}
          onGenerated={handleGenerated}
          currentEnergy={energy}
          viewedDate={viewedDate}
        />
      )}

      {showSuggestBrackets && (
        <SuggestBracketsModal
          onClose={() => setShowSuggestBrackets(false)}
          onGenerated={handleBracketProposalsGenerated}
          targetDate={viewedDate}
        />
      )}

      {editingProposal && (
        <BracketProposalModal
          proposal={editingProposal}
          onClose={() => setEditingProposal(null)}
          onAccept={handleBracketProposalAccept}
          onReject={handleBracketProposalReject}
        />
      )}

      {showHabits && (
        <>
          <div className="modal-overlay" onClick={() => setShowHabits(false)} />
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">🔁 Habits</span>
              <button
                className="modal-close"
                onClick={() => setShowHabits(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <HabitsList
                onToggled={refreshHabitBadge}
                onOpenBasket={handleBasketOpen}
              />
            </div>
          </div>
        </>
      )}

      {openBasket && (
        <BasketPanel
          bracket={openBasket}
          onClose={() => setOpenBasket(null)}
          onRefresh={handleRefresh}
        />
      )}

      {proposalCount > 0 && (
        <div className="ghost-action-bar">
          <span className="ghost-count">
            📋 {proposalCount} suggested brackets
          </span>
          <button
            className="btn-ghost"
            onClick={() => {
              bracketProposalsRef2.current = [];
              setProposalCount(0);
              calendarGridRef.current?.clearBracketProposals();
            }}
          >
            Reject All
          </button>
        </div>
      )}

      {ghostCount > 0 && (
        <div className="ghost-action-bar">
          <span className="ghost-count">✨ {ghostCount} suggested blocks</span>
          <button
            className="btn-ghost"
            onClick={() => {
              ghostBlocksRef2.current = [];
              setGhostCount(0);
              calendarGridRef.current?.clearGhostBlocks();
            }}
          >
            Discard All
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              for (const p of ghostBlocksRef2.current) {
                await fetch(`${API}/schedule-task`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    task_title: p.title,
                    duration_minutes: p.duration_minutes,
                    preferred_start: p.start_time,
                    preferred_date: p.date,
                  }),
                });
              }
              ghostBlocksRef2.current = [];
              setGhostCount(0);
              calendarGridRef.current?.clearGhostBlocks();
            }}
          >
            Commit All
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
