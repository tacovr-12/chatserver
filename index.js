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

let users = {};        // { socketId: { username } }
let messages = [];     // { user, text, timestamp, roomId }

const GLOBAL_ROOM_ID = "global";
let rooms = {
  [GLOBAL_ROOM_ID]: {
    name: "GLOBAL CHAT",
    users: new Set(),
    createdAt: Date.now()
  }
};

// Load previous messages
try { messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8")); } catch { messages = []; }

function saveMessages() {
  fs.writeFile(MESSAGES_FILE, JSON.stringify(messages), err => {
    if (err) console.error("Failed to save messages:", err);
  });
}

// Clean up old messages (24h)
function cleanupMessages() {
  const cutoff = Date.now() - 24*60*60*1000;
  messages = messages.filter(m => m.timestamp > cutoff);
  saveMessages();
}
setInterval(cleanupMessages, 60*60*1000);

// SOCKET LOGIC
io.on("connection", socket => {
  // Send rooms list
  socket.emit("room_list", rooms);

  // Choose username
  socket.on("choose_username", ({ name }, cb) => {
    name = name?.trim();
    if (!name) return cb({ ok:false, error:"Username required" });
    if (Object.values(users).some(u => u.username === name))
      return cb({ ok:false, error:"Username taken" });
    users[socket.id] = { username:name };
    cb({ ok:true });
  });

  // Join global room
  socket.on("join_room", ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok:false, error:"Room not found" });

    room.users.add(socket.id);
    socket.join(roomId);

    cb({ ok:true, roomId });

    // Announce join
    const user = users[socket.id];
    if (!user) return;
    const joinMsg = {
      user:"SYSTEM",
      text:`${user.username} joined the room.`,
      timestamp: Date.now(),
      roomId
    };
    messages.push(joinMsg);
    cleanupMessages();

    room.users.forEach(sid => io.to(sid).emit("chat_message", joinMsg));
  });

  // Send message
  socket.on("send_message", ({ text, roomId }) => {
    const user = users[socket.id];
    if (!user) return;
    const msg = text?.trim();
    if (!msg) return;

    const room = rooms[roomId];
    if (!room || !room.users.has(socket.id)) return;

    const messageData = {
      user: user.username,
      text: msg,
      timestamp: Date.now(),
      roomId
    };
    messages.push(messageData);
    cleanupMessages();

    room.users.forEach(sid => io.to(sid).emit("chat_message", messageData));
  });

  // Disconnect
  socket.on("disconnect", () => {
    delete users[socket.id];
    for (const r of Object.values(rooms)) r.users.delete(socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
