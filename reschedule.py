import frontmatter
from pathlib import Path
from datetime import datetime
from vault_reader import read_tasks
from llm import ask
from config import INBOX, TASKS, SCHEDULED, CHECKINS
from checkin import create_checkin

def update_task_file(filepath: Path, updates: dict) -> None:
    """
    update specific frontmatter fields in an exisiting task file.
    """
    post = frontmatter.load(filepath)

    for key, value in updates.items():
        post.metadata[key] = value

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(frontmatter.dumps(post))

    print(f"Updated: {filepath.name}")


def panic_button(reason: str = "") -> str:
    """
    panic button - nothing gets done, redistribute without judgment.
    Marks all scheduled tasks as unscheduled and resets their schedules.
    """

    now = datetime.now()
    reset_count = 0

    # find all scheduled tasks
    for filepath in TASKS.rglob("*.md"):
        post = frontmatter.load(filepath)

        if post.metadata.get("status") == "scheduled":
            updates = {
                "status": "unscheduled",
                "scheduled_time": None,
                "calendar_event_id": None,
                "times_deferred": post.metadata.get("times_deferred", 0) + 1
            }
            update_task_file(filepath, updates)
            reset_count += 1
        
    # also reset inbox tasks
    for filepath in INBOX.rglob("*.md"):
        post = frontmatter.load(filepath)

        if post.metadata.get("status") == "scheduled":
            updates = {
                "status": "unscheduled",
                "scheduled_time": None,
                "calendar_event_id": None,
                "times_deferred": post.metadata.get("times_deferred", 0) + 1
            }
            update_task_file(filepath, updates)
            reset_count += 1

    # log a checkin
    create_checkin(
        doing="panic reset",
        energy="unknown",
        mood="resetting",
        notes=reason if reason else "day reset, no judgment"
    )

    message = f"Reset {reset_count} tasks. Fresh start, no judgment."
    print(message)
    return message


def stopping_now(
        task_title: str,
        progress: str,
        remaining: str,
        continuation_note: str = "",
        energy: str = "unknown"
) -> str:
    """
    Stopping now but need more time.
    Saves progress state and logs a checkin.
    """
    now = datetime.now()
    found = False

    # find the task file by title
    for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")

        if task_title.lower() in title.lower() or title.lower() in task_title.lower():
            updates = {
                "status": "in-progress",
                "progress": progress,
                "remaining": remaining,
                "continuation_note": continuation_note
            }
            update_task_file(filepath, updates)
            found = True
            break

    if not found:
        print(f"Could not find task matching: {task_title}")
        print("Logging checkin anyway")

    # log checkin reguardless
    create_checkin(
        doing=f"stopping on: {task_title}",
        energy=energy,
        notes=f"progress: {progress}, remaining: {remaining}. {continuation_note}"
    )

    message = f"Progress saved on '{task_title}'. {remaining} remaining. Continuation note logged."
    print(message)
    return message



def retry_later(
    task_title: str,
    retry_time: str,
    retry_note: str = "",
    energy: str = "unknown"
) -> str:
    """
    Didn't start but want to try again at a specific time.
    Sets a retry window without full panic reset.
    """
    found = False

    # find the task file by title
    for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        
        if task_title.lower() in title.lower() or title.lower() in task_title.lower():
            updates = {
                "retry_at": retry_time,
                "retry_note": retry_note if retry_note else "retrying later",
                "times_deferred": post.metadata.get("times_deferred", 0) + 1
            }
            update_task_file(filepath, updates)
            found = True
            break
    
    if not found:
        print(f"Could not find task matching: {task_title}")
        print("Logging checkin anyway.")
    
    # Log checkin
    create_checkin(
        doing=f"retry scheduled: {task_title}",
        energy=energy,
        notes=f"retry at {retry_time}. {retry_note}"
    )
    
    message = f"'{task_title}' set to retry at {retry_time}."
    print(message)
    return message

if __name__ == "__main__":
    print("=== Test Stopping Now ===")
    stopping_now(
        task_title="read-chapter-4-of-text-as-data-textbook",
        progress="50%",
        remaining="30min",
        continuation_note="got through the first section, need to finish the data review",
        energy="medium"
    )
    
    print("\n=== Test Retry Later ===")
    retry_later(
        task_title="texas data w9",
        retry_time="2026-04-05 10:00",
        retry_note="got distracted, will try again fresh in the morning",
        energy="low"
    )
    
    print("\n=== Test Panic Button ===")
    panic_button("day got away from me, resetting everything")
