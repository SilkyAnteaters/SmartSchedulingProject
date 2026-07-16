from datetime import datetime, timedelta
from calendar_auth import get_personal_service
from calendar_reader import get_todays_events, get_free_slots
import frontmatter
import math
from pathlib import Path
from config import TASKS, INBOX


def round_to_5_minutes(dt):
    minutes = dt.minute
    rounded = math.ceil(minutes / 5) * 5
    if rounded == 60:
        dt = dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    else:
        dt = dt.replace(minute=rounded, second=0, microsecond=0)
    return dt


def find_best_slot(duration_minutes: int) -> dict:
    """
    Find the best available slot for a task of given duration.
    Considers both Google Calendar events AND scheduled vault tasks.
    """
    from config import TASKS, INBOX
    import frontmatter
    import re

    events = get_todays_events()
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    # Build list of busy blocks from Google Calendar
    busy = []
    for e in events:
        if e["all_day"]:
            continue
        try:
            from calendar_reader import parse_event_time

            start = parse_event_time(e["start"]).replace(tzinfo=None)
            end = parse_event_time(e["end"]).replace(tzinfo=None)
            busy.append((start, end))
        except Exception:
            continue

    # Also add scheduled vault tasks
    for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
        try:
            post = frontmatter.load(filepath)
            status = post.metadata.get("status", "")
            scheduled_time = post.metadata.get("scheduled_time")
            scheduled_date = post.metadata.get("scheduled_date", today_str)
            duration = post.metadata.get("scheduled_duration") or post.metadata.get(
                "duration_estimated", ""
            )

            if (
                status != "scheduled"
                or not scheduled_time
                or scheduled_date != today_str
            ):
                continue

            try:
                try:
                    start = datetime.strptime(
                        f"{scheduled_date} {scheduled_time}", "%Y-%m-%d %I:%M %p"
                    )
                except ValueError:
                    start = datetime.strptime(
                        f"{scheduled_date} {scheduled_time}", "%Y-%m-%d %H:%M"
                    )
            except Exception:
                continue

            # Parse duration
            total_minutes = 0
            hr_match = re.search(r"([\d.]+)\s*hr", duration)
            min_match = re.search(r"(\d+)\s*min", duration)
            if hr_match:
                total_minutes += int(float(hr_match.group(1)) * 60)
            if min_match:
                total_minutes += int(min_match.group(1))
            if total_minutes == 0:
                total_minutes = 60

            end = start + timedelta(minutes=total_minutes)
            busy.append((start, end))
        except Exception:
            continue

    # Sort and merge overlapping busy blocks
    busy.sort(key=lambda x: x[0])
    merged = []
    for start, end in busy:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # Find first free slot after now
    day_end = datetime.strptime(f"{today_str} 22:00", "%Y-%m-%d %H:%M")
    current = now

    for block_start, block_end in merged:
        if block_start > current:
            gap_minutes = (block_start - current).total_seconds() / 60
            if gap_minutes >= duration_minutes:
                rounded_start = round_to_5_minutes(current)
                end = rounded_start + timedelta(minutes=duration_minutes)
                return {
                    "start": rounded_start.strftime("%I:%M %p"),
                    "end": end.strftime("%I:%M %p"),
                    "start_iso": rounded_start.isoformat(),
                    "end_iso": end.isoformat(),
                }
        current = max(current, block_end)

    # Check remaining time after all blocks
    remaining = (day_end - current).total_seconds() / 60
    if remaining >= duration_minutes:
        rounded_start = round_to_5_minutes(current)
        end = rounded_start + timedelta(minutes=duration_minutes)
        return {
            "start": rounded_start.strftime("%I:%M %p"),
            "end": end.strftime("%I:%M %p"),
            "start_iso": rounded_start.isoformat(),
            "end_iso": end.isoformat(),
        }

    return None


def create_calendar_event(
    title: str, start_iso: str, end_iso: str, description: str = ""
) -> str:
    """
    Create an event on the personal Google Calendar.
    Returns the event ID.
    """
    service = get_personal_service()

    event = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start_iso, "timeZone": "America/New_York"},
        "end": {"dateTime": end_iso, "timeZone": "America/New_York"},
    }

    created = service.events().insert(calendarId="primary", body=event).execute()

    return created["id"]


def update_task_with_event(
    task_title: str,
    event_id: str,
    scheduled_time: str,
    scheduled_date: str,
    duration_minutes: int,
):
    """
    Update the task frontmatter with the calendar event ID, scheduled time, and scheduled date.
    Tries exact match first, then fuzzy.
    """
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))

    # Pass 1: exact match
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() == title.lower():
            post.metadata["calendar_event_id"] = event_id
            post.metadata["scheduled_time"] = scheduled_time
            post.metadata["scheduled_date"] = scheduled_date
            post.metadata["status"] = "scheduled"
            post.metadata["scheduled_duration"] = f"{duration_minutes}min"
            if duration_minutes >= 60:
                hours = duration_minutes // 60
                mins = duration_minutes % 60
                post.metadata["duration_estimated"] = (
                    f"{hours}hr {mins}min".strip() if mins else f"{hours}hr"
                )
            else:
                post.metadata["duration_estimated"] = f"{duration_minutes}min"
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            print(f"Updated task: {title}")
            return True

    # Pass 2: fuzzy match
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() in title.lower() or title.lower() in task_title.lower():
            post.metadata["calendar_event_id"] = event_id
            post.metadata["scheduled_time"] = scheduled_time
            post.metadata["scheduled_date"] = scheduled_date
            post.metadata["status"] = "scheduled"
            post.metadata["scheduled_duration"] = f"{duration_minutes}min"
            if duration_minutes >= 60:
                hours = duration_minutes // 60
                mins = duration_minutes % 60
                post.metadata["duration_estimated"] = (
                    f"{hours}hr {mins}min".strip() if mins else f"{hours}hr"
                )
            else:
                post.metadata["duration_estimated"] = f"{duration_minutes}min"
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            print(f"Updated task: {title}")
            return True

    return False


def delete_calendar_event(event_id: str) -> bool:
    """
    Delete a Google Calendar event by ID.
    Called when a task is deferred or retried.
    """
    try:
        service = get_personal_service()
        service.events().delete(calendarId="primary", eventId=event_id).execute()
        print(f"Deleted calendar event: {event_id}")
        return True
    except Exception as e:
        print(f"Could not delete event {event_id}: {e}")
        return False


def schedule_task(
    task_title: str,
    duration_minutes: int,
    preferred_start: str = None,
    preferred_date: str = None,
) -> dict:
    """
    Main function — find a slot, create calendar event, update task file.
    preferred_start: time string e.g. "9:00 AM"
    preferred_date: date string e.g. "2026-04-08", defaults to today
    """
    print("DEBUG: schedule_task called with preferred_start/preferred_date")
    now = datetime.now()
    date_str = preferred_date if preferred_date else now.strftime("%Y-%m-%d")

    # Use preferred start time if provided
    if preferred_start:
        try:
            try:
                start = datetime.strptime(
                    f"{date_str} {preferred_start}", "%Y-%m-%d %I:%M %p"
                )
            except ValueError:
                start = datetime.strptime(
                    f"{date_str} {preferred_start}", "%Y-%m-%d %H:%M"
                )
            end = start + timedelta(minutes=duration_minutes)
            slot = {
                "start": start.strftime("%I:%M %p"),
                "end": end.strftime("%I:%M %p"),
                "start_iso": start.isoformat(),
                "end_iso": end.isoformat(),
            }
        except ValueError:
            return {
                "status": "error",
                "message": f"Could not parse time: {preferred_start}",
            }
    else:
        # Auto-find best slot (today only)
        slot = find_best_slot(duration_minutes)

        if not slot:
            return {
                "status": "no_slot",
                "message": "No available slot found today for this task.",
            }

    # Delete existing calendar event if one exists
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    for filepath in all_files:
        post = frontmatter.load(filepath)
        if post.metadata.get("title", "").lower() == task_title.lower():
            existing_event_id = post.metadata.get("calendar_event_id")
            if existing_event_id:
                delete_calendar_event(existing_event_id)
            break

    # Create the calendar event
    event_id = create_calendar_event(
        title=task_title,
        start_iso=slot["start_iso"],
        end_iso=slot["end_iso"],
        description="Scheduled by SmartScheduler",
    )

    # Update the task file
    update_task_with_event(
        task_title, event_id, slot["start"], date_str, duration_minutes
    )

    return {
        "status": "scheduled",
        "title": task_title,
        "start": slot["start"],
        "end": slot["end"],
        "date": date_str,
        "event_id": event_id,
        "message": f"Scheduled '{task_title}' for {date_str} from {slot['start']} to {slot['end']}",
    }


if __name__ == "__main__":
    print("=== Test Schedule Task ===\n")

    result = schedule_task(task_title="Texas data quiz", duration_minutes=45)

    print(result)
