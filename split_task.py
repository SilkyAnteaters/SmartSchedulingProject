import re
import uuid
import frontmatter
from config import TASKS, INBOX
from reschedule import find_task_by_id


def parse_duration_to_minutes(duration_str: str) -> int:
    if not duration_str:
        return 0
    total = 0
    hr_match = re.search(r"([\d.]+)\s*hr", duration_str)
    min_match = re.search(r"(\d+)\s*min", duration_str)
    if hr_match:
        total += int(float(hr_match.group(1)) * 60)
    if min_match:
        total += int(min_match.group(1))
    return total


def minutes_to_duration_str(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes}min"
    hrs = minutes // 60
    mins = minutes % 60
    return f"{hrs}hr {mins}min" if mins else f"{hrs}hr"


def split_task(task_id: str, first_chunk_minutes: int) -> dict:
    """
    Split a task into two linked chunks. The task you call this on
    (whichever chunk you're currently facing — the original task, or
    any later part) becomes the earlier of the two new chunks; a new
    file is created for the remainder.

    Supports splitting more than once: a root_id field tracks the true
    original ancestor across any number of splits, and part numbers
    are assigned sequentially based on how many chunks already exist
    in the family, rather than always being "Part 1"/"Part 2".

    If the chunk you're splitting was already scheduled on Google
    Calendar, its event is deleted and recreated to match the new
    title/duration.
    """
    from datetime import datetime, timedelta
    from calendar_writer import delete_calendar_event, create_calendar_event

    filepath = find_task_by_id(task_id)
    if not filepath:
        return {"status": "error", "message": f"Task with id {task_id} not found."}

    post = frontmatter.load(filepath)
    total_minutes = parse_duration_to_minutes(
        post.metadata.get("duration_estimated", "")
    )

    if total_minutes <= first_chunk_minutes:
        return {
            "status": "error",
            "message": f"Task is only {total_minutes} min — nothing left to split off after a {first_chunk_minutes} min chunk.",
        }

    remaining_minutes = total_minutes - first_chunk_minutes
    original_title = post.metadata.get("title", "")
    original_id = post.metadata.get("id")

    # Preserve the TRUE original ancestor across any number of splits —
    # if this task is already part of a split family, keep its existing
    # root_id; otherwise this is the first split, so it becomes the root.
    root_id = post.metadata.get("root_id") or original_id

    # Determine the next part number by counting existing family members
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    family_count = 0
    for fp in all_files:
        fp_post = frontmatter.load(fp)
        if (
            fp_post.metadata.get("root_id") == root_id
            or fp_post.metadata.get("id") == root_id
        ):
            family_count += 1

    # Strip any existing "(Part N)" suffix before assigning a fresh one
    base_title = re.sub(r"\s*\(Part \d+\)\s*$", "", original_title).strip()
    new_part_title = f"{base_title} (Part {family_count})"
    new_chunk_title = f"{base_title} (Part {family_count + 1})"

    # If this chunk is already scheduled, sync the calendar event to match
    if post.metadata.get("status") == "scheduled" and post.metadata.get(
        "calendar_event_id"
    ):
        old_event_id = post.metadata["calendar_event_id"]
        scheduled_time = post.metadata.get("scheduled_time")
        scheduled_date = post.metadata.get(
            "scheduled_date", datetime.now().strftime("%Y-%m-%d")
        )

        try:
            try:
                start = datetime.strptime(
                    f"{scheduled_date} {scheduled_time}", "%Y-%m-%d %I:%M %p"
                )
            except ValueError:
                start = datetime.strptime(
                    f"{scheduled_date} {scheduled_time}", "%Y-%m-%d %H:%M"
                )
            end = start + timedelta(minutes=first_chunk_minutes)

            delete_calendar_event(old_event_id)
            new_event_id = create_calendar_event(
                title=new_part_title,
                start_iso=start.isoformat(),
                end_iso=end.isoformat(),
                description="Split by SmartScheduler",
                energy=post.metadata.get("energy_required", ""),
            )
            post.metadata["calendar_event_id"] = new_event_id
            post.metadata["scheduled_duration"] = minutes_to_duration_str(
                first_chunk_minutes
            )
        except Exception as e:
            print(f"Warning: could not sync calendar event during split: {e}")

    # Update this chunk's file to become the earlier of the two new parts
    post.metadata["root_id"] = root_id
    post.metadata["title"] = new_part_title
    post.metadata["duration_estimated"] = minutes_to_duration_str(first_chunk_minutes)
    post.metadata["remaining"] = minutes_to_duration_str(first_chunk_minutes)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))

    #
