import json
import uuid
from datetime import datetime
from pathlib import Path
from config import VAULT_PATH

BRACKETS_FILE = VAULT_PATH / "system/schedule_brackets.json"


def load_brackets() -> list:
    """Load all brackets from JSON file."""
    if not BRACKETS_FILE.exists():
        return []
    with open(BRACKETS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_brackets(brackets: list) -> None:
    """Save brackets to JSON file."""
    BRACKETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BRACKETS_FILE, "w", encoding="utf-8") as f:
        json.dump(brackets, f, indent=2)


def get_brackets() -> list:
    """Return all active brackets."""
    return [b for b in load_brackets() if b.get("active", True)]


def create_bracket(
    name: str,
    bracket_type: str,  # "schedule" or "block"
    color: str,  # "green" or "red"
    start_time: str,  # "09:00"
    end_time: str,  # "11:00"
    days: list,  # ["monday", "tuesday"] or []
    description: str = "",
    reflections: str = "",
    specific_date: str = None,  # "2026-07-18" for one-off
    mode: str = "rigid",  # "rigid" or "basket"
) -> dict:
    """Create a new bracket and save it."""
    brackets = load_brackets()

    bracket = {
        "id": f"bracket_{uuid.uuid4().hex[:8]}",
        "name": name,
        "type": bracket_type,
        "color": color,
        "start_time": start_time,
        "end_time": end_time,
        "days": days,
        "specific_date": specific_date,
        "description": description,
        "reflections": reflections,
        "mode": mode,
        "active": True,
        "created": datetime.now().strftime("%Y-%m-%d"),
    }

    brackets.append(bracket)
    save_brackets(brackets)
    return bracket


def update_bracket(bracket_id: str, updates: dict) -> dict | None:
    """Update an existing bracket by ID."""
    brackets = load_brackets()

    for i, b in enumerate(brackets):
        if b["id"] == bracket_id:
            brackets[i].update(updates)
            save_brackets(brackets)
            return brackets[i]

    return None


def delete_bracket(bracket_id: str) -> bool:
    """Delete a bracket by ID."""
    brackets = load_brackets()
    original_len = len(brackets)
    brackets = [b for b in brackets if b["id"] != bracket_id]

    if len(brackets) < original_len:
        save_brackets(brackets)
        return True
    return False


def get_brackets_for_date(date_str: str) -> list:
    """
    Return all brackets that apply to a specific date.
    Checks both recurring day-of-week brackets and specific date brackets.
    """
    from datetime import datetime

    day_names = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]

    date = datetime.strptime(date_str, "%Y-%m-%d")
    day_of_week = day_names[date.weekday()]

    result = []
    for b in get_brackets():
        # Check specific date match
        if b.get("specific_date") == date_str:
            result.append(b)
        # Check recurring day match
        elif day_of_week in b.get("days", []):
            result.append(b)

    return result


def create_default_brackets() -> None:
    """Create sensible default brackets if none exist."""
    if load_brackets():
        return  # already has brackets, don't overwrite

    defaults = [
        {
            "id": "bracket_default_001",
            "name": "Morning Focus",
            "type": "schedule",
            "color": "green",
            "start_time": "09:00",
            "end_time": "11:00",
            "days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
            "specific_date": None,
            "description": "Focused work time — prefer high or deep energy tasks",
            "reflections": "",
            "active": True,
            "created": datetime.now().strftime("%Y-%m-%d"),
        },
        {
            "id": "bracket_default_002",
            "name": "Afternoon Work",
            "type": "schedule",
            "color": "green",
            "start_time": "13:00",
            "end_time": "15:00",
            "days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
            "specific_date": None,
            "description": "Medium energy tasks — admin, errands, low effort work",
            "reflections": "",
            "active": True,
            "created": datetime.now().strftime("%Y-%m-%d"),
        },
        {
            "id": "bracket_default_003",
            "name": "Lunch",
            "type": "block",
            "color": "red",
            "start_time": "12:00",
            "end_time": "13:00",
            "days": [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ],
            "specific_date": None,
            "description": "Protected lunch time — no scheduling",
            "reflections": "",
            "active": True,
            "created": datetime.now().strftime("%Y-%m-%d"),
        },
        {
            "id": "bracket_default_004",
            "name": "Evening",
            "type": "block",
            "color": "red",
            "start_time": "21:00",
            "end_time": "23:00",
            "days": [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ],
            "specific_date": None,
            "description": "Wind down time — no scheduling",
            "reflections": "",
            "active": True,
            "created": datetime.now().strftime("%Y-%m-%d"),
        },
    ]

    save_brackets(defaults)
    print("Created default brackets")


def get_basket_pool(bracket_id: str) -> dict:
    """
    Return the pool of habits and low-energy unscheduled tasks that
    match a basket bracket's time window and duration.
    """
    from config import HABIT_PERIODS, TASKS, INBOX
    import frontmatter

    bracket = None
    for b in get_brackets():
        if b["id"] == bracket_id:
            bracket = b
            break

    if not bracket:
        return {"status": "error", "message": "Bracket not found"}

    if bracket.get("mode") != "basket":
        return {"status": "error", "message": "Bracket is not a basket"}

    start_h, start_m = map(int, bracket["start_time"].split(":"))
    end_h, end_m = map(int, bracket["end_time"].split(":"))
    bracket_start_min = start_h * 60 + start_m
    bracket_end_min = end_h * 60 + end_m
    bracket_duration = bracket_end_min - bracket_start_min

    # Determine which habit period(s) overlap this bracket's time window
    matching_periods = []
    for period, (p_start, p_end) in HABIT_PERIODS.items():
        p_start_h, p_start_m = map(int, p_start.split(":"))
        p_end_h, p_end_m = map(int, p_end.split(":"))
        p_start_min = p_start_h * 60 + p_start_m
        p_end_min = p_end_h * 60 + p_end_m
        if bracket_start_min < p_end_min and bracket_end_min > p_start_min:
            matching_periods.append(period)

    # Matching habits
    from habit_manager import get_habits, get_today_status

    habits = []
    for period in matching_periods:
        habits.extend(get_habits(period=period))
    status = get_today_status()
    for h in habits:
        h["done"] = status.get(h["id"], False)

    # Matching low-energy unscheduled tasks
    from split_task import parse_duration_to_minutes

    tasks = []
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        task_status = post.metadata.get("status", "")
        energy = post.metadata.get("energy_required", "")
        if not title or task_status in ("done", "scheduled", "in-progress"):
            continue
        if energy not in ("cantrip", "low"):
            continue
        excluded = post.metadata.get("excluded_baskets") or []
        if bracket_id in excluded:
            continue
        duration_min = parse_duration_to_minutes(
            post.metadata.get("duration_estimated", "")
        )
        if duration_min == 0 or duration_min > bracket_duration:
            continue
        tasks.append(
            {
                "id": post.metadata.get("id"),
                "title": title,
                "energy_required": energy,
                "duration_estimated": post.metadata.get("duration_estimated", ""),
            }
        )

    return {"status": "ok", "bracket": bracket, "habits": habits, "tasks": tasks}


def get_current_basket_id() -> str | None:
    """Return the id of a basket bracket currently active right now, if any."""
    from datetime import datetime

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    current_min = now.hour * 60 + now.minute

    for b in get_brackets_for_date(today_str):
        if b.get("mode") != "basket":
            continue
        start_h, start_m = map(int, b["start_time"].split(":"))
        end_h, end_m = map(int, b["end_time"].split(":"))
        start_min = start_h * 60 + start_m
        end_min = end_h * 60 + end_m
        if start_min <= current_min < end_min:
            return b["id"]

    return None
