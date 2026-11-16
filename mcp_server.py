"""
Routine Tracker - FastMCP Server for Claude Desktop & Antigravity
Full Date Support (scheduled_date) + Start & End Times (HH:MM) in Asia/Kolkata timezone.
"""

import httpx
import json
import re
from datetime import datetime, timedelta
import zoneinfo
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

def get_kolkata_now():
    try:
        return datetime.now(zoneinfo.ZoneInfo("Asia/Kolkata"))
    except Exception:
        return datetime.utcnow() + timedelta(hours=5, minutes=30)

def resolve_date(date_str: str = "today") -> str:
    """Resolve 'today', 'tomorrow', 'yesterday', or 'YYYY-MM-DD' in Asia/Kolkata."""
    s = str(date_str or "today").lower().strip()
    now = get_kolkata_now()
    if s in ("today", ""):
        return now.strftime("%Y-%m-%d")
    elif s in ("tomorrow", "tmrw"):
        return (now + timedelta(days=1)).strftime("%Y-%m-%d")
    elif s in ("yesterday",):
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")
    elif s in ("next", "day_after", "day after tomorrow"):
        return (now + timedelta(days=2)).strftime("%Y-%m-%d")
    
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.strftime("%Y-%m-%d")
    except Exception:
        raise ValueError(f"Invalid date format '{date_str}'. Expected 'YYYY-MM-DD', 'today', or 'tomorrow'.")

def normalize_time(time_str: str | None) -> str | None:
    """Normalizes any time string to 24-hour HH:MM format."""
    if not time_str or not str(time_str).strip():
        return None
    s = str(time_str).strip().upper()
    s = re.sub(r"\s*\([^)]*\)", "", s).strip()
    
    is_pm = "PM" in s
    is_am = "AM" in s
    clean = re.sub(r"[APM\s]", "", s)
    parts = clean.split(":")
    if not parts or not parts[0].isdigit():
        return None
    
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    
    if is_pm and h < 12:
        h += 12
    if is_am and h == 12:
        h = 0
        
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError(f"Invalid time values in '{time_str}'. Hours must be 0-23, minutes 0-59.")
        
    return f"{h:02d}:{m:02d}"

def validate_time_range(start_24: str, end_24: str | None = None):
    if not start_24:
        raise ValueError("start_time is required.")
    if end_24:
        if end_24 <= start_24:
            raise ValueError(f"Invalid time range: end_time ('{end_24}') must be later than start_time ('{start_24}').")

def format_12h(time_24: str | None) -> str:
    if not time_24:
        return ""
    try:
        parts = time_24.split(":")
        h = int(parts[0])
        m = parts[1] if len(parts) > 1 else "00"
        ampm = "PM" if h >= 12 else "AM"
        h = h % 12
        if h == 0:
            h = 12
        return f"{h:02d}:{m} {ampm}"
    except Exception:
        return time_24

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
    today = get_kolkata_now().strftime("%Y-%m-%d")
    return {"date": today, "routines": [], "routinesByDate": {}}

def save_remote_state(state: dict) -> bool:
    """Upsert state to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/user_discipline_state"
    payload = {
        "user_id": USER_ID,
        "state": state,
        "updated_at": datetime.utcnow().isoformat()
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
    Get the routine schedule for today, tomorrow, or a specific date in chronological order.
    
    Args:
        date: 'today', 'tomorrow', 'yesterday', or 'YYYY-MM-DD' (defaults to 'today' in Asia/Kolkata)
    """
    try:
        target_date = resolve_date(date)
    except Exception as e:
        return f"Error: {e}"
        
    state = get_remote_state()
    routines_map = state.get("routinesByDate", {})
    routines = routines_map.get(target_date, [])
    
    if not routines and target_date == state.get("date"):
        routines = state.get("routines", [])
        
    if not routines:
        return f"No routines currently scheduled for {target_date} in Routine Tracker."
    
    # Sort chronologically by start_time
    def sort_key(r):
        st = r.get("start_time")
        if not st and r.get("time"):
            st = normalize_time(r.get("time").split("-")[0])
        return st or "08:00"
        
    routines.sort(key=sort_key)
    
    lines = [f"Routines for {target_date} ({len(routines)} items, chronological):"]
    for idx, r in enumerate(routines, 1):
        status = "[x]" if r.get("done") else "[ ]"
        s_time = r.get("start_time") or normalize_time(r.get("time", "").split("-")[0]) or "08:00"
        e_time = r.get("end_time") or (normalize_time(r.get("time", "").split("-")[1]) if "-" in r.get("time", "") else None)
        time_str = f"{s_time} - {e_time}" if e_time else s_time
        cat = f" [{r.get('category')}]" if r.get("category") else ""
        lines.append(f"{idx}. {status} {time_str} | {r.get('title')}{cat} (ID: {r.get('id')}, Date: {target_date})")
    
    return "\n".join(lines)

@mcp.tool()
def add_routine(
    title: str,
    start_time: str = "08:00",
    end_time: str | None = None,
    scheduled_date: str = "today",
    category: str = "General",
    time: str | None = None,
    date: str | None = None
) -> str:
    """
    Add a single routine item with start_time and optional end_time for today, tomorrow, or a specific date.
    
    Args:
        title: What to do, e.g. "TensorFlow study"
        start_time: Start time in 24h format "HH:MM" (e.g. "06:00")
        end_time: Optional end time in 24h format "HH:MM" (e.g. "06:45")
        scheduled_date: 'today', 'tomorrow', or 'YYYY-MM-DD'
        category: Optional tag, e.g. "Deep Learning", "Project"
    """
    try:
        target_date = resolve_date(date or scheduled_date)
        raw_start = start_time
        raw_end = end_time
        
        if time and not raw_start:
            if "-" in time:
                parts = time.split("-")
                raw_start = parts[0].strip()
                raw_end = parts[1].strip()
            else:
                raw_start = time.strip()
                
        s_time = normalize_time(raw_start) or "08:00"
        e_time = normalize_time(raw_end) if raw_end else None
        validate_time_range(s_time, e_time)
    except Exception as e:
        return f"Error: {e}"
        
    state = get_remote_state()
    routines_map = state.setdefault("routinesByDate", {})
    routines = routines_map.setdefault(target_date, [])
    
    item_id = f"rt-{int(datetime.now().timestamp() * 1000)}"
    time_display = f"{format_12h(s_time)} - {format_12h(e_time)}" if e_time else format_12h(s_time)
    
    new_item = {
        "id": item_id,
        "title": title.strip(),
        "start_time": s_time,
        "end_time": e_time,
        "time": time_display,
        "scheduled_date": target_date,
        "category": category.strip() or "General",
        "done": False
    }
    
    routines.append(new_item)
    routines.sort(key=lambda r: r.get("start_time", "08:00"))
    routines_map[target_date] = routines
    
    if target_date == state.get("date"):
        state["routines"] = routines
        
    save_remote_state(state)
    time_out = f"{s_time} - {e_time}" if e_time else s_time
    return f"Added routine '{time_out} | {title}' to {target_date} successfully! (ID: {item_id})"

@mcp.tool()
def update_routine(
    routine_id: str,
    start_time: str | None = None,
    end_time: str | None = None,
    title: str | None = None,
    category: str | None = None,
    scheduled_date: str | None = None
) -> str:
    """
    Update an existing routine's start_time, end_time, title, or category independently using its ID.
    """
    state = get_remote_state()
    routines_map = state.get("routinesByDate", {})
    
    found_item = None
    found_date = None
    
    for d, r_list in routines_map.items():
        for r in r_list:
            if r.get("id") == routine_id:
                found_item = r
                found_date = d
                break
        if found_item:
            break
            
    if not found_item:
        return f"Error: Routine with ID '{routine_id}' not found."
        
    try:
        cur_start = found_item.get("start_time") or "08:00"
        cur_end = found_item.get("end_time")
        
        if start_time is not None:
            cur_start = normalize_time(start_time) or cur_start
        if end_time is not None:
            cur_end = normalize_time(end_time) if end_time else None
            
        validate_time_range(cur_start, cur_end)
        
        found_item["start_time"] = cur_start
        found_item["end_time"] = cur_end
        found_item["time"] = f"{format_12h(cur_start)} - {format_12h(cur_end)}" if cur_end else format_12h(cur_start)
        
        if title is not None:
            found_item["title"] = str(title).strip()
        if category is not None:
            found_item["category"] = str(category).strip()
            
        if scheduled_date:
            new_date = resolve_date(scheduled_date)
            if new_date != found_date:
                routines_map[found_date] = [r for r in routines_map[found_date] if r.get("id") != routine_id]
                found_item["scheduled_date"] = new_date
                routines_map.setdefault(new_date, []).append(found_item)
                routines_map[new_date].sort(key=lambda r: r.get("start_time", "08:00"))
                found_date = new_date
                
        routines_map[found_date].sort(key=lambda r: r.get("start_time", "08:00"))
        state["routinesByDate"] = routines_map
        if found_date == state.get("date"):
            state["routines"] = routines_map[found_date]
            
        save_remote_state(state)
        return f"Routine '{routine_id}' updated successfully. (Date: {found_date}, Time: {cur_start} - {cur_end or 'none'}, Title: '{found_item.get('title')}')"
    except Exception as e:
        return f"Error: {e}"

@mcp.tool()
def set_full_routine(routines: list[dict], date: str = "today") -> str:
    """
    Replace the entire routine schedule only for the specified date. Other dates remain untouched.
    """
    try:
        target_date = resolve_date(date)
    except Exception as e:
        return f"Error: {e}"
        
    state = get_remote_state()
    routines_map = state.setdefault("routinesByDate", {})
    
    new_routines = []
    base_ts = int(datetime.now().timestamp() * 1000)
    
    for idx, item in enumerate(routines):
        raw_start = item.get("start_time")
        raw_end = item.get("end_time")
        if not raw_start and item.get("time"):
            if "-" in item.get("time"):
                parts = item.get("time").split("-")
                raw_start = parts[0].strip()
                raw_end = parts[1].strip()
            else:
                raw_start = item.get("time").strip()
                
        s_time = normalize_time(raw_start) or "08:00"
        e_time = normalize_time(raw_end) if raw_end else None
        
        try:
            validate_time_range(s_time, e_time)
        except Exception:
            e_time = None
            
        time_display = f"{format_12h(s_time)} - {format_12h(e_time)}" if e_time else format_12h(s_time)
        
        new_routines.append({
            "id": item.get("id") or f"rt-{base_ts}-{idx}",
            "title": item.get("title", f"Routine {idx+1}"),
            "start_time": s_time,
            "end_time": e_time,
            "time": time_display,
            "scheduled_date": target_date,
            "category": item.get("category", "General"),
            "done": bool(item.get("done", False))
        })
        
    new_routines.sort(key=lambda r: r.get("start_time", "08:00"))
    routines_map[target_date] = new_routines
    
    if target_date == state.get("date"):
        state["routines"] = new_routines
        
    success = save_remote_state(state)
    if success:
        return f"Successfully set {len(new_routines)} routines for {target_date} in chronological order! Other dates preserved."
    return "Failed to update Supabase."

@mcp.tool()
def toggle_routine(routine_id: str, done: bool = True, date: str | None = None, title_or_id: str | None = None) -> str:
    """
    Mark a routine item as done or undone using its stable routine ID.
    """
    target_id = routine_id or title_or_id
    if not target_id:
        return "Error: routine_id is required."
        
    state = get_remote_state()
    routines_map = state.get("routinesByDate", {})
    
    found_item = None
    found_date = None
    
    dates_to_search = [resolve_date(date)] if date else list(routines_map.keys())
    for d in dates_to_search:
        for r in routines_map.get(d, []):
            if r.get("id") == target_id or target_id.lower() in r.get("title", "").lower():
                found_item = r
                found_date = d
                break
        if found_item:
            break
            
    if not found_item:
        return f"Error: Could not find a routine matching '{target_id}'."
        
    found_item["done"] = bool(done)
    state["routinesByDate"] = routines_map
    if found_date == state.get("date"):
        state["routines"] = routines_map[found_date]
        
    save_remote_state(state)
    status_str = "completed [x]" if done else "uncompleted [ ]"
    return f"Routine '{found_item.get('title')}' (ID: {found_item.get('id')}, Date: {found_date}) marked as {status_str}."

@mcp.tool()
def clear_all_routines(date: str = "today", confirm_all: bool = False) -> str:
    """
    Clear routines for a specific date (date-scoped). Only clears all dates if confirm_all is True.
    """
    state = get_remote_state()
    if confirm_all:
        today = get_kolkata_now().strftime("%Y-%m-%d")
        state["routinesByDate"] = {}
        state["routines"] = []
        save_remote_state(state)
        return "All routines across all dates have been permanently cleared."
        
    try:
        target_date = resolve_date(date)
    except Exception as e:
        return f"Error: {e}"
        
    routines_map = state.setdefault("routinesByDate", {})
    routines_map[target_date] = []
    if target_date == state.get("date"):
        state["routines"] = []
    save_remote_state(state)
    return f"Routines for {target_date} cleared. Other dates safely preserved."

if __name__ == "__main__":
    mcp.run()
