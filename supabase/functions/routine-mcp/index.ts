import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://gwrrlipcjhhrwjjjkuby.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3cnJsaXBjamhocndqamprdWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MTQ0OTYsImV4cCI6MjExMDM5MDQ5Nn0.B0-Eg4YOMyRe7rQNdOl_-xYtw6G6S9TKdX45KNvngHQ";
const USER_ID = "routine-master-user";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Available MCP Tools
const TOOLS = [
  {
    name: "get_routines",
    description: "Fetch the user's daily routine schedule and completion status.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "add_routine",
    description: "Add a new routine item to the tracker.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: "Time string, e.g. '06:00 AM' or '07:00 AM - 08:30 AM'" },
        title: { type: "string", description: "What to do, e.g. 'Study SQL Window Functions'" },
        category: { type: "string", description: "Optional category tag, e.g. 'SQL', 'ML', 'GenAI'" },
      },
      required: ["time", "title"],
    },
  },
  {
    name: "set_full_routine",
    description: "Set or replace the entire routine with a list of curated items (e.g. when Claude designs a daily AI/ML schedule).",
    inputSchema: {
      type: "object",
      properties: {
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
        title_or_id: { type: "string", description: "ID or text search of the routine" },
        done: { type: "boolean", description: "True for completed, false for uncompleted" },
      },
      required: ["title_or_id"],
    },
  },
  {
    name: "clear_all_routines",
    description: "Clear all routines to start fresh.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

async function getRoutines() {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const routines = data?.state?.routines || [];
  if (routines.length === 0) return "No routines currently configured in Routine Tracker.";

  return routines
    .map((r: any, idx: number) => {
      const status = r.done ? "[x]" : "[ ]";
      const cat = r.category ? ` [${r.category}]` : "";
      return `${idx + 1}. ${status} ${r.time} - ${r.title}${cat} (ID: ${r.id})`;
    })
    .join("\n");
}

async function addRoutine(time: string, title: string, category: string = "") {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  const state = data?.state || { date: new Date().toISOString().split("T")[0], routines: [] };
  const routines = state.routines || [];

  const newItem = {
    id: `rt-${Date.now()}`,
    time,
    title,
    category: category || "",
    done: false,
  };
  routines.push(newItem);
  state.routines = routines;

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Added '${time} - ${title}' successfully to your Routine Tracker!`;
}

async function setFullRoutine(newItems: any[]) {
  const now = Date.now();
  const routines = newItems.map((item, idx) => ({
    id: `rt-${now}-${idx}`,
    time: item.time || "",
    title: item.title || "",
    category: item.category || "",
    done: Boolean(item.done),
  }));

  const state = {
    date: new Date().toISOString().split("T")[0],
    routines,
  };

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Successfully created ${routines.length} routine items in your Routine Tracker!`;
}

async function toggleRoutine(titleOrId: string, done: boolean = true) {
  const { data } = await supabase
    .from("user_discipline_state")
    .select("state")
    .eq("user_id", USER_ID)
    .single();

  if (!data?.state?.routines) return "No routines found.";
  const state = data.state;
  let found = false;

  for (const r of state.routines) {
    if (r.id === titleOrId || r.title.toLowerCase().includes(titleOrId.toLowerCase())) {
      r.done = done;
      found = true;
      break;
    }
  }

  if (!found) return `Could not find a routine matching '${titleOrId}'.`;

  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });

  return `Routine '${titleOrId}' marked as ${done ? "completed" : "uncompleted"}.`;
}

async function clearAll() {
  const state = { date: new Date().toISOString().split("T")[0], routines: [] };
  await supabase
    .from("user_discipline_state")
    .upsert({ user_id: USER_ID, state, updated_at: new Date().toISOString() });
  return "All routines cleared. Tracker is now empty and fresh.";
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
        const { name, arguments: args } = params;
        let textResult = "";

        if (name === "get_routines") {
          textResult = await getRoutines();
        } else if (name === "add_routine") {
          textResult = await addRoutine(args.time, args.title, args.category);
        } else if (name === "set_full_routine") {
          textResult = await setFullRoutine(args.routines);
        } else if (name === "toggle_routine") {
          textResult = await toggleRoutine(args.title_or_id, args.done ?? true);
        } else if (name === "clear_all_routines") {
          textResult = await clearAll();
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
