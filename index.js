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
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60 * 60 * 1000);

// Translate using MyMemory
async function translateText(text, targetLang) {
  if (!targetLang || targetLang === "en") return text; // no translation needed

  const key = `${text}|${targetLang}`;
  if (translationCache[key]) return translationCache[key];

  try {
    // MyMemory expects a source language; use 'EN' if unknown
    const langpair = `EN|${targetLang.toUpperCase()}`;

    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`
    );
    const data = await res.json();

    const translated = data.responseData?.translatedText || text;
    translationCache[key] = translated;
    return translated;
  } catch (err) {
    console.error("Translate error:", err);
    return text;
  }
}

// Socket.IO connection
io.on("connection", socket => {
  // Send last 24h messages untranslated first
  socket.emit("chat_history", messages);

  socket.on("choose_username", async ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (Object.values(users).some(u => u.username === name)) return cb({ ok: false, error: "Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok: true });

    const joinMsg = { user: "SYSTEM", text: `${name} joined.`, timestamp: Date.now() };
    messages.push(joinMsg);
    cleanupMessages();

    // Broadcast join message to all users, translated
    await Promise.all(
      Object.entries(users).map(async ([id, u]) => {
        const translated = await translateText(joinMsg.text, u.lang);
        io.to(id).emit("chat_message", { ...joinMsg, text: translated });
      })
    );
  });

  socket.on("send_message", async ({ text }) => {
    const user = users[socket.id];
    if (!user) return;
    const msg = text.trim();
    if (!msg) return;

    const messageData = { user: user.username, text: msg, timestamp: Date.now() };
    messages.push(messageData);
    cleanupMessages();

    // Translate for every recipient
    await Promise.all(
      Object.entries(users).map(async ([id, u]) => {
        const translated = await translateText(msg, u.lang);
        io.to(id).emit("chat_message", { ...messageData, text: translated });
      })
    );
  });

  socket.on("disconnect", async () => {
    const user = users[socket.id];
    if (!user) return;
    delete users[socket.id];

    const leaveMsg = { user: "SYSTEM", text: `${user.username} left.`, timestamp: Date.now() };
    messages.push(leaveMsg);
    cleanupMessages();

    await Promise.all(
      Object.entries(users).map(async ([id, u]) => {
        const translated = await translateText(leaveMsg.text, u.lang);
        io.to(id).emit("chat_message", { ...leaveMsg, text: translated });
      })
    );
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
