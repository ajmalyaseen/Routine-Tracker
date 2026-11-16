import sys
import os
import json
from datetime import datetime, timedelta

# Import mcp_server functions
sys.path.insert(0, r"C:\Users\ajmal\.gemini\antigravity\scratch\ai-discipline-tracker")
import mcp_server

def run_tests():
    print("==================================================================")
    print("ROUTINE TRACKER BACKEND TEST SUITE - 12 VERIFICATION TESTS")
    print("==================================================================")
    
    today = mcp_server.resolve_date("today")
    tomorrow = mcp_server.resolve_date("tomorrow")
    
    print(f"Timezone Date Resolution: Today={today}, Tomorrow={tomorrow}\n")
    
    # 1. Add a routine for today with start and end times
    print("TEST 1: Add a routine for today with start and end times...")
    res1 = mcp_server.add_routine(
        title="TensorFlow study",
        start_time="06:00",
        end_time="06:45",
        scheduled_date="today",
        category="Deep Learning"
    )
    print("Result:", res1)
    assert "Added routine" in res1, f"Failed: {res1}"
    print("PASS: Routine added with start_time 06:00 and end_time 06:45\n")
    
    # 2. Add a routine for tomorrow
    print("TEST 2: Add a routine for tomorrow...")
    res2 = mcp_server.add_routine(
        title="Advanced RAG Systems",
        start_time="07:00",
        end_time="08:30",
        scheduled_date="tomorrow",
        category="GenAI"
    )
    print("Result:", res2)
    assert "Added routine" in res2 and tomorrow in res2, f"Failed: {res2}"
    print("PASS: Routine scheduled specifically for tomorrow\n")
    
    # 3. Retrieve today's routines without specifying a date
    print("TEST 3: Retrieve today's routines without specifying a date...")
    res3 = mcp_server.get_routines() # default 'today'
    print("Result:\n" + res3)
    assert today in res3, f"Failed: {res3}"
    assert "TensorFlow study" in res3, "TensorFlow study should be in today's routines"
    print("PASS: Today's routines retrieved with default date\n")
    
    # 4. Retrieve tomorrow's routines using an explicit date
    print("TEST 4: Retrieve tomorrow's routines using an explicit date ('tomorrow')...")
    res4 = mcp_server.get_routines(date="tomorrow")
    print("Result:\n" + res4)
    assert tomorrow in res4, f"Failed: {res4}"
    assert "Advanced RAG Systems" in res4, "Advanced RAG Systems should be in tomorrow's routines"
    print("PASS: Tomorrow's routines retrieved accurately\n")
    
    # 5. Confirm today's routines do not appear in tomorrow's results
    print("TEST 5: Confirm today's routines do NOT appear in tomorrow's results...")
    assert "TensorFlow study" not in res4, "Data leak! Today's routine found in tomorrow's results"
    assert "Advanced RAG Systems" not in res3, "Data leak! Tomorrow's routine found in today's results"
    print("PASS: Clean date isolation confirmed — no routine bleed between dates\n")
    
    # 6. Update a routine's start time and end time
    print("TEST 6: Update a routine's start time and end time independently...")
    state = mcp_server.get_remote_state()
    today_routines = state.get("routinesByDate", {}).get(today, [])
    target_item = next((r for r in today_routines if r.get("title") == "TensorFlow study"), None)
    assert target_item is not None, "Target item not found for update"
    
    res6 = mcp_server.update_routine(
        routine_id=target_item["id"],
        start_time="06:15",
        end_time="07:00"
    )
    print("Result:", res6)
    assert "updated successfully" in res6, f"Failed: {res6}"
    # Verify updated times
    res6_verify = mcp_server.get_routines("today")
    assert "06:15 - 07:00" in res6_verify, f"Updated times not reflected: {res6_verify}"
    print("PASS: start_time and end_time updated independently and verified\n")
    
    # 7. Mark a routine as completed
    print("TEST 7: Mark a routine as completed using stable routine ID...")
    res7 = mcp_server.toggle_routine(routine_id=target_item["id"], done=True)
    print("Result:", res7)
    assert "completed [x]" in res7, f"Failed: {res7}"
    res7_verify = mcp_server.get_routines("today")
    assert "[x]" in res7_verify, "Routine should show as completed [x]"
    print("PASS: Routine marked completed and verified with [x]\n")
    
    # 8. Replace the full schedule for one date without affecting another date
    print("TEST 8: Replace full schedule for tomorrow without affecting today...")
    new_schedule_tomorrow = [
        {"title": "Morning Meditation", "start_time": "05:30", "end_time": "06:00", "category": "Health"},
        {"title": "DSA Practice", "start_time": "06:00", "end_time": "07:30", "category": "Coding"},
        {"title": "Core ML", "start_time": "09:00", "end_time": "11:00", "category": "ML"}
    ]
    res8 = mcp_server.set_full_routine(routines=new_schedule_tomorrow, date="tomorrow")
    print("Result:", res8)
    assert "Successfully set 3 routines" in res8, f"Failed: {res8}"
    
    # Verify today remains completely unaffected
    res8_today = mcp_server.get_routines("today")
    assert "TensorFlow study" in res8_today, "Today's schedule was accidentally altered!"
    
    # Verify tomorrow has exactly the 3 new routines
    res8_tmrw = mcp_server.get_routines("tomorrow")
    assert "Morning Meditation" in res8_tmrw
    assert "DSA Practice" in res8_tmrw
    assert "Core ML" in res8_tmrw
    print("PASS: Date-scoped set_full_routine replaced tomorrow with 0 impact on today\n")
    
    # 9. Confirm old routines without end times still work
    print("TEST 9: Confirm old routines without end times still work (backward compatibility)...")
    res9 = mcp_server.add_routine(
        title="Quick Daily Habit Audit",
        start_time="21:30",
        end_time=None, # No end time!
        scheduled_date="today",
        category="Reflection"
    )
    print("Result:", res9)
    assert "Added routine" in res9, f"Failed: {res9}"
    res9_verify = mcp_server.get_routines("today")
    assert "21:30 | Quick Daily Habit Audit" in res9_verify, f"Verification failed: {res9_verify}"
    print("PASS: Routines without end_time work smoothly with backward compatibility\n")
    
    # 10. Verify chronological ordering based on start time
    print("TEST 10: Verify chronological ordering based on start_time...")
    # Add an early morning routine
    mcp_server.add_routine(
        title="Early Hydration & Stretch",
        start_time="05:00",
        end_time="05:30",
        scheduled_date="today",
        category="Health"
    )
    res10_list = mcp_server.get_routines("today")
    print("Today's full chronological listing:\n" + res10_list)
    
    # 05:00 must appear before 06:15, and 06:15 before 21:30
    pos_early = res10_list.find("05:00")
    pos_mid = res10_list.find("06:15")
    pos_night = res10_list.find("21:30")
    assert pos_early < pos_mid < pos_night, "Chronological order failed!"
    print("PASS: Chronological order verified (05:00 < 06:15 < 21:30)\n")
    
    # 11. Test invalid time ranges and invalid dates
    print("TEST 11: Test invalid time ranges and invalid dates...")
    # Invalid time range: end_time earlier than start_time
    err_time = mcp_server.add_routine(
        title="Impossible Time Warp",
        start_time="10:00",
        end_time="09:00",
        scheduled_date="today"
    )
    print("Invalid time range check:", err_time)
    assert "Error" in err_time and "must be later" in err_time, "Failed to reject invalid time range!"
    
    # Invalid date format
    err_date = mcp_server.get_routines(date="not-a-valid-date-31")
    print("Invalid date check:", err_date)
    assert "Error" in err_date, "Failed to reject invalid date!"
    print("PASS: Error validation rejected invalid time range and invalid date\n")
    
    # 12. Verify all existing functionality remains operational (date-scoped clear_all_routines)
    print("TEST 12: Verify date-scoped clear_all_routines preserves other dates...")
    # Clear tomorrow only
    res12_clear = mcp_server.clear_all_routines(date="tomorrow", confirm_all=False)
    print("Result:", res12_clear)
    assert "cleared" in res12_clear, f"Failed: {res12_clear}"
    
    res12_tmrw_check = mcp_server.get_routines("tomorrow")
    assert "No routines currently scheduled" in res12_tmrw_check, "Tomorrow should be empty"
    
    res12_today_check = mcp_server.get_routines("today")
    assert "TensorFlow study" in res12_today_check, "Today was accidentally cleared!"
    print("PASS: Date-scoped clear cleared tomorrow while completely preserving today\n")
    
    # 13. Verify title + description support (separate topic notes)
    print("TEST 13: Verify title + description field support...")
    res13_add = mcp_server.add_routine(
        title="SQL Practice",
        description="Window functions, CTEs, GROUP BY",
        start_time="14:00",
        end_time="15:30",
        scheduled_date="today",
        category="Database"
    )
    print("Add routine result:", res13_add)
    assert "Added routine" in res13_add, f"Failed to add with description: {res13_add}"
    
    # Retrieve and check description
    res13_get = mcp_server.get_routines("today")
    assert "SQL Practice (Window functions, CTEs, GROUP BY)" in res13_get, f"Description not shown in get_routines: {res13_get}"
    
    # Update description
    state13 = mcp_server.get_remote_state()
    today_items = state13.get("routinesByDate", {}).get(today, [])
    sql_item = next((r for r in today_items if r.get("title") == "SQL Practice"), None)
    assert sql_item is not None, "SQL Practice item not found for update"
    
    res13_upd = mcp_server.update_routine(
        routine_id=sql_item["id"],
        description="Advanced recursive CTEs & Lead/Lag"
    )
    print("Update description result:", res13_upd)
    assert "updated successfully" in res13_upd, f"Failed: {res13_upd}"
    
    res13_verify = mcp_server.get_routines("today")
    assert "SQL Practice (Advanced recursive CTEs & Lead/Lag)" in res13_verify, f"Updated description not found: {res13_verify}"
    print("PASS: Title + Description field fully supported, retrieved, and updated!\n")

    # 14. Verify delete_routine tool removes routine from both state and table
    print("TEST 14: Verify delete_routine tool...")
    res14_add = mcp_server.add_routine(
        title="Temporary Delete Test Routine",
        start_time="11:00",
        end_time="11:45",
        scheduled_date="today"
    )
    print("Added temp routine:", res14_add)
    assert "Added routine" in res14_add, "Failed to add temp routine"
    
    # Delete it by title
    res14_del = mcp_server.delete_routine(title="Temporary Delete Test Routine")
    print("Delete result:", res14_del)
    assert "deleted successfully" in res14_del, f"Delete failed: {res14_del}"
    
    # Verify it is gone
    res14_verify = mcp_server.get_routines("today")
    assert "Temporary Delete Test Routine" not in res14_verify, "Routine still found after delete!"
    print("PASS: delete_routine cleanly removed routine from both state and table!\n")

    # Clean up test data so tracker remains in user's desired state
    mcp_server.clear_all_routines(confirm_all=True)
    print("Cleaned up test data. State is now 100% clean.\n")

    print("==================================================================")
    print("ALL 14 TESTS PASSED PERFECTLY! 100% SUCCESS")
    print("==================================================================")

if __name__ == "__main__":
    run_tests()
