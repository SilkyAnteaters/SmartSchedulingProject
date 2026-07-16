import { useRef, useImperativeHandle, forwardRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

const API = `http://${window.location.hostname}:8000`;

let eventsCache = [];

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
      backgroundColor: item.overdue ? "#C4832A" : "#5A8FA6",
      borderColor: item.overdue ? "#C4832A" : "#5A8FA6",
      textColor: "white",
      editable: true,
      extendedProps: {
        type: "task",
        energy: item.energy,
        duration: item.duration,
        title: item.title,
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
  { view, onContextMenu },
  ref,
) {
  const calendarRef = useRef(null);

  useImperativeHandle(ref, () => ({
    refresh() {
      calendarRef.current?.getApi().refetchEvents();
    },
  }));

  const viewMap = {
    Day: "timeGridDay",
    "3 Day": "timeGridThreeDay",
    Week: "timeGridWeek",
    Month: "dayGridMonth",
  };

  const fcView = viewMap[view] || "timeGridDay";

  return (
    <div className="calendar-grid">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView={fcView}
        key={fcView}
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
        slotDuration="00:05:00"
        snapDuration="00:05:00"
        nowIndicator={true}
        editable={true}
        selectable={true}
        droppable={true}
        scrollTime={(() => {
          const d = new Date(Date.now() - 5 * 60 * 1000);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
        })()}
        events={async (fetchInfo, successCallback) => {
          if (eventsCache.length > 0) {
            successCallback(eventsCache);
          }
          const fresh = await fetchEvents();
          successCallback(fresh);
        }}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
        }}
        eventDidMount={(info) => {
          const el = info.el;

          // Desktop: right-click
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
          console.log("selected:", info.startStr, "→", info.endStr);
        }}
        eventDrop={async (info) => {
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
          console.log("eventReceive fired:", info.event.title);
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
            console.log("schedule result:", data);
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
