import json
import re
import frontmatter
from pathlib import Path
from datetime import datetime
from llm import ask
from config import (
    INBOX,
    TASKS,
    RUNTIME_MODEL
)

def clean_json_response(text: str) -> str:
    """
    strip markdown code fenses if the LLM wraps its JSON in them.
    """
    text = text.strip()
    text = re.sub(r'^```json\s*', '', text)
    text = re.sub(r'^```\s*', '', text)
    text = re.sub(r'```$', '', text)
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

    today = datetime.now().strftime("%Y-%m-%d")
    day_of_week = datetime.now().strftime("%A").lower()


    prompt = f"""
Today is {today} ({day_of_week}).

Parse the following into a task. Return ONLY a JSON object with these exact fields:
{{
    "title": "task title",
    "duration_estimated": "e.g. 45min or 2hr",
    "priority": "low, medium, high, or critical",
    "deadline": "YYYY-MM-DD or null",
    "recurrence": "e.g. every week or null",
    "energy_required": "cantrip, low, medium, high, or deep",
    "slot_level": 0-9,
    "preferred_days": ["monday", "wednesday"] or [],
    "preferred_time": "e.g. morning or null",
    "blocked_by": [],
    "tags": ["tag1", "tag2"],
    "folder": "which folder this belongs in e.g. tasks/work/deep-work",
    "notes": "any extra context worth capturing",
    "scheduling_instructions": "any specific scheduling constraints mentioned"
}}

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
            # build path from folder string e.g "tasks/work/deep-work"
            destination = TASKS.parent / folder_path

    # make sure folder exists
    destination.mkdir(parents=True, exist_ok=True)

    # create filename from title
    title = task_data.get("title", "untitled task")

    # Warn if duplicate title detected
    if title_exists(title):
        print(f"Warning: a task called '{title}' already exists.")
        print("Creating anyway — check your vault for duplicates.")

    import re
    safe_title = re.sub(r'[^\w\s]', '', title.lower())
    safe_title = safe_title.replace(" ", "_")
    safe_title = re.sub(r'_+', '_', safe_title)
    filename = f"{safe_title}.md"
    filepath = destination / filename

    # Handle filename collision as last resort
    counter = 2
    while filepath.exists():
        filename = f"{safe_title}_{counter}.md"
        filepath = destination / filename
        counter += 1

    # build the frontmatter
    metadata = {
        "title": title,
        "duration_estimated": task_data.get("duration_estimated", ""),
        "priority": task_data.get("priority", "medium"),
        "deadline": task_data.get("deadline"),
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
        "created": datetime.now().strftime("%Y-%m-%d")
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
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(frontmatter.dumps(post))
    
    print(f"Task created: {filepath}")
    return filepath

def add_task(raw_text: str) -> Path:
    """
    Main function — takes natural language and creates a task file.
    """
    print(f"Parsing: '{raw_text}'")
    
    task_data = parse_task_from_text(raw_text)
    
    if task_data is None:
        print("Failed to parse task. Please try again.")
        return None
    
    print(f"\nParsed task:")
    print(f"  Title: {task_data.get('title')}")
    print(f"  Priority: {task_data.get('priority')}")
    print(f"  Energy: {task_data.get('energy_required')} (slot {task_data.get('slot_level')})")
    print(f"  Duration: {task_data.get('duration_estimated')}")
    print(f"  Deadline: {task_data.get('deadline')}")
    print(f"  Folder: {task_data.get('folder')}")
    print(f"  Tags: {task_data.get('tags')}")
    
    filepath = create_task_file(task_data)
    return filepath


if __name__ == "__main__":
    # Test with a few different natural language inputs
    print("=== Test 1 ===")
    add_task("read chapter 4 of text as data textbook, due thursday, medium energy, about 45 minutes")
    
    print("\n=== Test 2 ===")
    add_task("schedule laundry sometime this weekend, low energy, 30 minutes")
    
    print("\n=== Test 3 ===")
    add_task("prep for monday social networks class, high energy, need about an hour, prefer sunday morning")