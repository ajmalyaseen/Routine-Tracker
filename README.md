# 📱 Routine Tracker

A minimalist, clean daily routine and habit tracker with live Supabase cloud sync and an official **Claude MCP Server** integration.

---

## ✨ Features

- **Minimalist & Airy UI**: Designed with breathing space, large touch targets, and zero bloat.
- **100% User-Created**: No unwanted built-ins or rigid schedules — add your own routine items or have Claude build them for you.
- **Claude MCP Integration**: Connect Claude Desktop or Claude Code to your tracker. Ask Claude: *"Build me a daily routine for an AI/ML Engineer with wakeup at 6 AM, SQL at 7 AM, etc."* — Claude adds it to your database, and it immediately appears in your app!
- **Supabase Cloud Sync**: Real-time sync across your iPhone, laptop, and Claude.
- **PWA (Progressive Web App)**: Install on iPhone via Safari &rarr; *"Add to Home Screen"* for a full-screen app experience.

---

## 🤖 Connecting to Claude via MCP

Add this to your `claude_desktop_config.json` (located at `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "routine-tracker": {
      "command": "C:\\Users\\ajmal\\AppData\\Local\\Python\\bin\\python.exe",
      "args": [
        "C:\\Users\\ajmal\\.gemini\\antigravity\\scratch\\ai-discipline-tracker\\mcp_server.py"
      ]
    }
  }
}
```

### What You Can Say to Claude:
- *"Create a daily routine for me: Wakeup at 6 AM, SQL practice at 7 AM, Core Machine Learning at 9 AM, Interview prep at 11:30 AM, GenAI and RAG at 2 PM, and Revision at 7 PM."*
- *"Show me my routine tracker tasks for today."*
- *"Mark 'SQL practice' as done."*
- *"Add 'Solve 2 LeetCode SQL questions' at 5:00 PM."*

---

## 📲 Install on iPhone

1. Visit your live app URL in **Safari** on your iPhone.
2. Tap the **Share** button (box with arrow pointing up).
3. Tap **"Add to Home Screen"**.
4. Tap **Add**.
