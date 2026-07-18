import {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

const API = `http://${window.location.hostname}:8000`;

let eventsCache = [];
let bracketsCache = [];
let ghostCache = [];

async function fetchBrackets(dateRange) {
  const res = await fetch(`${API}/brackets`);
  const data = await res.json();
  const brackets = data.brackets || [];

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const events = [];

  // Generate dates in the current view range
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayName = dayNames[d.getDay()];

    for (const bracket of brackets) {
      const matchesDay = bracket.days?.includes(dayName);
      const matchesDate = bracket.specific_date === dateStr;

      if (matchesDay || matchesDate) {
        events.push({
          id: `bracket_${bracket.id}_${dateStr}`,
          title: bracket.name,
          start: `${dateStr}T${bracket.start_time}:00`,
          end: `${dateStr}T${bracket.end_time}:00`,
          display: "background",
          backgroundColor:
            bracket.color === "green"
              ? "rgba(61, 151, 95, 0.25)"
              : "rgba(139, 46, 46, 0.25)",
          borderColor:
            bracket.color === "green"
              ? "rgba(61, 107, 79, 0.6)"
              : "rgba(139, 46, 46, 0.6)",
          extendedProps: {
            type: "bracket",
            bracket: bracket,
          },
        });
      }
    }
  }

  return events;
}

function ghostBlocksToFCEvents(placements) {
  if (!placements || !Array.isArray(placements)) return [];
  return placements.map((p, i) => ({
    id: `ghost_${i}`,
    title: `✨ ${p.title}`,
    start: `${p.date}T${p.start_time}:00`,
    end: new Date(
      new Date(`${p.date}T${p.start_time}:00`).getTime() +
        p.duration_minutes * 60000,
    ).toISOString(),
    backgroundColor: "rgba(61, 107, 79, 0.3)",
    borderColor: "#3D6B4F",
    textColor: "#1C1A17",
    editable: true,
    extendedProps: {
      type: "ghost",
      placement: p,
      ghostIndex: i,
    },
  }));
}

async function fetchEvents() {
  const res = await fetch(`${API}/whats-coming?scope=full_two_days`);
  const data = await res.json();
  const items = data.items || [];

  const taskTitles = new Set(
    items.filter((i) => i.type === "task").map((i) => i.title.toLowerCase()),
  );

  const filtered = items.filter((i) => {
    if (i.type === "calendar" && taskTitles.has(i.title.toLowerCase())) {
      return false;
    }
    return true;
  });

  eventsCache = filtered.map(itemToFCEvent);
  return eventsCache;
}

function itemToFCEvent(item) {
  if (item.type === "calendar") {
    return {
      id: item.title + item.start,
      title: item.title,
      start: item.date + "T" + to24hr(item.start),
      end: item.date + "T" + to24hr(item.end),
      backgroundColor: "#3D6B4F",
      borderColor: "#3D6B4F",
      textColor: "white",
      editable: false,
      extendedProps: { type: "calendar", calendar: item.calendar },
    };
  } else {
    let endTime = null;
    if (item.end) {
      endTime = item.date + "T" + to24hr(item.end);
    } else if (item.duration) {
      let mins = 0;
      const hrMatch = item.duration.match(/([\d.]+)\s*hr/);
      const minMatch = item.duration.match(/(\d+)\s*min/);
      if (hrMatch) mins += parseFloat(hrMatch[1]) * 60;
      if (minMatch) mins += parseInt(minMatch[1]);
      if (mins > 0) {
        const startMs = new Date(
          item.date + "T" + to24hr(item.start),
        ).getTime();
        const endMs = startMs + mins * 60000;
        const endDate = new Date(endMs);
        endTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}:00`;
      }
    }

    return {
      id: item.title + item.start,
      title: item.title,
      start: item.date + "T" + to24hr(item.start),
      end: endTime,
      backgroundColor:
        item.status === "in-progress"
          ? "#7B5EA7"
          : item.overdue
            ? "#C4832A"
            : "#5A8FA6",
      borderColor:
        item.status === "in-progress"
          ? "#7B5EA7"
          : item.overdue
            ? "#C4832A"
            : "#5A8FA6",
      textColor: "white",
      editable: true,
      extendedProps: {
        type: "task",
        energy: item.energy,
        duration: item.duration,
        title: item.title,
        status: item.status,
      },
    };
  }
}

function to24hr(timeStr) {
  if (!timeStr) return "00:00:00";
  const [time, meridiem] = timeStr.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (meridiem === "PM" && h !== 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

const CalendarGrid = forwardRef(function CalendarGrid(
  {
    view,
    onContextMenu,
    onDateClick,
    onDateChange,
    onBracketCreate,
    onGhostReject,
    onGhostMove,
  },
  ref,
) {
  const calendarRef = useRef(null);
  const [currentDateLabel, setCurrentDateLabel] = useState("");
  const [showColorKey, setShowColorKey] = useState(false);
  const ghostBlocksRef = useRef([]);

  useImperativeHandle(ref, () => ({
    refresh() {
      console.log("refresh called, clearing cache");
      eventsCache = [];
      bracketsCache = [];

      calendarRef.current?.getApi().refetchEvents();
    },
    gotoDate(date) {
      calendarRef.current?.getApi().gotoDate(date);
    },
    changeView(viewName) {
      calendarRef.current?.getApi().changeView(viewName);
    },
    getCurrentDate() {
      return calendarRef.current?.getApi().getDate();
    },
    prev() {
      calendarRef.current?.getApi().prev();
    },
    next() {
      calendarRef.current?.getApi().next();
    },
    today() {
      calendarRef.current?.getApi().today();
    },
    unselect() {
      calendarRef.current?.getApi().unselect();
    },
    setGhostBlocks(placements) {
      ghostCache = placements;
      ghostBlocksRef.current = placements;
      eventsCache = [];
      bracketsCache = [];
      const api = calendarRef.current?.getApi();
      if (!api) return;
      api.refetchEvents();
      setTimeout(() => {
        ghostBlocksToFCEvents(placements).forEach((e) => api.addEvent(e));
      }, 300);
    },
    updateGhostBlocks(placements) {
      ghostCache = placements;
      ghostBlocksRef.current = placements;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const toRemove = [];
      api.getEvents().forEach((e) => {
        if (e.id.startsWith("ghost_")) toRemove.push(e);
      });
      toRemove.forEach((e) => e.remove());
      ghostBlocksToFCEvents(placements).forEach((e) => api.addEvent(e));
    },
    clearGhostBlocks() {
      ghostCache = [];
      ghostBlocksRef.current = [];
      eventsCache = [];
      bracketsCache = [];
      calendarRef.current?.getApi().refetchEvents();
    },
  }));

  useEffect(() => {
    if (!calendarRef.current) return;
    const api = calendarRef.current.getApi();
    if (api) {
      const viewMap = {
        Day: "timeGridDay",
        "3 Day": "timeGridThreeDay",
        Week: "timeGridWeek",
        Month: "dayGridMonth",
      };
      api.changeView(viewMap[view] || "timeGridDay");
    }
  }, [view]);

  return (
    <div className="calendar-grid">
      {/* ── Date label + color key ── */}
      <div className="calendar-header-row">
        {currentDateLabel && (
          <div className="calendar-date-label">{currentDateLabel}</div>
        )}
        <div className="color-key-wrapper">
          <button
            className="color-key-btn"
            onClick={() => setShowColorKey(!showColorKey)}
          >
            ?
          </button>
          {showColorKey && (
            <>
              <div
                className="context-overlay"
                onClick={() => setShowColorKey(false)}
              />
              <div className="color-key-popover">
                <div className="color-key-title">Calendar Legend</div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#3D6B4F" }}
                  />
                  <span>Google Calendar event</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#5A8FA6" }}
                  />
                  <span>Scheduled task</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#7B5EA7" }}
                  />
                  <span>In progress (paused)</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#C4832A" }}
                  />
                  <span>Overdue task</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── FullCalendar ── */}
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        views={{
          timeGridThreeDay: {
            type: "timeGrid",
            duration: { days: 3 },
            buttonText: "3 day",
          },
        }}
        headerToolbar={false}
        height="100%"
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        slotDuration="00:15:00"
        snapDuration="00:05:00"
        nowIndicator={true}
        editable={true}
        selectable={true}
        unselectAuto={false}
        droppable={true}
        eventInteractive={true}
        datesSet={(info) => {
          const start = info.start;
          const viewType = info.view.type;
          // Notify parent of current viewed date
          if (onDateChange) {
            const viewedDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            onDateChange(viewedDate);
          }

          if (viewType === "dayGridMonth") {
            setCurrentDateLabel(
              start.toLocaleString("default", {
                month: "long",
                year: "numeric",
              }),
            );
          } else if (viewType === "timeGridDay") {
            setCurrentDateLabel(
              start.toLocaleString("default", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }),
            );
          } else if (
            viewType === "timeGridWeek" ||
            viewType === "timeGridThreeDay"
          ) {
            const end = new Date(info.end);
            end.setDate(end.getDate() - 1);
            const startStr = start.toLocaleString("default", {
              month: "long",
              day: "numeric",
            });
            const endDay = end.getDate();
            const endYear = end.getFullYear();
            setCurrentDateLabel(`${startStr} – ${endDay}, ${endYear}`);
          }
        }}
        scrollTime={(() => {
          const d = new Date(Date.now() - 5 * 60 * 1000);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
        })()}
        events={async (fetchInfo, successCallback) => {
          if (eventsCache.length > 0 || bracketsCache.length > 0) {
            successCallback([...eventsCache, ...bracketsCache]);
          }
          const [fresh, brackets] = await Promise.all([
            fetchEvents(),
            fetchBrackets(fetchInfo),
          ]);
          bracketsCache = brackets;
          successCallback([...fresh, ...brackets]);
        }}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
        }}
        eventDidMount={(info) => {
          const el = info.el;

          if (info.event.extendedProps.type === "ghost") {
            el.style.cursor = "pointer";
            el.style.overflow = "visible";

            // Hide default title
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) titleEl.style.display = "none";

            // Floating tooltip label
            const label = document.createElement("div");
            label.className = "ghost-label";
            label.innerHTML = `✨ ${info.event.title.replace("✨ ", "")}`;
            el.appendChild(label);

            // Desktop: right-click to show reject confirmation
            el.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Remove any existing popovers
              document
                .querySelectorAll(".ghost-confirm-popover")
                .forEach((p) => p.remove());

              // Create popover centered on the block
              const rect = el.getBoundingClientRect();
              const popover = document.createElement("div");
              popover.className = "ghost-confirm-popover";
              popover.innerHTML = `
    <div class="ghost-confirm-text">Remove this suggestion?</div>
    <div class="ghost-confirm-title">${info.event.title.replace("✨ ", "")}</div>
    <div class="ghost-confirm-buttons">
      <button class="ghost-confirm-cancel">Keep</button>
      <button class="ghost-confirm-reject">Remove</button>
    </div>
  `;

              // Position centered on the block
              popover.style.position = "fixed";
              popover.style.top = `${rect.top + rect.height / 2}px`;
              popover.style.left = `${rect.left + rect.width / 2}px`;
              popover.style.transform = "translate(-50%, -50%)";
              popover.style.zIndex = "1000";

              document.body.appendChild(popover);

              // Remove button
              popover
                .querySelector(".ghost-confirm-reject")
                .addEventListener("click", (e) => {
                  e.stopPropagation();
                  popover.remove();
                  if (onGhostReject)
                    onGhostReject(info.event.extendedProps.ghostIndex);
                });

              // Cancel button
              popover
                .querySelector(".ghost-confirm-cancel")
                .addEventListener("click", (e) => {
                  e.stopPropagation();
                  popover.remove();
                });

              // Click outside to cancel
              setTimeout(() => {
                document.addEventListener("click", function closePopover(e) {
                  if (!popover.contains(e.target)) {
                    popover.remove();
                    document.removeEventListener("click", closePopover);
                  }
                });
              }, 100);
            });

            // Mobile: tap shows label, long press to reject
            let longPressTimer = null;
            let warningTimer = null;

            el.addEventListener("touchstart", (e) => {
              label.style.opacity = "1";
              setTimeout(() => {
                label.style.opacity = "0";
              }, 2000);

              warningTimer = setTimeout(() => {
                el.style.backgroundColor = "rgba(139, 46, 46, 0.3)";
                el.style.borderColor = "#8B2E2E";
              }, 300);

              longPressTimer = setTimeout(() => {
                if (onGhostReject)
                  onGhostReject(info.event.extendedProps.ghostIndex);
              }, 600);
              el._warningTimer = warningTimer;
            });

            el.addEventListener("touchend", () => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
              if (el._warningTimer) {
                clearTimeout(el._warningTimer);
                el._warningTimer = null;
              }
              el.style.backgroundColor = "rgba(61, 107, 79, 0.3)";
              el.style.borderColor = "#3D6B4F";
            });

            el.addEventListener("touchmove", () => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
              if (el._warningTimer) {
                clearTimeout(el._warningTimer);
                el._warningTimer = null;
              }
              el.style.backgroundColor = "rgba(61, 107, 79, 0.3)";
              el.style.borderColor = "#3D6B4F";
            });

            return;
          }

          if (info.event.extendedProps.type === "bracket") {
            // Move title to a small tab in the top right
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) {
              titleEl.style.display = "none";
            }

            // Create tab element
            const tab = document.createElement("div");
            tab.className = "bracket-tab";
            tab.innerHTML = info.event.title;
            tab.style.background =
              info.event.extendedProps.bracket.color === "green"
                ? "rgba(61, 107, 79, 0.7)"
                : "rgba(139, 46, 46, 0.7)";
            el.appendChild(tab);
            return;
          }

          // Desktop: right-click for regular events
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, info.event);
          });

          // Mobile: long press
          let longPressTimer = null;

          el.addEventListener("touchstart", (e) => {
            longPressTimer = setTimeout(() => {
              const touch = e.touches[0];
              onContextMenu(touch.clientX, touch.clientY, info.event);
            }, 500);
          });

          el.addEventListener("touchend", () => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          });

          el.addEventListener("touchmove", () => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          });
        }}
        select={(info) => {
          if (onBracketCreate) {
            onBracketCreate({
              start: info.startStr,
              end: info.endStr,
              date: info.startStr.split("T")[0],
            });
          }
        }}
        dateClick={(info) => {
          if (info.view.type === "dayGridMonth") {
            calendarRef.current?.getApi().gotoDate(info.date);
            if (onDateClick) onDateClick(info.dateStr);
          }
        }}
        eventDrop={async (info) => {
          const { event } = info;

          // Handle ghost block drag
          if (event.extendedProps.type === "ghost") {
            const idx = event.extendedProps.ghostIndex;
            const newStart = event.start;
            const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
            const hours = String(newStart.getHours()).padStart(2, "0");
            const minutes = String(newStart.getMinutes()).padStart(2, "0");

            if (onGhostMove) onGhostMove(idx, date, `${hours}:${minutes}`);
            return;
          }
          if (event.extendedProps.type !== "task") {
            info.revert();
            return;
          }
          const title = event.extendedProps.title;
          const newStart = event.start;
          const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
          const hours = String(newStart.getHours()).padStart(2, "0");
          const minutes = String(newStart.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;
          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status !== "scheduled") {
              console.error("Schedule failed:", data);
              info.revert();
            }
          } catch (err) {
            console.error("Failed to reschedule:", err);
            info.revert();
          }
        }}
        eventResize={async (info) => {
          const { event } = info;
          if (event.extendedProps.type !== "task") {
            info.revert();
            return;
          }
          const title = event.extendedProps.title;
          const newStart = event.start;
          const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
          const hours = String(newStart.getHours()).padStart(2, "0");
          const minutes = String(newStart.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;
          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status !== "scheduled") {
              console.error("Resize failed:", data);
              info.revert();
            }
          } catch (err) {
            console.error("Failed to resize:", err);
            info.revert();
          }
        }}
        eventReceive={async (info) => {
          const { event } = info;
          const title = event.extendedProps.title;
          const start = event.start;
          const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
          const hours = String(start.getHours()).padStart(2, "0");
          const minutes = String(start.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;

          event.remove();

          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status === "scheduled") {
              setTimeout(() => {
                calendarRef.current?.getApi().refetchEvents();
              }, 500);
            } else {
              console.error("Schedule failed:", data);
            }
          } catch (err) {
            console.error("Failed to schedule:", err);
          }
        }}
      />
    </div>
  );
});

export default CalendarGrid;
