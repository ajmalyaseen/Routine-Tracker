"""
Routine Tracker - FastMCP Server for Claude
Allows Claude to view, create, replace, and manage the user's daily routines in Supabase.
"""

import httpx
import json
from datetime import datetime
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp = FastMCP("Routine Tracker")

SUPABASE_URL = "https://gwrrlipcjhhrwjjjkuby.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3cnJsaXBjamhocndqamprdWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MTQ0OTYsImV4cCI6MjExMDM5MDQ5Nn0.B0-Eg4YOMyRe7rQNdOl_-xYtw6G6S9TKdX45KNvngHQ"
USER_ID = "routine-master-user"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def get_remote_state() -> dict:
    """Fetch user state from Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/user_discipline_state?user_id=eq.{USER_ID}&select=state"
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, headers=HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0 and "state" in data[0]:
                return data[0]["state"]
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "routines": []
    }

def save_remote_state(state: dict) -> bool:
    """Upsert state to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/user_discipline_state"
    payload = {
        "user_id": USER_ID,
        "state": state,
        "updated_at": datetime.now().isoformat()
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(
            url,
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            json=payload
        )
        return resp.status_code in (200, 201)

@mcp.tool()
def get_routines() -> str:
    """
    Get the user's current daily routine list and checkmark completion status.
    """
    state = get_remote_state()
    routines = state.get("routines", [])
    if not routines:
        return "No routines currently configured in Routine Tracker."
    
    lines = [f"Daily Routines ({len(routines)} items):"]
    for idx, r in enumerate(routines, 1):
        status = "[x]" if r.get("done") else "[ ]"
        cat = f" [{r.get('category')}]" if r.get("category") else ""
        lines.append(f"{idx}. {status} {r.get('time')} - {r.get('title')}{cat} (ID: {r.get('id')})")
    
    return "\n".join(lines)

@mcp.tool()
def add_routine(time: str, title: str, category: str = "") -> str:
    """
    Add a single routine item to the user's routine tracker.
    
    Args:
        time: Time string, e.g. "06:00 AM" or "07:00 AM - 08:30 AM"
        title: What to do, e.g. "Study SQL Window Functions & CTEs"
        category: Optional tag, e.g. "SQL", "ML", "Routine", "Interview"
    """
    state = get_remote_state()
    routines = state.get("routines", [])
    
    item_id = f"rt-{int(datetime.now().timestamp() * 1000)}"
    new_item = {
        "id": item_id,
        "time": time,
        "title": title,
        "category": category,
        "done": False
    }
    routines.append(new_item)
    state["routines"] = routines
    
    success = save_remote_state(state)
    if success:
        return f"Successfully added routine: '{time} - {title}' (Tag: {category}). It is now live in the app!"
    return "Failed to save to Supabase."

@mcp.tool()
def set_full_routine(routines: list[dict]) -> str:
    """
    Replace the entire routine schedule with a curated list of items.
    Use this when the user asks Claude to design their daily schedule or rebuild their routine from scratch.
    
    Each item in the list must be a dictionary with:
      - 'time' (str): e.g. '06:00 AM', '09:00 AM - 11:30 AM'
      - 'title' (str): e.g. 'Study Machine Learning Scikit-Learn Pipelines'
      - 'category' (str, optional): e.g. 'ML', 'SQL', 'GenAI', 'Interview', 'Routine'
    """
    state = get_remote_state()
    new_routines = []
    
    base_ts = int(datetime.now().timestamp() * 1000)
    for idx, item in enumerate(routines):
        new_routines.append({
            "id": f"rt-{base_ts}-{idx}",
            "time": item.get("time", ""),
            "title": item.get("title", ""),
            "category": item.get("category", ""),
            "done": bool(item.get("done", False))
        })
    
    state["routines"] = new_routines
    success = save_remote_state(state)
    if success:
        return f"Successfully set {len(new_routines)} routines in Routine Tracker! The web app has updated."
    return "Failed to update Supabase."

@mcp.tool()
def toggle_routine(title_or_id: str, done: bool = True) -> str:
    """
    Mark a routine item as done or undone.
    
    Args:
        title_or_id: The ID of the routine, or a substring of the title
        done: True for completed, False for uncompleted
    """
    state = get_remote_state()
    routines = state.get("routines", [])
    
    found = False
    for r in routines:
        if r.get("id") == title_or_id or title_or_id.lower() in r.get("title", "").lower():
            r["done"] = done
            found = True
            break
            
    if not found:
        return f"Could not find a routine matching '{title_or_id}'."
        
    state["routines"] = routines
    save_remote_state(state)
    status_str = "completed" if done else "uncompleted"
    return f"Routine '{title_or_id}' marked as {status_str}."

@mcp.tool()
def delete_routine(title_or_id: str) -> str:
    """
    Delete a specific routine item by ID or title match.
    """
    state = get_remote_state()
    routines = state.get("routines", [])
    
    initial_len = len(routines)
    routines = [r for r in routines if r.get("id") != title_or_id and title_or_id.lower() not in r.get("title", "").lower()]
    
    if len(routines) == initial_len:
        return f"No routine matching '{title_or_id}' found to delete."
        
    state["routines"] = routines
    save_remote_state(state)
    return f"Deleted routine matching '{title_or_id}'."

@mcp.tool()
def clear_all_routines() -> str:
    """
    Clear all routines from the tracker to start completely fresh.
    """
    state = get_remote_state()
    state["routines"] = []
    save_remote_state(state)
    return "All routines cleared. The Routine Tracker is now clean and empty."

if __name__ == "__main__":
    mcp.run()
