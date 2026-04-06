import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIARY_FILE = path.join(__dirname, 'diary-data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Ensure files exist
async function ensureFiles() {
    try { await fs.access(DIARY_FILE); } catch { await fs.writeFile(DIARY_FILE, JSON.stringify([], null, 2)); }
    try { await fs.access(USERS_FILE); } catch { await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2)); }
}

async function getJson(file) {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
}

async function saveJson(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// 1. Express API
const app = express();
app.use(cors());
app.use(express.json());

// Auth Endpoints
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        const users = await getJson(USERS_FILE);
        if (users.find(u => u.username === username)) return res.status(400).json({ error: '이미 존재하는 사용자명입니다.' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, password: hashedPassword });
        await saveJson(USERS_FILE, users);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const users = await getJson(USERS_FILE);
        const user = users.find(u => u.username === username);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: '로그인 정보가 올바르지 않습니다.' });
        }
        res.json({ success: true, username });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Diary Endpoints (Filtered by user)
app.get('/api/entries', async (req, res) => {
    try {
        const user = req.query.user;
        if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
        const entries = await getJson(DIARY_FILE);
        res.json(entries.filter(e => e.userId === user));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/entries', async (req, res) => {
    try {
        const { entry, user } = req.body;
        if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
        const entries = await getJson(DIARY_FILE);
        entries.push({ ...entry, userId: user });
        await saveJson(DIARY_FILE, entries);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries/:timestamp', async (req, res) => {
    try {
        const user = req.query.user;
        let entries = await getJson(DIARY_FILE);
        entries = entries.filter(e => !(e.timestamp === req.params.timestamp && e.userId === user));
        await saveJson(DIARY_FILE, entries);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const HTTP_PORT = process.env.PORT || 3030;

// Serve static files (optional, if you have assets)
app.use(express.static(__dirname));

// Serve daily.html as the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'daily.html'));
});

app.listen(HTTP_PORT, () => console.error(`Server running on port ${HTTP_PORT}`));

// 2. MCP Server
const server = new Server({ name: "diary-auth-mcp", version: "1.0.0" }, { capabilities: { resources: {}, tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_user_diary",
      description: "Search diary for a specific user.",
      inputSchema: {
        type: "object",
        properties: {
          username: { type: "string" },
          query: { type: "string" }
        },
        required: ["username", "query"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "search_user_diary") {
    const entries = await getJson(DIARY_FILE);
    const filtered = entries.filter(e => e.userId === args.username && e.text.includes(args.query));
    return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
  }
  throw new Error("Tool not found");
});

async function main() {
  await ensureFiles();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Diary Auth MCP Server started");
}
main().catch(console.error);
