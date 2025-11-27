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

let users = {};        // { socketId: { username, lang } }
let messages = [];     // { user, text, timestamp, roomId }

const GLOBAL_ROOM_ID = "global";
let rooms = {
  [GLOBAL_ROOM_ID]: {
    name: "GLOBAL CHAT",
    isPrivate: false,
    password: null,
    createdAt: Date.now(),
    users: new Set()
  }
};

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

// Clean up old messages
function cleanupMessages() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60 * 60 * 1000);

// Clean up old rooms (except global)
function cleanupRooms() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const id in rooms) {
    if (id === GLOBAL_ROOM_ID) continue;
    if (rooms[id].createdAt < cutoff) delete rooms[id];
  }
}
setInterval(cleanupRooms, 60 * 60 * 1000);

// SOCKET LOGIC
io.on("connection", socket => {
  // Always send the room list (global included)
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

  // JOIN ROOM
  socket.on("join_room", ({ roomId, password }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: "Room not found" });

    if (room.isPrivate && room.password !== password)
      return cb({ ok: false, error: "Wrong password" });

    room.users.add(socket.id);
    socket.join(roomId);

    cb({ ok: true, roomId });

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

    // Send join message to everyone in room
    room.users.forEach(sid => io.to(sid).emit("chat_message", joinMsg));
  });

  // SEND MESSAGE
  socket.on("send_message", ({ text, roomId }) => {
    const user = users[socket.id];
    if (!user) return;
    const msg = text.trim();
    if (!msg) return;

    const room = rooms[roomId];
    if (!room) return;

    const messageData = {
      user: user.username,
      text: msg,
      timestamp: Date.now(),
      roomId
    };
    messages.push(messageData);
    cleanupMessages();

    // Send to everyone in the room
    room.users.forEach(sid => io.to(sid).emit("chat_message", messageData));
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    delete users[socket.id];
    for (const id in rooms) rooms[id].users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
