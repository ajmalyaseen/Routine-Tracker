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

// Date helper: gets YYYY-MM-DD in user's timezone (IST Asia/Kolkata default)
function getTodayDate(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (_) {
    return new Date().toISOString().split("T")[0];
  }
}

function resolveTargetDate(inputDate?: string, fallbackDate?: string): string {
  const base = fallbackDate || getTodayDate();
  if (!inputDate || inputDate.toLowerCase().trim() === "today" || inputDate.trim() === "") {
    return base;
  }
  const s = inputDate.toLowerCase().trim();
  if (s === "tomorrow" || s === "tmrw") {
    const d = new Date(base + "T12:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  if (s === "next" || s === "day_after" || s === "day after tomorrow") {
    const d = new Date(base + "T12:00:00");
    d.setDate(d.getDate() + 2);
    return d.toISOString().split("T")[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  return base;
}

// Available MCP Tools
const TOOLS = [
  {
    name: "get_routines",
    description: "Fetch the user's daily routine schedule and completion status for today, tomorrow, or a specific date.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional: 'today', 'tomorrow', or 'YYYY-MM-DD'. Defaults to today." },
      },
      required: [],
    },
  },
  {
    name: "add_routine",
    description: "Add a new routine item to the Routine Tracker. Automatically syncs with the web app calendar.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: "Time string, e.g. '06:00 AM' or '07:00 AM - 08:30 AM'" },
        title: { type: "string", description: "What to do, e.g. 'Study SQL Window Functions'" },
        category: { type: "string", description: "Optional category tag, e.g. 'SQL', 'ML', 'GenAI', 'Health'" },
        date: { type: "string", description: "Optional: 'today', 'tomorrow', or 'YYYY-MM-DD'. Defaults to today." },
      },
      required: ["time", "title"],
    },
  },
  {
    name: "set_full_routine",
    description: "Set or replace the entire routine for a date with a curated list of items (e.g. daily AI/ML schedule).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional: 'today', 'tomorrow', or 'YYYY-MM-DD'. Defaults to today." },
        routines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              time: { type: "string" },
              title: { type: "string" },
              category: { type: "string" },
              done: { type: "boolean" },
            },
            required: ["time", "title"],
          },
        },
      },
      required: ["routines"],
    },
  },
  {
    name: "toggle_routine",
    description: "Mark a routine item as done or undone.",
    inputSchema: {
      type: "object",
      properties: {
        title_or_id: { type: "string", description: "ID or partial name of the routine" },
        done: { type: "boolean", description: "True for completed, false for uncompleted" },
        date: { type: "string", description: "Optional date to look in: 'today', 'tomorrow', or 'YYYY-MM-DD'." },
      },
      required: ["title_or_id"],
    },
  },
  {
    name: "clear_all_routines",
    description: "Clear routines for a specific date or clear all routines.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional: 'today', 'tomorrow', 'YYYY-MM-DD', or 'all'. Defaults to 'today'." },
      },
      required: [],
    },
  },
];

async function getRoutines(dateInput?: string) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const state = data?.state;
  if (!state) return "No routines currently configured in Routine Tracker.";

  const targetDate = resolveTargetDate(dateInput, state.date);
  let routines: any[] = [];

  if (state.routinesByDate && Array.isArray(state.routinesByDate[targetDate])) {
    routines = state.routinesByDate[targetDate];
  } else if (targetDate === (state.date || getTodayDate()) && Array.isArray(state.routines)) {
    routines = state.routines;
  }

  if (routines.length === 0) {
    return `No routines currently configured for ${targetDate} in Routine Tracker.`;
  }

  const lines = [
    `Routines for ${targetDate} (${routines.length} items):`,
    ...routines.map((r: any, idx: number) => {
      const status = r.done ? "[x]" : "[ ]";
      const cat = r.category ? ` [${r.category}]` : "";
      return `${idx + 1}. ${status} ${r.time} - ${r.title}${cat} (ID: ${r.id})`;
    }),
  ];

  return lines.join("\n");
}

async function addRoutine(time: string, title: string, category: string = "", dateInput?: string) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const today = getTodayDate();
  const state = data?.state || { date: today, routines: [], routinesByDate: {} };
  if (!state.routinesByDate || typeof state.routinesByDate !== "object") {
    state.routinesByDate = {};
  }

  const targetDate = resolveTargetDate(dateInput, state.date);
  if (!state.routinesByDate[targetDate] || !Array.isArray(state.routinesByDate[targetDate])) {
    state.routinesByDate[targetDate] = [];
  }

  const newItem = {
    id: `rt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    time,
    title,
    category: category || "",
    done: false,
  };

  state.routinesByDate[targetDate].push(newItem);

  // Keep state.routines in sync with today's routine list
  const currentToday = state.date || today;
  if (targetDate === currentToday) {
    state.routines = state.routinesByDate[targetDate];
  } else if (!state.routines) {
    state.routines = [];
  }

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Added '${time} - ${title}' successfully to your Routine Tracker for ${targetDate}!`;
}

async function setFullRoutine(newItems: any[], dateInput?: string) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const today = getTodayDate();
  const state = data?.state || { date: today, routines: [], routinesByDate: {} };
  if (!state.routinesByDate || typeof state.routinesByDate !== "object") {
    state.routinesByDate = {};
  }

  const targetDate = resolveTargetDate(dateInput, state.date);
  const now = Date.now();
  const routines = newItems.map((item, idx) => ({
    id: `rt-${now}-${idx}`,
    time: item.time || "",
    title: item.title || "",
    category: item.category || "",
    done: Boolean(item.done),
  }));

  state.routinesByDate[targetDate] = routines;

  const currentToday = state.date || today;
  if (targetDate === currentToday) {
    state.routines = routines;
  }

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Successfully saved ${routines.length} routine items for ${targetDate} in your Routine Tracker!`;
}

async function toggleRoutine(titleOrId: string, done: boolean = true, dateInput?: string) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  if (!data?.state) return "No routines found.";
  const state = data.state;
  let found = false;

  const checkList = (list: any[]) => {
    if (!Array.isArray(list)) return false;
    for (const r of list) {
      if (r.id === titleOrId || (r.title && r.title.toLowerCase().includes(titleOrId.toLowerCase()))) {
        r.done = done;
        found = true;
        return true;
      }
    }
    return false;
  };

  if (dateInput) {
    const targetDate = resolveTargetDate(dateInput, state.date);
    if (state.routinesByDate && state.routinesByDate[targetDate]) {
      checkList(state.routinesByDate[targetDate]);
    }
  } else {
    if (state.routinesByDate) {
      for (const d of Object.keys(state.routinesByDate)) {
        if (checkList(state.routinesByDate[d])) break;
      }
    }
    if (!found && state.routines) {
      checkList(state.routines);
    }
  }

  const today = getTodayDate();
  const currentToday = state.date || today;
  if (state.routinesByDate && state.routinesByDate[currentToday]) {
    state.routines = state.routinesByDate[currentToday];
  }

  if (!found) return `Could not find a routine matching '${titleOrId}'.`;

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Routine '${titleOrId}' marked as ${done ? "completed" : "uncompleted"}.`;
}

async function clearAll(dateInput?: string) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const today = getTodayDate();
  const state = data?.state || { date: today, routines: [], routinesByDate: {} };

  if (dateInput && dateInput.toLowerCase().trim() === "all") {
    state.routines = [];
    state.routinesByDate = {};
    await supabase
      .from("user_discipline_state")
      .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });
    return "All routines across all dates have been cleared.";
  }

  const targetDate = resolveTargetDate(dateInput, state.date);
  if (state.routinesByDate) {
    state.routinesByDate[targetDate] = [];
  }
  const currentToday = state.date || today;
  if (targetDate === currentToday) {
    state.routines = [];
  }

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Routines for ${targetDate} have been cleared.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Handle MCP Protocol (JSON-RPC 2.0)
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
              serverInfo: { name: "Routine Tracker Live", version: "1.0.0" },
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
        let textResult = "";

        if (name === "get_routines") {
          textResult = await getRoutines(args?.date);
        } else if (name === "add_routine") {
          textResult = await addRoutine(args?.time, args?.title, args?.category, args?.date);
        } else if (name === "set_full_routine") {
          textResult = await setFullRoutine(args?.routines || [], args?.date);
        } else if (name === "toggle_routine") {
          textResult = await toggleRoutine(args?.title_or_id, args?.done ?? true, args?.date);
        } else if (name === "clear_all_routines") {
          textResult = await clearAll(args?.date);
        } else {
          textResult = `Tool '${name}' not recognized.`;
        }

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: textResult }],
            },
          }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
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

  // GET / Info Endpoint
  return new Response(
    JSON.stringify({
      status: "online",
      server: "Routine Tracker Live MCP",
      tools: TOOLS.map((t) => t.name),
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});