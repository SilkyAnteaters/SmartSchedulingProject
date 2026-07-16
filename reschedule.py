import frontmatter
from pathlib import Path
from datetime import datetime
from vault_reader import read_tasks
from llm import ask
from config import INBOX, TASKS, SCHEDULED, CHECKINS
from checkin import create_checkin


def update_task_file(filepath: Path, updates: dict) -> None:
    """
    Update specific frontmatter fields in an existing task file.
    """
    post = frontmatter.load(filepath)

    for key, value in updates.items():
        post.metadata[key] = value

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))

    print(f"Updated: {filepath.name}")


def find_task_file(task_title: str) -> Path | None:
    """
    Find a task file by title. Tries exact match first, then fuzzy.
    Returns the filepath if found, None otherwise.
    """
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))

    # Pass 1: exact match (case-insensitive)
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() == title.lower():
            return filepath

    # Pass 2: fuzzy match (substring either direction)
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() in title.lower() or title.lower() in task_title.lower():
            return filepath

    return None


def panic_button(reason: str = "") -> str:
    """
    Panic button - nothing gets done, redistribute without judgment.
    Marks all scheduled tasks as unscheduled and resets their schedules.
    """
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    reset_count = 0

    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))

    for filepath in all_files:
        post = frontmatter.load(filepath)

        if post.metadata.get("status") == "scheduled":
            # make sure to only reset tasks scheduled today
            scheduled_date = post.metadata.get("scheduled_date", today_str)
            if scheduled_date != today_str:
                continue

            # Delete calendar event before clearing ID
            event_id = post.metadata.get("calendar_event_id")
            if event_id:
                from calendar_writer import delete_calendar_event

                delete_calendar_event(event_id)

            updates = {
                "status": "unscheduled",
                "scheduled_time": None,
                "scheduled_date": None,
                "calendar_event_id": None,
                "times_deferred": post.metadata.get("times_deferred", 0) + 1,
            }
            update_task_file(filepath, updates)
            reset_count += 1

    # Log a checkin
    create_checkin(
        doing="panic reset",
        energy="unknown",
        mood="resetting",
        notes=reason if reason else "day reset, no judgment",
    )

    message = f"Reset {reset_count} tasks. Fresh start, no judgment."
    print(message)
    return message


def stopping_now(
    task_title: str,
    progress: str,
    remaining: str,
    continuation_note: str = "",
    energy: str = "unknown",
) -> str:
    """
    Stopping now but need more time.
    Saves progress state and logs a checkin.
    """
    filepath = find_task_file(task_title)

    if filepath:
        updates = {
            "status": "in-progress",
            "progress": progress,
            "remaining": remaining,
            "continuation_note": continuation_note,
        }
        update_task_file(filepath, updates)
    else:
        print(f"Could not find task matching: {task_title}")
        print("Logging checkin anyway.")

    # Log checkin regardless
    create_checkin(
        doing=f"stopping on: {task_title}",
        energy=energy,
        notes=f"progress: {progress}, remaining: {remaining}. {continuation_note}",
    )

    message = f"Progress saved on '{task_title}'. {remaining} remaining. Continuation note logged."
    print(message)
    return message


def parse_retry_time(text: str) -> str:
    """
    Parse a natural language retry time string into 'YYYY-MM-DD HH:MM' format.

    Handles:
      - "9:00 PM today"
      - "8:00 AM tomorrow"
      - "7:00 PM Monday" / "next Monday 7 PM" / "upcoming Monday at 7:00 PM"
      - "2026-04-08 10:00" (passthrough)
      - "2026-04-08 10:00 AM" (passthrough with 12hr)

    Returns the parsed string, or the original string if nothing matched
    (so it still gets stored rather than silently failing).
    """
    import re
    from datetime import datetime, timedelta

    now = datetime.now()
    text = text.strip().lower()

    # Check for raw datetime passthrough first
    for fmt in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue

    # --- Extract time component ---
    # Matches: 9:00 PM, 9 PM, 9:30am, 14:00
    time_pattern = r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?"
    time_match = re.search(time_pattern, text)

    if not time_match:
        return text  # can't parse, pass through as-is

    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0
    meridiem = time_match.group(3)

    if meridiem == "pm" and hour != 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0

    # --- Extract date component ---
    day_names = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]

    # default to today, override if date keyword found
    target_date = now

    if "tomorrow" in text:
        target_date = now + timedelta(days=1)

    elif any(day in text for day in day_names):
        # Find which day was mentioned
        for i, day in enumerate(day_names):
            if day in text:
                target_weekday = i  # Monday=0, Sunday=6
                break

        days_ahead = (target_weekday - now.weekday()) % 7
        if days_ahead == 0:
            # Same weekday — go to next week since "Monday" means upcoming
            days_ahead = 7
        target_date = now + timedelta(days=days_ahead)
    # 'today' and no keyword both all through to target_date = now

    # Combine date + time
    result = target_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return result.strftime("%Y-%m-%d %H:%M")


def retry_later(
    task_title: str, retry_time: str, retry_note: str = "", energy: str = "unknown"
) -> str:
    """
    Didn't start but want to try again at a specific time.
    Sets a retry window without full panic reset.
    """
    retry_time = parse_retry_time(retry_time)
    filepath = find_task_file(task_title)

    if filepath:
        post = frontmatter.load(filepath)

        # Delete existing calendar event if one exists
        event_id = post.metadata.get("calendar_event_id")
        if event_id:
            from calendar_writer import delete_calendar_event

            delete_calendar_event(event_id)

        updates = {
            "retry_at": retry_time,
            "retry_note": retry_note if retry_note else "retrying later",
            "times_deferred": post.metadata.get("times_deferred", 0) + 1,
            "status": "unscheduled",
            "scheduled_time": None,
            "scheduled_date": None,
            "calendar_event_id": None,
        }
        update_task_file(filepath, updates)
    else:
        print(f"Could not find task matching: {task_title}")
        print("Logging checkin anyway.")

    # Log checkin regardless
    create_checkin(
        doing=f"retry scheduled: {task_title}",
        energy=energy,
        notes=f"retry at {retry_time}. {retry_note}",
    )

    message = f"'{task_title}' set to retry at {retry_time}."
    print(message)
    return message


def plan_task(task_title: str, planned_date: str) -> str:
    """
    assign a planned date to a task without scheduling a specific time
    """
    filepath = find_task_file(task_title)
    planned_date = planned_date.strip()

    if not filepath:
        return f"Could not find task: {task_title}"

    updates = {"planned_date": planned_date}
    update_task_file(filepath, updates)

    message = f"'{task_title}' planned for {planned_date}."
    print(message)
    return message


def extend_task(
    task_title: str, additional_minutes: int, energy: str = "unknown"
) -> str:
    """
    Extend a task that's currently in progress.
    Deletes the existing calendar event and creates a new one
    starting at the original scheduled time with extended duration.
    """
    from calendar_writer import delete_calendar_event, create_calendar_event
    from datetime import datetime, timedelta

    filepath = find_task_file(task_title)

    if not filepath:
        print(f"Could not find task matching: {task_title}")
        return f"Could not find task: {task_title}"

    post = frontmatter.load(filepath)

    # for a task to be extended it needs to be scheduled
    status = post.metadata.get("status", "")
    if status != "scheduled":
        return f"'{task_title}' is not currently scheduled. Schedule it first before extending."

    scheduled_time = post.metadata.get("scheduled_time")
    scheduled_date = post.metadata.get("scheduled_date")
    duration_estimated = post.metadata.get("duration_estimated", "")
    event_id = post.metadata.get("calendar_event_id")

    if not scheduled_time:
        return f"No scheduled time found for '{task_title}'. Cannot extend."

    # Use scheduled_date if available, otherwise today
    date_str = scheduled_date if scheduled_date else datetime.now().strftime("%Y-%m-%d")

    # Parse original start time
    try:
        try:
            original_start = datetime.strptime(
                f"{date_str} {scheduled_time}", "%Y-%m-%d %I:%M %p"
            )
        except ValueError:
            original_start = datetime.strptime(
                f"{date_str} {scheduled_time}", "%Y-%m-%d %H:%M"
            )
    except Exception:
        return f"Could not parse scheduled time '{scheduled_time}' for '{task_title}'."

    # Parse existing duration to calculate new end time
    # duration_estimated format: "1hr", "45min", "1.5hr", "2hr"
    existing_minutes = 0
    if duration_estimated:
        import re

        hr_match = re.search(r"([\d.]+)\s*hr", duration_estimated)
        min_match = re.search(r"(\d+)\s*min", duration_estimated)
        if hr_match:
            existing_minutes += int(float(hr_match.group(1)) * 60)
        if min_match:
            existing_minutes += int(min_match.group(1))

    total_minutes = existing_minutes + additional_minutes
    new_end = original_start + timedelta(minutes=total_minutes)

    # Delete old calendar event
    if event_id:
        delete_calendar_event(event_id)

    # Create new calendar event from original start to new end
    new_event_id = create_calendar_event(
        title=task_title,
        start_iso=original_start.isoformat(),
        end_iso=new_end.isoformat(),
        description="Extended by SmartScheduler",
    )

    # Update task file
    new_duration_str = (
        f"{total_minutes}min"
        if total_minutes < 60
        else f"{total_minutes // 60}hr {total_minutes % 60}min".strip()
    )
    updates = {
        "calendar_event_id": new_event_id,
        "duration_estimated": new_duration_str,
        "status": "scheduled",
    }
    update_task_file(filepath, updates)

    # Log checkin
    create_checkin(
        doing=f"extending: {task_title}",
        energy=energy,
        notes=f"added {additional_minutes} min, new total {new_duration_str}",
    )

    message = f"'{task_title}' extended by {additional_minutes} min. New end: {new_end.strftime('%I:%M %p')}."
    print(message)
    return message


def complete_task(
    task_title: str, actual_duration: str = "", energy: str = "unknown", notes: str = ""
) -> str:
    """
    Mark a task as complete, delete calendar event, log checkin.
    Moves to done/ folder, LLM decides keep/delete, spawns next instance if recurring.
    """
    filepath = find_task_file(task_title)

    if filepath:
        post = frontmatter.load(filepath)

        # Delete calendar event if exists
        event_id = post.metadata.get("calendar_event_id")
        if event_id:
            from calendar_writer import delete_calendar_event

            delete_calendar_event(event_id)

        # Update completion fields
        post.metadata["status"] = "done"
        post.metadata["calendar_event_id"] = None
        post.metadata["scheduled_time"] = None
        post.metadata["progress"] = "100%"
        post.metadata["remaining"] = "0"
        post.metadata["completed"] = datetime.now().strftime("%Y-%m-%d")
        post.metadata["duration_actual"] = actual_duration

        # Handle recurrence BEFORE moving file
        recurrence = post.metadata.get("recurrence")
        if recurrence:
            _spawn_next_recurrence(post, filepath)

        # Move file to done/ folder
        from config import DONE

        DONE.mkdir(parents=True, exist_ok=True)
        done_path = DONE / filepath.name

        # Handle filename collision in done/
        counter = 2
        while done_path.exists():
            done_path = DONE / f"{filepath.stem}_{counter}.md"
            counter += 1

        # Write updated frontmatter to done/ location
        with open(done_path, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))

        # Delete original file
        filepath.unlink()
        print(f"Moved to done/: {done_path.name}")

        # LLM decides keep or delete
        _llm_keep_or_delete(post, done_path)

    else:
        print(f"Could not find task matching: {task_title}")

    # Log checkin regardless
    create_checkin(
        doing=f"completed: {task_title}",
        energy=energy,
        notes=f"actual duration: {actual_duration}. {notes}",
    )

    message = f"'{task_title}' marked as done. Well done."
    print(message)
    return message


def _llm_keep_or_delete(post: object, done_path) -> None:
    """
    Ask LLM whether to keep or delete a completed task file.
    Deletes from done/ if disposable.
    """
    from llm import ask

    title = post.metadata.get("title", "")
    folder = post.metadata.get("folder", "")
    tags = post.metadata.get("tags", [])
    task_notes = post.content[:200] if post.content else ""

    prompt = f"""A task was just completed. Decide if it should be archived or deleted.

Title: {title}
Folder: {folder}
Tags: {tags}
Notes: {task_notes}

Rules:
- Keep if: work task, project, has meaningful notes, research, writing, studying
- Delete if: errand, housework, simple chore, one-off admin, grocery run, anything trivial
- When in doubt, keep

Reply with ONLY one word: keep or delete"""

    try:
        response = ask(prompt, include_system=False, use_local=False).strip().lower()
        if "delete" in response:
            done_path.unlink()
            print(f"LLM decided: delete {title}")
        else:
            print(f"LLM decided: keep {title}")
    except Exception as e:
        print(f"LLM keep/delete failed, keeping file: {e}")


def _spawn_next_recurrence(post: object, original_filepath) -> None:
    """
    Create the next instance of a recurring task.
    """
    from datetime import timedelta
    import re

    recurrence = post.metadata.get("recurrence", "")
    if not recurrence:
        return

    # Parse recurrence interval
    days = None
    recurrence_lower = recurrence.lower()

    if "day" in recurrence_lower:
        match = re.search(r"(\d+)", recurrence_lower)
        days = int(match.group(1)) if match else 1
    elif "week" in recurrence_lower:
        match = re.search(r"(\d+)", recurrence_lower)
        weeks = int(match.group(1)) if match else 1
        days = weeks * 7
    elif "month" in recurrence_lower:
        match = re.search(r"(\d+)", recurrence_lower)
        months = int(match.group(1)) if match else 1
        days = months * 30  # approximate
    elif "biweekly" in recurrence_lower or "bi-weekly" in recurrence_lower:
        days = 14
    elif "fortnight" in recurrence_lower:
        days = 14

    if not days:
        print(f"Could not parse recurrence: {recurrence}")
        return

    # Calculate next due date
    next_due = datetime.now() + timedelta(days=days)
    next_due_str = next_due.strftime("%Y-%m-%d")

    # Build new task data from existing task
    new_metadata = dict(post.metadata)
    new_metadata["status"] = "unscheduled"
    new_metadata["progress"] = "0%"
    new_metadata["remaining"] = new_metadata.get("duration_estimated", "")
    new_metadata["completed"] = None
    new_metadata["calendar_event_id"] = None
    new_metadata["scheduled_time"] = None
    new_metadata["scheduled_date"] = None
    new_metadata["planned_date"] = None
    new_metadata["retry_at"] = None
    new_metadata["retry_note"] = None
    new_metadata["continuation_note"] = None
    new_metadata["times_deferred"] = 0
    new_metadata["duration_actual"] = None
    new_metadata["deadline"] = next_due_str
    new_metadata["created"] = datetime.now().strftime("%Y-%m-%d")

    # Write new task file in same folder as original
    destination = original_filepath.parent
    new_post = frontmatter.Post(post.content, **new_metadata)

    new_filepath = destination / original_filepath.name
    # Handle collision
    counter = 2
    while new_filepath.exists():
        new_filepath = destination / f"{original_filepath.stem}_{counter}.md"
        counter += 1

    with open(new_filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(new_post))

    print(f"Spawned next recurrence: {new_filepath.name} (due {next_due_str})")


def unschedule_task(task_title: str) -> str:
    """
    Remove calendar event and set task back to unscheduled.
    """
    filepath = find_task_file(task_title)

    if not filepath:
        return f"Could not find task: {task_title}"

    post = frontmatter.load(filepath)

    # Delete calendar event if exists
    event_id = post.metadata.get("calendar_event_id")
    if event_id:
        from calendar_writer import delete_calendar_event

        delete_calendar_event(event_id)

    updates = {
        "status": "unscheduled",
        "calendar_event_id": None,
        "scheduled_time": None,
        "scheduled_date": None,
        "scheduled_duration": None,
    }
    update_task_file(filepath, updates)

    message = f"'{task_title}' unscheduled."
    print(message)
    return message


if __name__ == "__main__":
    print("=== Test Stopping Now ===")
    stopping_now(
        task_title="read-chapter-4-of-text-as-data-textbook",
        progress="50%",
        remaining="30min",
        continuation_note="got through the first section, need to finish the data review",
        energy="medium",
    )

    print("\n=== Test Retry Later ===")
    retry_later(
        task_title="texas data w9",
        retry_time="2026-04-05 10:00",
        retry_note="got distracted, will try again fresh in the morning",
        energy="low",
    )
