import uuid
import frontmatter
from config import TASKS, INBOX


def backfill_task_ids():
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    updated = 0
    skipped = 0

    for filepath in all_files:
        post = frontmatter.load(filepath)

        if not post.metadata.get("title"):
            continue  # skip folder notes / non-task files

        if post.metadata.get("id"):
            skipped += 1
            continue

        post.metadata["id"] = f"task_{uuid.uuid4().hex[:8]}"
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))
        updated += 1
        print(f"Assigned id to: {post.metadata.get('title')}")

    print(f"\nDone. {updated} tasks updated, {skipped} already had an id.")


if __name__ == "__main__":
    backfill_task_ids()
