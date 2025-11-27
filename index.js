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

let users = {}; // socketId -> { username, lang }
let messages = []; // { user, text, timestamp, roomId }

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

// Save messages to disk
function saveMessages() {
  fs.writeFile(MESSAGES_FILE, JSON.stringify(messages), err => {
    if (err) console.error("Failed to save messages:", err);
  });
}

// Remove old messages (>24h)
function cleanupMessages() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60 * 60 * 1000);

// Remove old rooms (except global)
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

  // Send previous messages for global room
  messages
    .filter(m => m.roomId === GLOBAL_ROOM_ID)
    .forEach(m => socket.emit("chat_message", m));

  // User chooses username + language
  socket.on("choose_username", ({ name, lang }, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (Object.values(users).some(u => u.username === name))
      return cb({ ok: false, error: "Username taken" });

    users[socket.id] = { username: name, lang };
    cb({ ok: true });
  });

  // Join room
  socket.on("join_room", ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, error: "Room not found" });

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

    // Broadcast to room
    io.to(roomId).emit("chat_message", joinMsg);
  });

  // Send message
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

    io.to(roomId).emit("chat_message", messageData);
  });

  // Disconnect
  socket.on("disconnect", () => {
    const user = users[socket.id];
    delete users[socket.id];

    for (const id in rooms) {
      const room = rooms[id];
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        io.to(id).emit("chat_message", {
          user: "SYSTEM",
          text: `${user?.username || "A user"} left.`,
          timestamp: Date.now(),
          roomId: id
        });
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
