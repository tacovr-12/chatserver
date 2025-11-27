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

let users = {};                         // { socketId: { username, lang } }
let messages = [];                      // stored messages (roomId included)
let translationCache = {};              // translation caching

let rooms = {};                         // roomId: { name, isPrivate, password, createdAt, users:Set }

// Load old message history
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

// Clean up 24-hour old messages
function cleanupMessages() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60 * 60 * 1000);

// Clean up 24-hour old rooms
function cleanupRooms() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const id in rooms) {
    if (rooms[id].createdAt < cutoff) delete rooms[id];
  }
}
setInterval(cleanupRooms, 60 * 60 * 1000);

// MyMemory translation
async function translateText(text, targetLang) {
  if (!targetLang) return text;
  if (targetLang === "auto") return text;

  const key = `${text}|${targetLang}`;
  if (translationCache[key]) return translationCache[key];

  try {
    // Source language is unknown, so use EN as safe default
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

// SOCKET LOGIC
io.on("connection", socket => {

  socket.emit("room_list", rooms);

  // User chooses username + language
  socket.on("choose_username", ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (Object.values(users).some(u => u.username === name))
      return cb({ ok: false, error: "Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok: true });
  });

  // CREATE ROOM
  socket.on("create_room", ({ name, isPrivate, password }, cb) => {
    const roomId = Math.random().toString(36).slice(2, 10);

    rooms[roomId] = {
      name,
      isPrivate,
      password: isPrivate ? password : null,
      createdAt: Date.now(),
      users: new Set()
    };

    io.emit("room_list", rooms);
    cb({ ok: true, roomId });
  });

  // JOIN ROOM
  socket.on("join_room", ({ roomId, password }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: "Room not found" });

    if (room.isPrivate && room.password !== password)
      return cb({ ok: false, error: "Wrong password" });

    room.users.add(socket.id);
    socket.join(roomId);

    cb({ ok: true, roomId });

    // Announce join inside the room
    const user = users[socket.id];
    if (!user) return;

    const joinMsg = {
      user: "SYSTEM",
      text: `${user.username} joined.`,
      timestamp: Date.now(),
      roomId
    };

    messages.push(joinMsg);
    cleanupMessages();

    // Translate per person
    room.users.forEach(async sid => {
      const receiver = users[sid];
      const translated = await translateText(joinMsg.text, receiver.lang);
      io.to(sid).emit("chat_message", { ...joinMsg, text: translated });
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
      roomId
    };

    messages.push(messageData);
    cleanupMessages();

    const room = rooms[roomId];
    if (!room) return;

    room.users.forEach(async sid => {
      const receiver = users[sid];
      const translated = await translateText(msg, receiver.lang);
      io.to(sid).emit("chat_message", { ...messageData, text: translated });
    });
  });

  // DISCONNECT LOGIC
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (!user) return;
    delete users[socket.id];

    for (const id in rooms) {
      rooms[id].users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
