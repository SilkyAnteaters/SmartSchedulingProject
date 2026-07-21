import json
import re
import frontmatter
import uuid
from pathlib import Path
from datetime import datetime, timezone
from llm import ask
from config import INBOX, TASKS, RUNTIME_MODEL


def clean_json_response(text: str) -> str:
    """
    strip markdown code fenses if the LLM wraps its JSON in them.
    """
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"```$", "", text)
    return text.strip()


def title_exists(title: str) -> bool:
    """
    Check if a task with this title already exists in the vault.
    """
    for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
        post = frontmatter.load(filepath)
        if post.metadata.get("title", "").lower() == title.lower():
            return True
    return False


def parse_task_from_text(raw_text: str) -> dict:
    """
    takes natural language input and returns a structured task dictionary.
    """

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    day_of_week = now.strftime("%A").lower()
    current_time = now.strftime("%H:%M")

    prompt = f"""
Today is {today} ({day_of_week}) and the current time is {current_time}.
When the user says "today" the deadline is exactly {today}.
When the user says "tomorrow" the deadline is exactly {(now + __import__('datetime').timedelta(days=1)).strftime("%Y-%m-%d")}.
When the user says "this week" the deadline is the coming Sunday.
If the user mentions a specific time (e.g. "at 3pm", "tonight at 8", "tomorrow morning at 9"), extract it as parsed_datetime in ISO format combining the resolved date and time.
If the user says a time like "at 6" or "at 9" with no AM/PM specified:
- If that time is more than 1 hour in the future today, assume today
- If that time has already passed today, assume tomorrow
- Default to PM for times 1-11 if context suggests daytime activity
- Default to AM for times 1-11 if context suggests morning activity (breakfast, wake up etc.)

If the person implies working on or starting this task on a DIFFERENT day than its deadline (e.g. "prep the presentation Wednesday, it's due Friday"), set suggested_schedule_date to that earlier working day. Only set this when such a distinction is actually implied — leave it null if the deadline and the intended working day are the same, or if no scheduling day was mentioned at all.

Parse the following into a task. Return ONLY a JSON object with these exact fields:
{{
    "title": "task title",
    "duration_estimated": "e.g. 45min or 2hr",
    "priority": "low, medium, high, or critical",
    "deadline": "YYYY-MM-DD or null",
    "planned_date": "YYYY-MM-DD or null",
    "recurrence": "preserve exact frequency e.g. 'every week', 'twice a day', 'every 3 days', 'on mondays and wednesdays', or null",
    "energy_required": "cantrip, low, medium, high, or deep",
    "slot_level": 0-9,
    "preferred_days": ["monday", "wednesday"] or [],
    "preferred_time": "e.g. morning or null",
    "suggested_schedule_date": "YYYY-MM-DD or null",
    "parsed_datetime": "e.g. 2026-07-17T15:00:00 if a specific time was mentioned, or null",
    "blocked_by": [],
    "tags": ["tag1", "tag2"],
    "folder": "which folder this belongs in e.g. tasks/work/deep-work",
    "notes": "any extra context worth capturing",
    "scheduling_instructions": "any specific scheduling constraints mentioned"
}}

If the input describes multiple related tasks or steps rather than one single task, return a JSON ARRAY of task objects instead of a single object — one object per task, each following the schema above. Use blocked_by with the exact title string of another task IN THIS SAME ARRAY that must be completed first, if applicable.

No explanation, no markdown, just the JSON object.

Input: {raw_text}
"""
    response = ask(prompt)
    cleaned = clean_json_response(response)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        print(f"Failed to parse LLM response as JSON: {e}")
        print(f"Raw response: {response}")
        return None


def create_task_file(task_data: dict, destination: Path = None) -> Path:
    """
    Takes a parsed task dictionary and writes it as a markdown file
    in the appropriate vault folder
    """

    # determine destination folder
    if destination is None:
        folder_path = task_data.get("folder", "inbox")
        if folder_path == "inbox":
            destination = INBOX
        else:
            # Normalize: strip leading "tasks/" if present, then re-root under TASKS
            # This prevents rogue folders at vault root if LLM omits "tasks/" prefix
            if folder_path.startswith("tasks/"):
                folder_path = folder_path[len("tasks/") :]
            destination = TASKS / folder_path

    # make sure folder exists
    destination.mkdir(parents=True, exist_ok=True)

    # create filename from title
    title = task_data.get("title", "untitled task")

    # Normalize: replace underscores with spaces, title-case
    title = title.replace("_", " ").strip()

    # Warn if duplicate title detected
    if title_exists(title):
        print(f"Warning: a task called '{title}' already exists.")
        print("Creating anyway — check your vault for duplicates.")

    import re

    safe_title = re.sub(r"[^\w\s]", "", title.lower())
    safe_title = safe_title.replace(" ", "_")
    safe_title = re.sub(r"_+", "_", safe_title)
    filename = f"{safe_title}.md"
    filepath = destination / filename

    # Handle filename collision as last resort
    counter = 2
    while filepath.exists():
        filename = f"{safe_title}_{counter}.md"
        filepath = destination / filename
        counter += 1

    deadline = task_data.get("deadline")
    parsed_dt = task_data.get("parsed_datetime")
    if deadline and parsed_dt:
        try:
            dt = datetime.fromisoformat(parsed_dt)
            if dt.strftime("%Y-%m-%d") == deadline:
                deadline = dt.strftime("%Y-%m-%dT%H:%M")
        except (ValueError, TypeError):
            pass

    # build the frontmatter
    metadata = {
        "id": f"task_{uuid.uuid4().hex[:8]}",
        "title": title,
        "duration_estimated": task_data.get("duration_estimated", ""),
        "priority": task_data.get("priority", "medium"),
        "deadline": deadline,
        "suggested_schedule_date": task_data.get("suggested_schedule_date"),
        "planned_date": task_data.get("planned_date"),
        "recurrence": task_data.get("recurrence"),
        "status": "unscheduled",
        "progress": "0%",
        "remaining": task_data.get("duration_estimated", ""),
        "scheduled_time": None,
        "retry_at": None,
        "retry_note": None,
        "continuation_note": None,
        "blocked_by": task_data.get("blocked_by", []),
        "calendar_event_id": None,
        "times_deferred": 0,
        "energy_required": task_data.get("energy_required", "medium"),
        "slot_level": task_data.get("slot_level", 3),
        "preferred_time": task_data.get("preferred_time"),
        "preferred_days": task_data.get("preferred_days", []),
        "tags": task_data.get("tags", []),
        "created": datetime.now().strftime("%Y-%m-%d"),
    }

    # Build notes content
    notes_content = task_data.get("notes", "")
    scheduling_instructions = task_data.get("scheduling_instructions", "")

    content = "## Notes\n"
    if notes_content:
        content += f"{notes_content}\n"

    if scheduling_instructions:
        content += f"\n## Scheduling Instructions\n{scheduling_instructions}\n"

    # Write the file
    post = frontmatter.Post(content, **metadata)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))

    print(f"Task created: {filepath}")
    return filepath


def parse_llm_task_response(response: str) -> list:
    """
    Parse the LLM's response into a list of task dicts — handles a
    single object, a proper JSON array, or multiple back-to-back
    JSON objects/fenced blocks (which the LLM sometimes produces when
    a description naturally decomposes into related tasks).
    Always returns a list, even for a single task.
    """
    cleaned = clean_json_response(response)

    # Straightforward case: single object or a proper array
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        pass

    # Fallback: strip ALL fences (not just first/last) and decode
    # sequential JSON objects one at a time
    text = re.sub(r"```json\s*", "", cleaned)
    text = re.sub(r"```", "", text).strip()

    decoder = json.JSONDecoder()
    tasks = []
    idx = 0
    while idx < len(text):
        while idx < len(text) and text[idx].isspace():
            idx += 1
        if idx >= len(text):
            break
        try:
            obj, end_idx = decoder.raw_decode(text, idx)
            tasks.append(obj)
            idx = end_idx
        except json.JSONDecodeError:
            break

    return tasks


def add_task(raw_text: str) -> list:
    """
    Main function — takes natural language and creates one or more
    linked task files (if the LLM decomposes the input into multiple
    related tasks). Returns a list of created filepaths.
    """
    print(f"Parsing: '{raw_text}'")

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    day_of_week = now.strftime("%A").lower()
    current_time = now.strftime("%H:%M")

    prompt = f"""
Today is {today} ({day_of_week}) and the current time is {current_time}.
When the user says "today" the deadline is exactly {today}.
When the user says "tomorrow" the deadline is exactly {(now + __import__('datetime').timedelta(days=1)).strftime("%Y-%m-%d")}.
When the user says "this week" the deadline is the coming Sunday.
If the user mentions a specific time the task is due by (e.g. "by 3pm", "before my 2pm meeting", "due at noon"), include that time in the deadline using YYYY-MM-DDTHH:MM (24-hour format), e.g. "2026-07-26T15:00". If no specific time is mentioned, use YYYY-MM-DD only.

If the person implies working on or starting this task on a DIFFERENT day than its deadline (e.g. "prep the presentation Wednesday, it's due Friday"), set suggested_schedule_date to that earlier working day. Only set this when such a distinction is actually implied — leave it null if the deadline and the intended working day are the same, or if no scheduling day was mentioned at all.

Parse the following into a task. Return ONLY a JSON object with these exact fields:
{{
    "title": "task title",
    "duration_estimated": "e.g. 45min or 2hr",
    "priority": "low, medium, high, or critical",
    "deadline": "YYYY-MM-DD, or YYYY-MM-DDTHH:MM if a specific time was mentioned, or null",
    "recurrence": "e.g. every week or null",
    "energy_required": "cantrip, low, medium, high, or deep",
    "slot_level": 0-9,
    "preferred_days": ["monday", "wednesday"] or [],
    "preferred_time": "e.g. morning or null",
    "suggested_schedule_date": "YYYY-MM-DD or null",
    "blocked_by": [],
    "tags": ["tag1", "tag2"],
    "folder": "which folder this belongs in e.g. tasks/work/deep-work",
    "notes": "any extra context worth capturing",
    "scheduling_instructions": "any specific scheduling constraints mentioned"
}}

If the input describes multiple related tasks or steps rather than one single task, return a JSON ARRAY of task objects instead of a single object — one object per task, each following the schema above. Use blocked_by with the exact title string of another task IN THIS SAME ARRAY that must be completed first, if applicable.

No explanation, no markdown, just the JSON object or array.

Input: {raw_text}
"""
    response = ask(prompt)
    task_list = parse_llm_task_response(response)

    if not task_list:
        print("Failed to parse task(s). Please try again.")
        return []

    # First pass: create every file, track title -> id / filepath
    title_to_id = {}
    title_to_filepath = {}
    root_id = None

    for i, task_data in enumerate(task_list):
        filepath = create_task_file(task_data)
        post = frontmatter.load(filepath)

        if i == 0:
            root_id = post.metadata.get("id")
        post.metadata["root_id"] = root_id

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))

        key = task_data.get("title", "").strip().lower()
        title_to_id[key] = post.metadata.get("id")
        title_to_filepath[key] = filepath

        print(f"\nCreated: {task_data.get('title')}")
        print(f"  Priority: {task_data.get('priority')}")
        print(
            f"  Energy: {task_data.get('energy_required')} (slot {task_data.get('slot_level')})"
        )
        print(f"  Duration: {task_data.get('duration_estimated')}")
        print(f"  Deadline: {task_data.get('deadline')}")

    # Second pass: resolve blocked_by title strings -> real ids,
    # and build a reverse map for "blocks" relationships
    blocks_map = {key: [] for key in title_to_filepath}

    for task_data in task_list:
        key = task_data.get("title", "").strip().lower()
        resolved_ids = []
        for ref in task_data.get("blocked_by", []) or []:
            ref_key = ref.strip().lower()
            if ref_key in title_to_id:
                resolved_ids.append(title_to_id[ref_key])
                blocks_map[ref_key].append(key)

        filepath = title_to_filepath[key]
        post = frontmatter.load(filepath)
        post.metadata["blocked_by"] = resolved_ids
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))

    # Third pass: write [[wikilinks]] under ## Related in both directions
    for task_data in task_list:
        key = task_data.get("title", "").strip().lower()
        filepath = title_to_filepath[key]
        post = frontmatter.load(filepath)

        related_lines = []
        for ref in task_data.get("blocked_by", []) or []:
            ref_key = ref.strip().lower()
            if ref_key in title_to_filepath:
                related_lines.append(
                    f"Blocked by: [[{title_to_filepath[ref_key].stem}]] ({ref})"
                )
        for blocked_key in blocks_map.get(key, []):
            blocked_title = next(
                (
                    t.get("title")
                    for t in task_list
                    if t.get("title", "").strip().lower() == blocked_key
                ),
                blocked_key,
            )
            related_lines.append(
                f"Blocks: [[{title_to_filepath[blocked_key].stem}]] ({blocked_title})"
            )

        if related_lines:
            post.content = (
                post.content.rstrip()
                + "\n\n## Related\n"
                + "\n".join(related_lines)
                + "\n"
            )
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))

    return list(title_to_filepath.values())


if __name__ == "__main__":
    # Test with a few different natural language inputs
    print("=== Test 1 ===")
    add_task(
        "read chapter 4 of text as data textbook, due thursday, medium energy, about 45 minutes"
    )

    print("\n=== Test 2 ===")
    add_task("schedule laundry sometime this weekend, low energy, 30 minutes")

    print("\n=== Test 3 ===")
    add_task(
        "prep for monday social networks class, high energy, need about an hour, prefer sunday morning"
    )
