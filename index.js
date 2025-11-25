import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, "public")));

const MESSAGES_FILE = path.join(__dirname, "messages.json");
let users = {}; // { socketId: { username, lang } }
let messages = [];
let translationCache = {};

// Load messages
try {
  messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
} catch {
  messages = [];
}

function saveMessages() {
  fs.writeFile(MESSAGES_FILE, JSON.stringify(messages), err => {
    if (err) console.error("Failed to save messages:", err);
  });
}

function cleanupMessages() {
  const cutoff = Date.now() - 24*60*60*1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60*60*1000);

const TRANSLATE_URL = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com";

// Detect language
async function detectLanguage(text) {
  try {
    const res = await fetch(`${TRANSLATE_URL}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text })
    });
    const data = await res.json();
    return data[0]?.language || "en";
  } catch {
    return "en";
  }
}

// Translate text with caching
async function translateText(text, targetLang) {
  if (!targetLang) return text;
  const key = `${text}|${targetLang}`;
  if (translationCache[key]) return translationCache[key];

  try {
    const sourceLang = await detectLanguage(text);
    if (sourceLang === targetLang) return text;

    const res = await fetch(`${TRANSLATE_URL}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: sourceLang,
        target: targetLang,
        format: "text"
      })
    });
    const data = await res.json();
    const translated = data.translatedText || text;
    translationCache[key] = translated;
    return translated;
  } catch {
    return text;
  }
}

io.on("connection", socket => {

  // Send last 24h messages immediately
  socket.emit("chat_history", messages);

  socket.on("choose_username", async ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok:false, error:"Username required" });
    if (Object.values(users).some(u => u.username === name)) return cb({ ok:false, error:"Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok:true });

    const joinMsg = { user:"SYSTEM", text:`${name} joined.`, timestamp:Date.now() };
    messages.push(joinMsg);
    cleanupMessages();

    // Broadcast join message translated to all users
    await Promise.all(Object.entries(users).map(async ([id, u]) => {
      const translated = await translateText(joinMsg.text, u.lang);
      io.to(id).emit("chat_message", { ...joinMsg, text: translated });
    }));
  });

  socket.on("send_message", async ({ text }) => {
    const user = users[socket.id];
    if (!user) return;
    const msg = text.trim();
    if (!msg) return;

    const messageData = { user: user.username, text: msg, timestamp: Date.now() };
    messages.push(messageData);
    cleanupMessages();

    // Send translated message to all users
    await Promise.all(Object.entries(users).map(async ([id, u]) => {
      const translated = await translateText(msg, u.lang);
      io.to(id).emit("chat_message", { ...messageData, text: translated });
    }));
  });

  socket.on("disconnect", async () => {
    const user = users[socket.id];
    if (!user) return;
    delete users[socket.id];

    const leaveMsg = { user:"SYSTEM", text:`${user.username} left.`, timestamp:Date.now() };
    messages.push(leaveMsg);
    cleanupMessages();

    // Broadcast leave message translated to all users
    await Promise.all(Object.entries(users).map(async ([id, u]) => {
      const translated = await translateText(leaveMsg.text, u.lang);
      io.to(id).emit("chat_message", { ...leaveMsg, text: translated });
    }));
  });

});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
