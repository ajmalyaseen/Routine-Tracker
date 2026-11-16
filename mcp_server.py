"""
Routine Tracker - FastMCP Server for Claude
Allows Claude to view, create, replace, and manage the user's daily routines in Supabase.
Supports Today, Tomorrow, and Future Dates!
"""

import httpx
import json
from datetime import datetime, timedelta
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

def resolve_date(date_str: str) -> str:
    """Resolve 'today', 'tomorrow', 'next', or 'YYYY-MM-DD'."""
    s = str(date_str).lower().strip()
    now = datetime.now()
    if s in ("today", ""):
        return now.strftime("%Y-%m-%d")
    elif s in ("tomorrow", "tmrw"):
        return (now + timedelta(days=1)).strftime("%Y-%m-%d")
    elif s in ("next", "day_after", "day after tomorrow"):
        return (now + timedelta(days=2)).strftime("%Y-%m-%d")
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return s
    except Exception:
        return now.strftime("%Y-%m-%d")

def get_remote_state() -> dict:
    """Fetch user state from Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/user_discipline_state?user_id=eq.{USER_ID}&select=state"
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, headers=HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            if data and len(data) > 0 and "state" in data[0]:
                state = data[0]["state"]
                if "routinesByDate" not in state:
                    state["routinesByDate"] = {}
                return state
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "routines": [],
        "routinesByDate": {}
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
def get_routines(date: str = "today") -> str:
    """
    Get the routine schedule for today, tomorrow, or a specific date.
    
    Args:
        date: 'today', 'tomorrow', 'next', or 'YYYY-MM-DD' (defaults to 'today')
    """
    target_date = resolve_date(date)
    state = get_remote_state()
    routines_map = state.get("routinesByDate", {})
    routines = routines_map.get(target_date, state.get("routines", []))
    
    if not routines:
        return f"No routines currently configured for {target_date} in Routine Tracker."
    
    lines = [f"Routines for {target_date} ({len(routines)} items):"]
    for idx, r in enumerate(routines, 1):
        status = "[x]" if r.get("done") else "[ ]"
        cat = f" [{r.get('category')}]" if r.get("category") else ""
        lines.append(f"{idx}. {status} {r.get('time')} - {r.get('title')}{cat} (ID: {r.get('id')})")
    
    return "\n".join(lines)

@mcp.tool()
def add_routine(time: str, title: str, category: str = "", date: str = "today") -> str:
    """
    Add a single routine item to today, tomorrow, or a future date.
    
    Args:
        time: Time string, e.g. "06:00 AM" or "07:00 AM - 08:30 AM"
        title: What to do, e.g. "Study SQL Window Functions & CTEs"
        category: Optional tag, e.g. "SQL", "ML", "Routine", "Interview"
        date: 'today', 'tomorrow', 'next', or 'YYYY-MM-DD'
    """
    target_date = resolve_date(date)
    state = get_remote_state()
    routines_map = state.setdefault("routinesByDate", {})
    routines = routines_map.setdefault(target_date, list(state.get("routines", [])))
    
    item_id = f"rt-{int(datetime.now().timestamp() * 1000)}"
    new_item = {
        "id": item_id,
        "time": time,
        "title": title,
        "category": category,
        "done": False
    }
    routines.append(new_item)
    routines_map[target_date] = routines
    if target_date == datetime.now().strftime("%Y-%m-%d"):
        state["routines"] = routines
    
    success = save_remote_state(state)
    if success:
        return f"Added routine '{time} - {title}' to {target_date} successfully!"
    return "Failed to save to Supabase."

@mcp.tool()
def set_full_routine(routines: list[dict], date: str = "today") -> str:
    """
    Set or replace the entire routine schedule for today, tomorrow, or a specific date.
    Use this when the user asks Claude to design or plan their daily schedule.
    
    Args:
        routines: List of dicts with 'time', 'title', optional 'category'
        date: 'today', 'tomorrow', 'next', or 'YYYY-MM-DD'
    """
    target_date = resolve_date(date)
    state = get_remote_state()
    routines_map = state.setdefault("routinesByDate", {})
    
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
    
    routines_map[target_date] = new_routines
    if target_date == datetime.now().strftime("%Y-%m-%d"):
        state["routines"] = new_routines
    
    success = save_remote_state(state)
    if success:
        return f"Successfully set {len(new_routines)} routines for {target_date}! Live in app now."
    return "Failed to update Supabase."

@mcp.tool()
def toggle_routine(title_or_id: str, done: bool = True, date: str = "today") -> str:
    """
    Mark a routine item as done or undone for a specific date.
    """
    target_date = resolve_date(date)
    state = get_remote_state()
    routines_map = state.get("routinesByDate", {})
    routines = routines_map.get(target_date, state.get("routines", []))
    
    found = False
    for r in routines:
        if r.get("id") == title_or_id or title_or_id.lower() in r.get("title", "").lower():
            r["done"] = done
            found = True
            break
            
    if not found:
        return f"Could not find a routine matching '{title_or_id}' on {target_date}."
        
    routines_map[target_date] = routines
    state["routinesByDate"] = routines_map
    if target_date == datetime.now().strftime("%Y-%m-%d"):
        state["routines"] = routines
        
    save_remote_state(state)
    status_str = "completed" if done else "uncompleted"
    return f"Routine '{title_or_id}' on {target_date} marked as {status_str}."

@mcp.tool()
def clear_all_routines(date: str = "today") -> str:
    """
    Clear all routines for a specific date (today, tomorrow, or YYYY-MM-DD).
    """
    target_date = resolve_date(date)
    state = get_remote_state()
    routines_map = state.setdefault("routinesByDate", {})
    routines_map[target_date] = []
    state["routinesByDate"] = routines_map
    if target_date == datetime.now().strftime("%Y-%m-%d"):
        state["routines"] = []
    save_remote_state(state)
    return f"All routines cleared for {target_date}."

if __name__ == "__main__":
    mcp.run()
