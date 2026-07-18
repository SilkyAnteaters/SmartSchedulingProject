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
