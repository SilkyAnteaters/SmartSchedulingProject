from datetime import datetime
import frontmatter
from vault_reader import read_tasks
from system_reader import load_runtime_context
from checkin import get_recent_checkins
from llm import ask
from config import INBOX, TASKS
from calendar_reader import get_todays_events, get_free_slots


def get_all_tasks():
    """
    read tasks from inbox and all task subfolders
    """
    tasks = []

    # read inbox
    tasks.extend(read_tasks("inbox"))

    # read tasks folder recursively
    for file in TASKS.rglob("*.md"):
        if file.is_file():
            post = frontmatter.load(file)
            # skip folder notes and done tasks
            if not post.metadata.get("title"):
                continue
            if post.metadata.get("status") == "done":
                continue

            from reschedule import is_blocked

            if is_blocked(post.metadata):
                continue

            tasks.append(
                {
                    "file": file.name,
                    "metadata": post.metadata,
                    "notes": post.content,
                    "scheduling_instructions": post.metadata.get(
                        "scheduling_instructions", ""
                    ),
                }
            )
    return tasks


def format_tasks_for_prompt(tasks):
    """Format tasks into a readable string for the LLM prompt."""
    if not tasks:
        return "No tasks found."

    today = datetime.now().strftime("%Y-%m-%d")

    formatted = []
    for task in tasks:
        m = task["metadata"]

        # Skip done tasks
        if m.get("status") == "done":
            continue

        entry = f"""
- {m.get('title', task['file'])}
  status: {m.get('status', 'unknown')}
  priority: {m.get('priority', 'none')}
  energy: {m.get('energy_required', 'unknown')} (slot {m.get('slot_level', '?')})
  duration: {m.get('duration_estimated', 'unknown')}
  deadline: {m.get('deadline', 'none')}
  preferred days: {m.get('preferred_days', [])}
  blocked by: {m.get('blocked_by', [])}"""

        if m.get("planned_date") == today:
            entry += "\n  ⭐ PLANNED FOR TODAY — prioritize this"

        if task.get("scheduling_instructions"):
            entry += f"\n  scheduling notes: {task['scheduling_instructions']}"

        formatted.append(entry)

    return "\n".join(formatted)


def what_now(current_energy: str = None, slots_remaining: str = None):
    """
    Core function — given current context, suggest 2-3 tasks to do right now.
    """
    now = datetime.now()
    current_time = now.strftime("%I:%M %p")
    current_day = now.strftime("%A").lower()

    # load everything
    runtime = load_runtime_context()
    tasks = get_all_tasks()
    recent_checkins = get_recent_checkins(days=3)

    # Load calendar data
    todays_events = get_todays_events()
    free_slots = get_free_slots(todays_events)

    # Check for imminent events
    now = datetime.now()
    urgent_warning = ""
    for event in todays_events:
        if event["all_day"]:
            continue
        event_start = datetime.fromisoformat(event["start"].replace("Z", ""))
        event_start = event_start.replace(tzinfo=None)
        minutes_until = (event_start - now).seconds // 60

        if 0 < minutes_until <= 30:
            urgent_warning = (
                f"⚠️ WARNING: {event['title']} starts in {minutes_until} minutes!\n"
            )
            break

    # Format calendar context
    events_text = ""
    if todays_events:
        events_text = "Today's hard blocks:\n"
        for e in todays_events:
            events_text += f"  - {e['title']} ({e['start']} → {e['end']})\n"
    else:
        events_text = "No hard blocks today."

    slots_text = ""
    if free_slots:
        slots_text = "Available time slots today:\n"
        for slot in free_slots:
            slots_text += f"  - {slot['start']} → {slot['end']} ({slot['duration_minutes']} min)\n"
    else:
        slots_text = "No free slots found today."

    # ← ADD THE GUARD HERE, after tasks is loaded
    if not tasks:
        return "No tasks in your vault right now. Add some tasks first."

    if len(tasks) == 1:
        task = tasks[0]
        title = task["metadata"].get("title", "your task")
        duration = task["metadata"].get("duration_estimated", "unknown duration")
        return f"You only have one task right now:\n\n→ {title} ({duration})\n\nAdd more tasks to get multiple options."

    # format for prompt
    task_list = format_tasks_for_prompt(tasks)
    checkin_summary = (
        "\n---\n".join(recent_checkins[-3:])
        if recent_checkins
        else "No recent checkins"
    )

    # build energy context
    energy_context = ""
    if current_energy:
        energy_context += f"Current energy level: {current_energy}\n"
    if slots_remaining:
        energy_context += f"Spell slots remaining today: {slots_remaining}\n"

    today = now.strftime("%Y-%m-%d")

    max_slot = max([s["duration_minutes"] for s in free_slots]) if free_slots else 120

    prompt = f"""
{urgent_warning}
Current time: {current_time}
Current day: {current_day}
Today's date: {today}
Any task with deadline {today} is due TODAY, not tomorrow.
{energy_context}

Calendar:
{events_text}

{slots_text}

Recent checkins:
{checkin_summary}

Available tasks:
{task_list}

Soft schedule preferences:
{runtime['soft_schedule']}

CRITICAL RULES:
- If there is a WARNING at the top, always mention it first before suggestions
- You MUST only suggest tasks from the task list above
- You MUST only suggest tasks that fit within an available time slot
- Never suggest a task longer than the available slot duration
- Tasks marked PLANNED FOR TODAY should be prioritized in suggestions
- If the only free slot is 30 min do not suggest a 90 min task
- Start response directly with Option 1, no preamble
- Suggest EXACTLY 2-3 options, never more
- Do NOT invent tasks or generic suggestions
- The longest available slot right now is {max_slot} minutes
- NEVER suggest a task longer than {max_slot} minutes
- Format exactly like this and no other way:

Option 1 — [exact task name] ([duration])
Why: [one sentence]

Option 2 — [exact task name] ([duration])
Why: [one sentence]

Keep it short, scannable, and non-judgmental.
"""

    return ask(prompt)


if __name__ == "__main__":
    tasks = get_all_tasks()
    print(f"Found {len(tasks)} tasks:")
    for t in tasks:
        print(f" - {t['metadata'].get('title', t['file'])}")

    print("=== What Should I Do Now? ===\n")

    # Test without energy input first
    response = what_now()
    print(response)

    print("\n=== With Energy Context ===\n")

    # Test with energy and slots
    response = what_now(current_energy="high")
    print(response)
