import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://gwrrlipcjhhrwjjjkuby.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3cnJsaXBjamhocndqamprdWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MTQ0OTYsImV4cCI6MjExMDM5MDQ5Nn0.B0-Eg4YOMyRe7rQNdOl_-xYtw6G6S9TKdX45KNvngHQ";
const USER_ID = "routine-master-user";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ==============================================================================
// TIMEZONE & DATE / TIME / DURATION UTILITIES (Asia/Kolkata)
// ==============================================================================

function getTodayKolkata(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (_) {
    return new Date().toISOString().split("T")[0];
  }
}

function resolveDate(dateInput?: string): string {
  const today = getTodayKolkata();
  if (!dateInput || dateInput.toLowerCase().trim() === "today" || dateInput.trim() === "") {
    return today;
  }
  const s = dateInput.toLowerCase().trim();
  if (s === "tomorrow" || s === "tmrw") {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  if (s === "yesterday") {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }
  if (s === "next" || s === "day_after" || s === "day after tomorrow") {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() + 2);
    return d.toISOString().split("T")[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00");
    if (!isNaN(d.getTime())) {
      return s;
    }
  }
  throw new Error(`Invalid date format '${dateInput}'. Expected YYYY-MM-DD, 'today', or 'tomorrow'.`);
}

function normalizeTo24HourTime(timeStr?: string | null): string | null {
  if (!timeStr || typeof timeStr !== "string" || timeStr.trim() === "") {
    return null;
  }
  const clean = timeStr.trim().replace(/\s*\([^)]*\)/g, "").trim();
  const ampmMatch = clean.match(/(am|pm)/i);
  const isPM = ampmMatch && ampmMatch[1].toLowerCase() === "pm";
  const isAM = ampmMatch && ampmMatch[1].toLowerCase() === "am";

  const numPart = clean.replace(/(am|pm)/gi, "").trim();
  const parts = numPart.split(":");
  if (parts.length < 1) return null;

  let h = parseInt(parts[0], 10);
  const m = parts.length > 1 ? parseInt(parts[1], 10) : 0;

  if (isNaN(h) || isNaN(m)) return null;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time values in '${timeStr}'. Hours must be 0-23, minutes 0-59.`);
  }

  const hStr = String(h).padStart(2, "0");
  const mStr = String(m).padStart(2, "0");
  return `${hStr}:${mStr}`;
}

function parseDurationToMinutes(dur?: string | number | null): number | null {
  if (dur === undefined || dur === null) return null;
  if (typeof dur === "number") return dur;
  const s = String(dur).trim().toLowerCase();
  if (!s) return null;

  if (/^\d+$/.test(s)) return parseInt(s, 10);

  let totalMinutes = 0;
  let matched = false;

  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/);
  if (hMatch) {
    totalMinutes += Math.round(parseFloat(hMatch[1]) * 60);
    matched = true;
  }

  const mMatch = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)/);
  if (mMatch) {
    totalMinutes += parseInt(mMatch[1], 10);
    matched = true;
  }

  if (matched && totalMinutes > 0) return totalMinutes;
  return null;
}

function calculateEndTime(start24: string, durationMinutes: number): string {
  const parts = start24.split(":");
  const startMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  const endMins = (startMins + durationMinutes) % 1440;
  const h = Math.floor(endMins / 60);
  const m = endMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function validateTimeRange(start24: string, end24?: string | null): void {
  if (!start24) {
    throw new Error("start_time is required.");
  }
  if (end24) {
    if (end24 <= start24) {
      throw new Error(`Invalid time range: end_time ('${end24}') must be later than start_time ('${start24}').`);
    }
  }
}

function to12HourDisplay(time24?: string | null): string {
  if (!time24) return "";
  const parts = time24.split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

// ==============================================================================
// DATABASE ACCESS & DUAL STORAGE
// ==============================================================================

interface RoutineRecord {
  id: string;
  user_id?: string;
  title: string;
  description?: string;
  category: string;
  scheduled_date: string;
  start_time: string;
  end_time: string | null;
  duration?: string | null;
  time?: string;
  done: boolean;
  created_at?: string;
  updated_at?: string;
}

async function hasRoutinesTable(): Promise<boolean> {
  try {
    const { error } = await supabase.from("routines").select("id").limit(1);
    return !error;
  } catch (_) {
    return false;
  }
}

async function fetchRoutinesForDate(targetDate: string): Promise<RoutineRecord[]> {
  const { data: stateData } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const state = stateData?.state;
  const stateList = state?.routinesByDate?.[targetDate] ?? (targetDate === state?.date ? state?.routines : null);

  const useTable = await hasRoutinesTable();
  if (useTable) {
    const { data: tableRows, error } = await supabase
      .from("routines")
      .select("*")
      .eq("user_id", USER_ID)
      .eq("scheduled_date", targetDate)
      .order("start_time", { ascending: true });

    if (!error && Array.isArray(tableRows)) {
      // Self-healing: If user deleted all routines in web app (stateList is empty array)
      // but table has stale zombie rows, purge the table for this date
      if (Array.isArray(stateList) && stateList.length === 0 && tableRows.length > 0) {
        await supabase.from("routines").delete().eq("user_id", USER_ID).eq("scheduled_date", targetDate);
        return [];
      }

      if (tableRows.length > 0) {
        return tableRows.map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          title: r.title,
          description: r.description || "",
          category: r.category || "General",
          scheduled_date: r.scheduled_date,
          start_time: r.start_time ? r.start_time.substring(0, 5) : "08:00",
          end_time: r.end_time ? r.end_time.substring(0, 5) : null,
          time: r.end_time
            ? `${to12HourDisplay(r.start_time.substring(0, 5))} - ${to12HourDisplay(r.end_time.substring(0, 5))}`
            : to12HourDisplay(r.start_time.substring(0, 5)),
          done: Boolean(r.done),
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
      }
    }
  }

  if (!state) return [];
  const rawList = stateList || [];
  if (!Array.isArray(rawList)) return [];

  const list: RoutineRecord[] = rawList.map((item: any) => {
    let sTime = item.start_time ? normalizeTo24HourTime(item.start_time) : null;
    let eTime = item.end_time ? normalizeTo24HourTime(item.end_time) : null;

    if (!sTime && item.time) {
      if (item.time.includes("-")) {
        const segs = item.time.split("-");
        sTime = normalizeTo24HourTime(segs[0]);
        eTime = normalizeTo24HourTime(segs[1]);
      } else {
        sTime = normalizeTo24HourTime(item.time);
      }
    }

    sTime = sTime || "08:00";

    return {
      id: item.id || `rt-${Date.now()}`,
      user_id: USER_ID,
      title: item.title || "Untitled",
      description: item.description || "",
      category: item.category || "General",
      scheduled_date: targetDate,
      start_time: sTime,
      end_time: eTime,
      time: eTime ? `${to12HourDisplay(sTime)} - ${to12HourDisplay(eTime)}` : to12HourDisplay(sTime),
      done: Boolean(item.done),
    };
  });

  list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return list;
}

async function syncStateAndTable(targetDate: string, updatedListForDate: RoutineRecord[]): Promise<void> {
  updatedListForDate.sort((a, b) => a.start_time.localeCompare(b.start_time));

  const useTable = await hasRoutinesTable();
  if (useTable) {
    try {
      await supabase.from("routines").delete().eq("user_id", USER_ID).eq("scheduled_date", targetDate);

      if (updatedListForDate.length > 0) {
        const insertRows = updatedListForDate.map((r) => ({
          id: r.id,
          user_id: USER_ID,
          title: r.title,
          description: r.description || "",
          category: r.category || "General",
          scheduled_date: targetDate,
          start_time: r.start_time,
          end_time: r.end_time || null,
          done: Boolean(r.done),
          updated_at: new Date().toISOString(),
        }));
        await supabase.from("routines").insert(insertRows);
      }
    } catch (e) {
      console.error("Relational table sync error:", e);
    }
  }

  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const today = getTodayKolkata();
  const state = data?.state || { date: today, routines: [], routinesByDate: {} };
  if (!state.routinesByDate || typeof state.routinesByDate !== "object") {
    state.routinesByDate = {};
  }

  const appList = updatedListForDate.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description || "",
    category: r.category,
    scheduled_date: targetDate,
    start_time: r.start_time,
    end_time: r.end_time,
    time: r.end_time
      ? `${to12HourDisplay(r.start_time)} - ${to12HourDisplay(r.end_time)}`
      : to12HourDisplay(r.start_time),
    done: r.done,
  }));

  state.routinesByDate[targetDate] = appList;

  if (targetDate === (state.date || today)) {
    state.routines = appList;
  }

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });
}

// ==============================================================================
// MCP TOOL DEFINITIONS (JSON-RPC 2.0)
// ==============================================================================

const TOOLS = [
  {
    name: "get_routines",
    description:
      "Retrieve routines for a requested date in chronological order. If date is omitted, defaults to today in Asia/Kolkata timezone. Returns start_time, end_time, scheduled_date, category, ID, and completion status.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Optional calendar date: 'today', 'tomorrow', 'yesterday', or 'YYYY-MM-DD'. Defaults to today in Asia/Kolkata.",
        },
      },
      required: [],
    },
  },
  {
    name: "add_routine",
    description:
      "Create a new routine. Supports date (scheduled_date), start_time, end_time, duration, title, and category.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Routine title or task description (e.g. 'TensorFlow study', 'Revision', 'Data Science class')",
        },
        description: {
          type: "string",
          description: "Optional description or specific topic names, e.g. 'Window functions, CTEs, GROUP BY' or 'Loss functions, Backprop'.",
        },
        date: {
          type: "string",
          description: "Calendar date for routine: 'today', 'tomorrow', 'yesterday', or 'YYYY-MM-DD'. Defaults to today.",
        },
        scheduled_date: {
          type: "string",
          description: "Alias for date.",
        },
        start_time: {
          type: "string",
          description: "Start time in 24-hour 'HH:MM' (e.g. '06:00', '09:30', '17:30') or 12-hour format.",
        },
        end_time: {
          type: "string",
          description: "Optional end time in 24-hour 'HH:MM' format (e.g. '06:45', '11:30', '19:00'). Must be later than start_time.",
        },
        duration: {
          type: "string",
          description: "Duration of the task, e.g. '45m', '1h', '1.5h', '30 mins'. If provided, end_time is automatically calculated from start_time + duration.",
        },
        category: {
          type: "string",
          description: "Optional category tag, e.g. 'Deep Learning', 'Backend', 'Project', 'Revision', 'Class'.",
        },
        time: {
          type: "string",
          description: "Alternative legacy time string, e.g. '06:00 - 06:45' or '06:00 AM'.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_routine",
    description:
      "Update an existing routine's start_time, end_time, duration, title, category, or date independently using its stable ID.",
    inputSchema: {
      type: "object",
      properties: {
        routine_id: {
          type: "string",
          description: "Stable ID of the routine to update (e.g. 'rt-1794834149828-0')",
        },
        date: {
          type: "string",
          description: "Date of the routine ('today', 'tomorrow', or 'YYYY-MM-DD').",
        },
        scheduled_date: {
          type: "string",
          description: "Alias for date.",
        },
        start_time: {
          type: "string",
          description: "Updated start time in 'HH:MM' format.",
        },
        end_time: {
          type: "string",
          description: "Updated end time in 'HH:MM' format. Must be later than start_time.",
        },
        duration: {
          type: "string",
          description: "Updated duration (e.g. '45m', '1h').",
        },
        title: {
          type: "string",
          description: "Updated routine title.",
        },
        description: {
          type: "string",
          description: "Updated description or topic names.",
        },
        category: {
          type: "string",
          description: "Updated category tag.",
        },
      },
      required: ["routine_id"],
    },
  },
  {
    name: "set_full_routine",
    description:
      "Replace the routine schedule only for the specified date with a list of items. Supports date, start_time, end_time, duration, title, description, and category for each routine.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Target calendar date: 'today', 'tomorrow', or 'YYYY-MM-DD'. Defaults to today in Asia/Kolkata.",
        },
        routines: {
          type: "array",
          description: "List of routine items for the date.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string", description: "Optional description or specific topic names" },
              start_time: { type: "string", description: "Start time 'HH:MM'" },
              end_time: { type: "string", description: "End time 'HH:MM'" },
              duration: { type: "string", description: "Duration, e.g. '45m', '1h', '1.5h'" },
              date: { type: "string", description: "Date for this routine" },
              category: { type: "string" },
              done: { type: "boolean" },
            },
            required: ["title"],
          },
        },
      },
      required: ["routines"],
    },
  },
  {
    name: "toggle_routine",
    description: "Mark a routine item as completed or uncompleted using its stable routine ID.",
    inputSchema: {
      type: "object",
      properties: {
        routine_id: {
          type: "string",
          description: "Stable ID of the routine to toggle.",
        },
        title_or_id: {
          type: "string",
          description: "Alias for routine_id, or title fallback if ID unknown.",
        },
        done: {
          type: "boolean",
          description: "True for completed, false for uncompleted. Defaults to true.",
        },
        date: {
          type: "string",
          description: "Optional date scope: 'today', 'tomorrow', or 'YYYY-MM-DD'.",
        },
      },
      required: [],
    },
  },
  {
    name: "delete_routine",
    description: "Delete a specific routine by routine_id or title. Removes it from both the schedule and database.",
    inputSchema: {
      type: "object",
      properties: {
        routine_id: {
          type: "string",
          description: "Stable ID of the routine to delete.",
        },
        title: {
          type: "string",
          description: "Title of the routine to delete if routine_id is unknown.",
        },
        date: {
          type: "string",
          description: "Optional calendar date scope: 'today', 'tomorrow', or 'YYYY-MM-DD'.",
        },
      },
      required: [],
    },
  },
  {
    name: "clear_all_routines",
    description:
      "Date-scoped routine deletion. Requires an explicit date ('today', 'tomorrow', or 'YYYY-MM-DD'). Never clears other dates unless confirm_all is explicitly true.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Specific calendar date to clear: 'today', 'tomorrow', or 'YYYY-MM-DD'.",
        },
        confirm_all: {
          type: "boolean",
          description: "Must be explicitly set to true to clear all routines across all dates.",
        },
      },
      required: [],
    },
  },
];

// ==============================================================================
// TOOL IMPLEMENTATION LOGIC
// ==============================================================================

async function handleGetRoutines(args: any) {
  const targetDate = resolveDate(args?.date);
  const routines = await fetchRoutinesForDate(targetDate);

  if (routines.length === 0) {
    return {
      message: `No routines currently scheduled for ${targetDate}.`,
      scheduled_date: targetDate,
      total: 0,
      routines: [],
    };
  }

  const lines = [
    `Routines for ${targetDate} (${routines.length} item${routines.length > 1 ? "s" : ""}, chronological):`,
  ];

  routines.forEach((r, idx) => {
    const status = r.done ? "[x]" : "[ ]";
    const timeDisplay = r.end_time ? `${r.start_time} - ${r.end_time}` : `${r.start_time}`;
    const cat = r.category ? ` [${r.category}]` : "";
    const desc = r.description ? ` (${r.description})` : "";
    lines.push(`${idx + 1}. ${status} ${timeDisplay} | ${r.title}${desc}${cat} (ID: ${r.id}, Date: ${r.scheduled_date})`);
  });

  return {
    formatted: lines.join("\n"),
    scheduled_date: targetDate,
    total: routines.length,
    routines,
  };
}

async function handleAddRoutine(args: any) {
  const title = args.title ? String(args.title).trim() : "";
  if (!title) {
    throw new Error("title is required.");
  }

  const targetDate = resolveDate(args.date || args.scheduled_date);

  let rawStart = args.start_time;
  let rawEnd = args.end_time;

  if (!rawStart && args.time) {
    const timeStr = String(args.time).trim();
    if (timeStr.includes("-")) {
      const parts = timeStr.split("-");
      rawStart = parts[0].trim();
      rawEnd = parts[1].trim();
    } else {
      rawStart = timeStr;
    }
  }

  if (!rawStart) {
    rawStart = "08:00";
  }

  const start_time = normalizeTo24HourTime(rawStart);
  if (!start_time) {
    throw new Error(`Invalid start_time format: '${rawStart}'.`);
  }

  // Handle duration to calculate end_time if end_time not provided
  let end_time = rawEnd ? normalizeTo24HourTime(rawEnd) : null;
  if (!end_time && args.duration) {
    const durMins = parseDurationToMinutes(args.duration);
    if (durMins && durMins > 0) {
      end_time = calculateEndTime(start_time, durMins);
    }
  }

  if (rawEnd && !end_time) {
    throw new Error(`Invalid end_time format: '${rawEnd}'.`);
  }

  validateTimeRange(start_time, end_time);

  const category = args.category ? String(args.category).trim() : "General";
  const description = args.description ? String(args.description).trim() : "";

  const newRoutine: RoutineRecord = {
    id: `rt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    user_id: USER_ID,
    title,
    description,
    category,
    scheduled_date: targetDate,
    start_time,
    end_time,
    duration: args.duration || null,
    done: false,
  };

  const existingList = await fetchRoutinesForDate(targetDate);
  existingList.push(newRoutine);

  await syncStateAndTable(targetDate, existingList);

  const timeDisplay = end_time ? `${start_time} - ${end_time}` : start_time;
  return {
    message: `Routine '${timeDisplay} | ${title}' added successfully for ${targetDate}.`,
    routine: newRoutine,
  };
}

async function handleUpdateRoutine(args: any) {
  const routineId = args.routine_id;
  if (!routineId) {
    throw new Error("routine_id is required.");
  }

  let targetDate = (args.date || args.scheduled_date) ? resolveDate(args.date || args.scheduled_date) : null;
  let foundRoutine: RoutineRecord | null = null;
  let foundDate = targetDate;

  if (targetDate) {
    const list = await fetchRoutinesForDate(targetDate);
    const item = list.find((r) => r.id === routineId);
    if (item) {
      foundRoutine = item;
      foundDate = targetDate;
    }
  } else {
    const today = getTodayKolkata();
    const candidateDates = [today, resolveDate("tomorrow"), resolveDate("yesterday")];

    const { data } = await supabase
      .from("user_discipline_state")
      .select("state")
      .eq("user_id", USER_ID)
      .single();

    if (data?.state?.routinesByDate) {
      Object.keys(data.state.routinesByDate).forEach((d) => {
        if (!candidateDates.includes(d)) candidateDates.push(d);
      });
    }

    for (const d of candidateDates) {
      const list = await fetchRoutinesForDate(d);
      const item = list.find((r) => r.id === routineId);
      if (item) {
        foundRoutine = item;
        foundDate = d;
        break;
      }
    }
  }

  if (!foundRoutine || !foundDate) {
    throw new Error(`Routine with ID '${routineId}' not found.`);
  }

  if (args.title !== undefined) {
    foundRoutine.title = String(args.title).trim();
  }
  if (args.description !== undefined) {
    foundRoutine.description = String(args.description).trim();
  }
  if (args.category !== undefined) {
    foundRoutine.category = String(args.category).trim();
  }

  let updatedStart = foundRoutine.start_time;
  let updatedEnd = foundRoutine.end_time;

  if (args.start_time !== undefined) {
    const s = normalizeTo24HourTime(args.start_time);
    if (!s) throw new Error(`Invalid start_time '${args.start_time}'.`);
    updatedStart = s;
  }

  if (args.duration !== undefined) {
    const durMins = parseDurationToMinutes(args.duration);
    if (durMins && durMins > 0) {
      updatedEnd = calculateEndTime(updatedStart, durMins);
    }
  }

  if (args.end_time !== undefined) {
    if (args.end_time === null || args.end_time === "") {
      updatedEnd = null;
    } else {
      const e = normalizeTo24HourTime(args.end_time);
      if (!e) throw new Error(`Invalid end_time '${args.end_time}'.`);
      updatedEnd = e;
    }
  }

  validateTimeRange(updatedStart, updatedEnd);
  foundRoutine.start_time = updatedStart;
  foundRoutine.end_time = updatedEnd;

  const newDate = (args.date || args.scheduled_date) ? resolveDate(args.date || args.scheduled_date) : foundDate;
  if (newDate !== foundDate) {
    const oldList = await fetchRoutinesForDate(foundDate);
    const filteredOld = oldList.filter((r) => r.id !== routineId);
    await syncStateAndTable(foundDate, filteredOld);

    foundRoutine.scheduled_date = newDate;
    const newList = await fetchRoutinesForDate(newDate);
    newList.push(foundRoutine);
    await syncStateAndTable(newDate, newList);
  } else {
    const list = await fetchRoutinesForDate(foundDate);
    const idx = list.findIndex((r) => r.id === routineId);
    if (idx !== -1) {
      list[idx] = foundRoutine;
      await syncStateAndTable(foundDate, list);
    }
  }

  return {
    message: `Routine '${routineId}' updated successfully.`,
    routine: foundRoutine,
  };
}

async function handleSetFullRoutine(args: any) {
  const targetDate = resolveDate(args.date);
  const incoming = args.routines;

  if (!Array.isArray(incoming)) {
    throw new Error("'routines' array is required.");
  }

  const existingList = await fetchRoutinesForDate(targetDate);
  const existingMap = new Map<string, RoutineRecord>();
  existingList.forEach((r) => {
    existingMap.set(r.id, r);
    existingMap.set(r.title.toLowerCase().trim(), r);
  });

  const now = Date.now();
  const newList: RoutineRecord[] = [];

  for (let idx = 0; idx < incoming.length; idx++) {
    const item = incoming[idx];
    const title = item.title ? String(item.title).trim() : `Routine ${idx + 1}`;

    let rawStart = item.start_time;
    let rawEnd = item.end_time;

    if (!rawStart && item.time) {
      const timeStr = String(item.time).trim();
      if (timeStr.includes("-")) {
        const parts = timeStr.split("-");
        rawStart = parts[0].trim();
        rawEnd = parts[1].trim();
      } else {
        rawStart = timeStr;
      }
    }

    if (!rawStart) {
      rawStart = "08:00";
    }

    const start_time = normalizeTo24HourTime(rawStart) || "08:00";
    let end_time = rawEnd ? normalizeTo24HourTime(rawEnd) : null;

    if (!end_time && item.duration) {
      const durMins = parseDurationToMinutes(item.duration);
      if (durMins && durMins > 0) {
        end_time = calculateEndTime(start_time, durMins);
      }
    }

    validateTimeRange(start_time, end_time);

    const existing = existingMap.get(item.id) || existingMap.get(title.toLowerCase());
    const done = item.done !== undefined ? Boolean(item.done) : existing ? existing.done : false;
    const category = item.category ? String(item.category).trim() : existing ? existing.category : "General";
    const description = item.description !== undefined ? String(item.description).trim() : existing?.description || "";

    newList.push({
      id: item.id || existing?.id || `rt-${now}-${idx}`,
      user_id: USER_ID,
      title,
      description,
      category,
      scheduled_date: targetDate,
      start_time,
      end_time,
      done,
    });
  }

  await syncStateAndTable(targetDate, newList);

  return {
    message: `Schedule for ${targetDate} replaced successfully with ${newList.length} items. Other dates preserved.`,
    scheduled_date: targetDate,
    total: newList.length,
    routines: newList,
  };
}

async function handleToggleRoutine(args: any) {
  const targetIdOrTitle = (args.routine_id || args.title_or_id || "").trim();
  if (!targetIdOrTitle) {
    throw new Error("routine_id is required.");
  }

  const done = args.done !== undefined ? Boolean(args.done) : true;
  const targetDate = args.date ? resolveDate(args.date) : null;

  let foundRoutine: RoutineRecord | null = null;
  let foundDate: string | null = null;

  const searchDate = async (d: string) => {
    const list = await fetchRoutinesForDate(d);
    let match = list.find((r) => r.id === targetIdOrTitle);
    if (!match) {
      match = list.find((r) => r.title.toLowerCase().includes(targetIdOrTitle.toLowerCase()));
    }
    if (match) {
      foundRoutine = match;
      foundDate = d;
      return true;
    }
    return false;
  };

  if (targetDate) {
    await searchDate(targetDate);
  } else {
    const today = getTodayKolkata();
    const tmrw = resolveDate("tomorrow");
    const yest = resolveDate("yesterday");
    if (!(await searchDate(today))) {
      if (!(await searchDate(tmrw))) {
        await searchDate(yest);
      }
    }
  }

  if (!foundRoutine || !foundDate) {
    throw new Error(`Could not find routine matching '${targetIdOrTitle}'.`);
  }

  foundRoutine.done = done;
  const list = await fetchRoutinesForDate(foundDate);
  const idx = list.findIndex((r) => r.id === foundRoutine!.id);
  if (idx !== -1) {
    list[idx] = foundRoutine;
    await syncStateAndTable(foundDate, list);
  }

  return {
    message: `Routine '${foundRoutine.title}' (ID: ${foundRoutine.id}, Date: ${foundDate}) marked as ${done ? "completed [x]" : "uncompleted [ ]"}.`,
    routine: foundRoutine,
  };
}

async function handleDeleteRoutine(args: any) {
  const targetIdOrTitle = (args.routine_id || args.title || args.title_or_id || "").trim();
  if (!targetIdOrTitle) {
    throw new Error("routine_id or title is required to delete a routine.");
  }

  const targetDate = args.date ? resolveDate(args.date) : null;
  let foundRoutine: RoutineRecord | null = null;
  let foundDate: string | null = null;

  const searchDate = async (d: string) => {
    const list = await fetchRoutinesForDate(d);
    let match = list.find((r) => r.id === targetIdOrTitle);
    if (!match) {
      match = list.find((r) => r.title.toLowerCase() === targetIdOrTitle.toLowerCase());
    }
    if (!match) {
      match = list.find((r) => r.title.toLowerCase().includes(targetIdOrTitle.toLowerCase()));
    }
    if (match) {
      foundRoutine = match;
      foundDate = d;
      return true;
    }
    return false;
  };

  if (targetDate) {
    await searchDate(targetDate);
  } else {
    const today = getTodayKolkata();
    const tmrw = resolveDate("tomorrow");
    const yest = resolveDate("yesterday");
    if (!(await searchDate(today))) {
      if (!(await searchDate(tmrw))) {
        await searchDate(yest);
      }
    }
  }

  if (!foundRoutine || !foundDate) {
    throw new Error(`Could not find routine matching '${targetIdOrTitle}' to delete.`);
  }

  const list = await fetchRoutinesForDate(foundDate);
  const remaining = list.filter((r) => r.id !== foundRoutine!.id);
  await syncStateAndTable(foundDate, remaining);

  return {
    message: `Routine '${foundRoutine.title}' (ID: ${foundRoutine.id}, Date: ${foundDate}) deleted successfully.`,
    deleted: foundRoutine,
  };
}

async function handleClearAllRoutines(args: any) {
  if (args.confirm_all === true) {
    const useTable = await hasRoutinesTable();
    if (useTable) {
      await supabase.from("routines").delete().eq("user_id", USER_ID);
    }
    const today = getTodayKolkata();
    const state = { date: today, routines: [], routinesByDate: {} };
    await supabase.from("user_discipline_state").upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });
    return { message: "All routines across all dates have been permanently cleared." };
  }

  const targetDate = resolveDate(args.date || "today");
  await syncStateAndTable(targetDate, []);

  return {
    message: `Routines for ${targetDate} cleared. Routines for all other dates were safely preserved.`,
    scheduled_date: targetDate,
  };
}

// ==============================================================================
// HTTP SERVER (Deno / Supabase Edge Runtime)
// ==============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { id, method, params } = body;

      if (method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "Routine Tracker Live MCP", version: "2.1.0" },
            },
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      if (method === "notifications/initialized") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      if (method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { tools: TOOLS },
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      if (method === "tools/call") {
        const { name, arguments: args = {} } = params || {};
        let resultData: any = null;

        try {
          if (name === "get_routines") {
            resultData = await handleGetRoutines(args);
          } else if (name === "add_routine") {
            resultData = await handleAddRoutine(args);
          } else if (name === "update_routine") {
            resultData = await handleUpdateRoutine(args);
          } else if (name === "set_full_routine") {
            resultData = await handleSetFullRoutine(args);
          } else if (name === "toggle_routine") {
            resultData = await handleToggleRoutine(args);
          } else if (name === "delete_routine") {
            resultData = await handleDeleteRoutine(args);
          } else if (name === "clear_all_routines") {
            resultData = await handleClearAllRoutines(args);
          } else {
            throw new Error(`Tool '${name}' not recognized.`);
          }

          const textResponse =
            typeof resultData === "string"
              ? resultData
              : resultData.formatted || resultData.message || JSON.stringify(resultData, null, 2);

          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: textResponse }],
                structured: resultData,
              },
            }),
            { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        } catch (toolErr: any) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                content: [{ type: "text", text: `Error: ${toolErr.message}` }],
                isError: true,
              },
            }),
            { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: e.message } }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({
      status: "online",
      server: "Routine Tracker Live MCP v2.1",
      timezone: "Asia/Kolkata",
      tools: TOOLS.map((t) => t.name),
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
