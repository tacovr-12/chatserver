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
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

const MESSAGES_FILE = path.join(__dirname, "messages.json");

let users = {};          // { socketId: { username, lang } }
let messages = [];       // { user, text, timestamp, roomId }
let translationCache = {};
const GLOBAL_ROOM = "global"; // single global room

// Load old messages
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

async function translateText(text, targetLang) {
  if (!targetLang || targetLang === "auto") return text;

  const key = `${text}|${targetLang}`;
  if (translationCache[key]) return translationCache[key];

  try {
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

// SOCKET.IO
io.on("connection", socket => {
  // add user to global room by default
  socket.join(GLOBAL_ROOM);

  socket.on("choose_username", ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (Object.values(users).some(u => u.username === name))
      return cb({ ok: false, error: "Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok: true });

    // send previous global messages
    messages
      .filter(m => m.roomId === GLOBAL_ROOM)
      .forEach(async m => {
        const translated = await translateText(m.text, lang);
        socket.emit("chat_message", { ...m, text: translated });
      });
  });

  // SEND MESSAGE
  socket.on("send_message", async ({ text, roomId }) => {
    const user = users[socket.id];
    if (!user) return;

    const msg = text.trim();
    if (!msg) return;

    const messageData = {
      user: user.username,
      text: msg,
      timestamp: Date.now(),
      roomId: roomId || GLOBAL_ROOM
    };

    messages.push(messageData);
    cleanupMessages();

    // Broadcast to all in the room
    const socketsInRoom = await io.in(messageData.roomId).fetchSockets();
    socketsInRoom.forEach(async s => {
      const receiver = users[s.id];
      if (!receiver) return;
      const translated = await translateText(msg, receiver.lang);
      io.to(s.id).emit("chat_message", { ...messageData, text: translated });
    });
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
