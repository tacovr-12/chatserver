import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, "public")));

const MESSAGES_FILE = path.join(__dirname, "messages.json");
let users = {}; // { socketId: { username, lang } }
let messages = [];
let translationCache = {}; // { "text|lang": translatedText }

// Load messages on start
try {
  const data = fs.readFileSync(MESSAGES_FILE, "utf-8");
  messages = JSON.parse(data);
} catch (err) {
  messages = [];
}

// Save messages
function saveMessages() {
  fs.writeFile(MESSAGES_FILE, JSON.stringify(messages), err => {
    if (err) console.error("Failed to save messages:", err);
  });
}

// Remove messages older than 24 hours
function cleanupMessages() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(msg => msg.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60 * 60 * 1000);

// Language detection using LibreTranslate
async function detectLanguage(text) {
  try {
    const res = await fetch("https://libretranslate.com/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text })
    });
    const data = await res.json();
    return data[0].language || "auto";
  } catch (err) {
    console.error("Language detect error:", err);
    return "auto";
  }
}

// Translate text with caching
async function translateText(text, targetLang) {
  if (!targetLang || targetLang === "auto") return text;
  const key = `${text}|${targetLang}`;
  if (translationCache[key]) return translationCache[key];

  try {
    const sourceLang = await detectLanguage(text);
    const res = await fetch("https://libretranslate.com/translate", {
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
  } catch (err) {
    console.error("Translation error:", err);
    return text;
  }
}

io.on("connection", socket => {
  // Send chat history
  socket.emit("chat_history", messages);

  // Send current online users
  socket.emit("user_list", Object.values(users).map(u => u.username));

  // Login
  socket.on("choose_username", async ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (Object.values(users).some(u => u.username === name)) return cb({ ok: false, error: "Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok: true });

    const joinMsg = { user: "SYSTEM", text: `${name} joined.`, timestamp: Date.now(), originalLang: "en" };
    messages.push(joinMsg);
    cleanupMessages();

    // Broadcast translated join message to all users
    for (const [id, u] of Object.entries(users)) {
      const translated = await translateText(joinMsg.text, u.lang);
      io.to(id).emit("chat_message", { ...joinMsg, text: translated });
    }

    io.emit("user_list", Object.values(users).map(u => u.username));
  });

  // Send message
  socket.on("send_message", async msg => {
    const user = users[socket.id];
    if (!user) return;
    msg = msg.trim();
    if (!msg) return;

    const messageData = { user: user.username, text: msg, timestamp: Date.now(), originalLang: user.lang };
    messages.push(messageData);
    cleanupMessages();

    // Broadcast translated message to all
    for (const [id, u] of Object.entries(users)) {
      const translated = await translateText(msg, u.lang);
      io.to(id).emit("chat_message", { ...messageData, text: translated });
    }
  });

  // Disconnect
  socket.on("disconnect", async () => {
    const user = users[socket.id];
    if (!user) return;
    delete users[socket.id];

    const leaveMsg = { user: "SYSTEM", text: `${user.username} left.`, timestamp: Date.now(), originalLang: "en" };
    messages.push(leaveMsg);
    cleanupMessages();

    for (const [id, u] of Object.entries(users)) {
      const translated = await translateText(leaveMsg.text, u.lang);
      io.to(id).emit("chat_message", { ...leaveMsg, text: translated });
    }

    io.emit("user_list", Object.values(users).map(u => u.username));
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
