from datetime import datetime, timedelta
from anthropic import Anthropic
from config import TASKS, INBOX, VAULT_PATH
import frontmatter
import re
import json

client = Anthropic()


def get_tasks_for_scheduling(scope_days: int, target_date: str = None) -> list:
    """Get unscheduled and in-progress tasks relevant for scheduling."""
    tasks = []
    today = datetime.now().strftime("%Y-%m-%d")

    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))

    for filepath in all_files:
        try:
            post = frontmatter.load(filepath)
            status = post.metadata.get("status", "")
            title = post.metadata.get("title", "")

            if not title or status == "done":
                continue

            # Include unscheduled, in-progress, and planned tasks
            if status not in ["unscheduled", "in-progress"]:
                continue

            planned_date = str(post.metadata.get("planned_date", "") or "")
            deadline = str(post.metadata.get("deadline", "") or "")

            # Filter by relevance to scope
            if planned_date and planned_date != "None":
                # Only include if planned within scope
                if planned_date > (
                    datetime.now() + timedelta(days=scope_days)
                ).strftime("%Y-%m-%d"):
                    continue

            tasks.append(
                {
                    "title": title,
                    "status": status,
                    "energy": post.metadata.get("energy_required", "medium"),
                    "duration": post.metadata.get("duration_estimated", "1hr"),
                    "priority": post.metadata.get("priority", "medium"),
                    "deadline": deadline if deadline != "None" else None,
                    "planned_date": planned_date if planned_date != "None" else None,
                    "tags": post.metadata.get("tags", []),
                    "folder": str(filepath.parent.name),
                    "progress": post.metadata.get("progress", "0%"),
                    "remaining": post.metadata.get("remaining", ""),
                }
            )
        except Exception as e:
            print(f"Error loading {filepath}: {e}")
            continue

    return tasks


def get_busy_blocks(date_str: str) -> list:
    """Get all busy time blocks for a date from Google Calendar and scheduled tasks."""
    from calendar_reader import get_all_events, parse_event_time

    busy = []

    # Google Calendar events
    target_date = datetime.strptime(date_str, "%Y-%m-%d")
    days_ahead = max((target_date - datetime.now()).days + 2, 1)
    events = get_all_events(days_ahead=days_ahead)
    for e in events:
        if e.get("all_day"):
            continue
        try:
            start = parse_event_time(e["start"]).replace(tzinfo=None)
            end = parse_event_time(e["end"]).replace(tzinfo=None)
            if start.strftime("%Y-%m-%d") == date_str:
                busy.append(
                    {
                        "title": e["title"],
                        "start": start.strftime("%I:%M %p"),
                        "end": end.strftime("%I:%M %p"),
                        "type": "calendar",
                    }
                )
        except Exception:
            continue

    # Scheduled vault tasks
    today_str = datetime.now().strftime("%Y-%m-%d")
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    for filepath in all_files:
        try:
            post = frontmatter.load(filepath)
            if post.metadata.get("status") != "scheduled":
                continue
            scheduled_date = str(post.metadata.get("scheduled_date", today_str))
            if scheduled_date != date_str:
                continue
            scheduled_time = post.metadata.get("scheduled_time")
            if not scheduled_time:
                continue

            duration_str = str(
                post.metadata.get("scheduled_duration")
                or post.metadata.get("duration_estimated", "60min")
            )
            total_minutes = 0
            hr_match = re.search(r"([\d.]+)\s*hr", duration_str)
            min_match = re.search(r"(\d+)\s*min", duration_str)
            if hr_match:
                total_minutes += int(float(hr_match.group(1)) * 60)
            if min_match:
                total_minutes += int(min_match.group(1))
            if total_minutes == 0:
                total_minutes = 60

            try:
                start_dt = datetime.strptime(
                    f"{date_str} {scheduled_time}", "%Y-%m-%d %I:%M %p"
                )
            except ValueError:
                start_dt = datetime.strptime(
                    f"{date_str} {scheduled_time}", "%Y-%m-%d %H:%M"
                )

            end_dt = start_dt + timedelta(minutes=total_minutes)
            busy.append(
                {
                    "title": post.metadata.get("title", ""),
                    "start": start_dt.strftime("%I:%M %p"),
                    "end": end_dt.strftime("%I:%M %p"),
                    "type": "task",
                }
            )
        except Exception:
            continue

    return sorted(busy, key=lambda x: x["start"])


def get_brackets_for_date(date_str: str) -> list:
    """Get brackets that apply to a specific date."""
    from bracket_manager import get_brackets_for_date as _get

    return _get(date_str)


def generate_schedule(
    scope: str = "today", energy: int = 3, context: str = "", target_date: str = None
) -> dict:
    """
    Generate a proposed schedule using the LLM.

    scope: "today", "rest_of_week", "next_7_days"
    energy: 1-5 pip level
    context: optional free text from user
    target_date: override date (defaults to today)
    """
    now = datetime.now()
    today_str = target_date or now.strftime("%Y-%m-%d")

    # Determine date range
    if scope == "today":
        dates = [today_str]
    elif scope == "rest_of_week":
        dates = []
        current = now
        while current.weekday() != 6:  # until Sunday
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        dates.append(current.strftime("%Y-%m-%d"))  # include Sunday
        dates = [d for d in dates if d >= today_str]
    else:  # next_7_days
        dates = [(now + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]

    # Determine scope_days for task filtering
    scope_days = len(dates) + 1

    # Get tasks
    tasks = get_tasks_for_scheduling(scope_days)

    if not tasks:
        return {
            "status": "no_tasks",
            "message": "No tasks to schedule.",
            "placements": [],
        }

    # Build per-day context
    day_contexts = []
    for date_str in dates:
        day_name = datetime.strptime(date_str, "%Y-%m-%d").strftime("%A")
        busy = get_busy_blocks(date_str)
        brackets = get_brackets_for_date(date_str)
        brackets = [b for b in brackets if b.get("mode", "rigid") != "basket"]

        green_brackets = [b for b in brackets if b["color"] == "green"]
        red_brackets = [b for b in brackets if b["color"] == "red"]

        day_ctx = f"\n### {day_name} {date_str}\n"

        if busy:
            day_ctx += "Busy blocks:\n"
            for b in busy:
                day_ctx += f"  - {b['start']} - {b['end']}: {b['title']}\n"
        else:
            day_ctx += "No existing commitments.\n"

        if green_brackets:
            day_ctx += "Schedule-here brackets:\n"
            for b in green_brackets:
                day_ctx += f"  - {b['start_time']} - {b['end_time']}: {b['name']}"
                if b.get("description"):
                    day_ctx += f" ({b['description']})"
                day_ctx += "\n"

        if red_brackets:
            day_ctx += "Do-not-schedule brackets:\n"
            for b in red_brackets:
                day_ctx += f"  - {b['start_time']} - {b['end_time']}: {b['name']}\n"

        day_contexts.append(day_ctx)

    # Build task list
    task_list = ""
    for t in tasks:
        task_list += f"- {t['title']} | {t['duration']} | energy:{t['energy']} | priority:{t['priority']}"
        if t["deadline"]:
            task_list += f" | deadline:{t['deadline']}"
        if t["planned_date"]:
            task_list += f" | planned:{t['planned_date']}"
        if t["status"] == "in-progress":
            task_list += (
                f" | IN PROGRESS ({t['progress']} done, {t['remaining']} remaining)"
            )
        task_list += "\n"

    # Energy level description
    energy_desc = {
        1: "very low - cantrip tasks only",
        2: "low - light tasks preferred",
        3: "medium - normal mix",
        4: "high - can handle demanding tasks",
        5: "peak - ready for deep work",
    }.get(energy, "medium")

    prompt = f"""You are a scheduling assistant for a personal productivity system called SmartScheduler.

Generate a schedule ONLY for these specific dates: {', '.join(dates)}.

CRITICAL: You must ONLY place tasks on these dates: {', '.join(dates)}
Do NOT place tasks on any other dates. If a task cannot fit on these dates, skip it.


Generate a schedule for the following days. Return ONLY a JSON array of placements.

Current time is {now.strftime("%I:%M %p")}. 
Do not schedule tasks before this time today ({today_str}).
All placements for today must start AFTER {now.strftime("%I:%M %p")}.

Current energy level: {energy_desc}
{f'User context: {context}' if context else ''}

Tasks to schedule:
{task_list}

Calendar for each day:
{''.join(day_contexts)}

Rules:
1. Never schedule tasks during busy blocks or red (do-not-schedule) brackets
2. Prefer placing tasks in matching green (schedule-here) brackets
3. Match task energy to bracket description when possible (e.g. "deep work" bracket → high/deep energy tasks)
4. Tasks with planned_date should be scheduled on that date if possible
5. Respect deadlines — tasks due sooner get priority
6. In-progress tasks should be scheduled for their remaining duration not full duration
7. Leave at least 5 minutes buffer between ALL tasks (both existing and ghost blocks)
8. When placing multiple tasks back to back, add 5 minutes between each one
9. STRICT: Only schedule tasks between 08:00 and 22:00. Never schedule anything before 08:00 or after 22:00. This is a hard constraint.
10. Tasks placed inside a bracket must START and END within that bracket's time range
11. If a task is longer than the available bracket time, place it at the bracket start anyway — the user will use Stopping Now when the bracket ends
12. Working hours are 8am-10pm unless brackets suggest otherwise
13. Current user energy is {energy_desc} — adjust task difficulty accordingly
14. Some tasks are split into linked parts (titles ending in "(Part 1)", "(Part 2)", etc.) — if both a task and its earlier part(s) are being scheduled today, always place the earlier part at an earlier time than the later part, with at least 15 minutes between them for a break
15. If a task's deadline includes a specific time (e.g. deadline:2026-07-21T15:00), it MUST be placed so it fully finishes (start_time + duration) before that time on that date — this is a hard constraint, stricter than the general "deadlines get priority" rule

Return a JSON array like this:
[
  {{
    "title": "exact task title from the list above",
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "duration_minutes": 60,
    "bracket": "bracket name if placed in a bracket, or null",
    "reason": "one sentence why this task was placed here"
  }}
]

Return ONLY the JSON array, no other text."""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code blocks if present
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"^```\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        placements = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print(f"Raw response: {raw}")
        return {
            "status": "error",
            "message": "LLM returned invalid JSON",
            "placements": [],
        }

    # Enforce 5 minute buffer between placements on same day

    placements_sorted = sorted(placements, key=lambda x: (x["date"], x["start_time"]))
    adjusted = []

    for placement in placements_sorted:
        if not adjusted:
            adjusted.append(placement)
            continue

        prev = adjusted[-1]
        if prev["date"] != placement["date"]:
            adjusted.append(placement)
            continue

        prev_end = datetime.strptime(
            f"{prev['date']} {prev['start_time']}", "%Y-%m-%d %H:%M"
        ) + timedelta(minutes=prev["duration_minutes"])
        curr_start = datetime.strptime(
            f"{placement['date']} {placement['start_time']}", "%Y-%m-%d %H:%M"
        )

        if (curr_start - prev_end).total_seconds() < 300:
            new_start = prev_end + timedelta(minutes=5)
            placement["start_time"] = new_start.strftime("%H:%M")

        adjusted.append(placement)

    placements = adjusted

    # Filter out placements outside working hours (8am - 10pm)
    valid_placements = []
    for p in placements:
        try:
            start_hour = int(p["start_time"].split(":")[0])
            end_minutes = (
                start_hour * 60
                + int(p["start_time"].split(":")[1])
                + p["duration_minutes"]
            )
            end_hour = end_minutes // 60
            if start_hour >= 8 and end_hour <= 22:
                valid_placements.append(p)
            else:
                print(
                    f"Filtered out-of-hours placement: {p['title']} at {p['start_time']}"
                )
        except Exception:
            valid_placements.append(p)

    placements = valid_placements

    # Filter out placements outside the requested date scope
    scoped_placements = []
    dropped_scope = []
    for p in placements:
        if p.get("date") in dates:
            scoped_placements.append(p)
        else:
            print(
                f"Filtered out-of-scope placement: {p.get('title')} on {p.get('date')} "
                f"(scope was {dates})"
            )
            dropped_scope.append(p)

    placements = scoped_placements

    # Build title -> deadline lookup for the strict time-deadline filter
    deadline_lookup = {t["title"]: t["deadline"] for t in tasks if t.get("deadline")}

    # Filter out placements that violate a hard time-deadline
    deadline_ok_placements = []
    dropped_deadline = []
    for p in placements:
        deadline = deadline_lookup.get(p.get("title"))
        if deadline and "T" in str(deadline):
            deadline_date, deadline_time = deadline.split("T")
            if p.get("date") == deadline_date:
                try:
                    start_h, start_m = map(int, p["start_time"].split(":"))
                    end_minutes = start_h * 60 + start_m + p["duration_minutes"]
                    deadline_h, deadline_m = map(int, deadline_time.split(":"))
                    deadline_minutes = deadline_h * 60 + deadline_m
                    if end_minutes > deadline_minutes:
                        print(
                            f"Filtered placement violating time deadline: {p.get('title')} "
                            f"would end after {deadline_time} deadline"
                        )
                        dropped_deadline.append(p)
                        continue
                except Exception:
                    pass
        deadline_ok_placements.append(p)

    placements = deadline_ok_placements

    return {
        "status": "generated",
        "scope": scope,
        "dates": dates,
        "placements": placements,
        "count": len(placements),
        "dropped": dropped_scope,
        "dropped_count": len(dropped_scope),
        "dropped_deadline": dropped_deadline,
        "dropped_deadline_count": len(dropped_deadline),
    }
