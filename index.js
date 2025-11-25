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
let usernames = new Set();
let messages = [];

// Load persisted messages
try {
  const data = fs.readFileSync(MESSAGES_FILE, "utf-8");
  messages = JSON.parse(data);
} catch (err) {
  messages = [];
}

// Function to save messages
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
setInterval(cleanupMessages, 60 * 60 * 1000); // every hour

io.on("connection", socket => {
  let username = null;

  // Send all messages to anyone who connects
  socket.emit("chat_history", messages);

  // Send current users list
  socket.emit("user_list", Array.from(usernames));

  // Choose username to be able to send messages
  socket.on("choose_username", (name, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (usernames.has(name)) return cb({ ok: false, error: "Username taken" });

    usernames.add(name);
    username = name;
    cb({ ok: true });

    const joinMsg = { user: "SYSTEM", text: `${name} joined.`, timestamp: Date.now() };
    messages.push(joinMsg);
    cleanupMessages();
    io.emit("chat_message", joinMsg);
    io.emit("user_list", Array.from(usernames));
  });

  // Send message
  socket.on("send_message", msg => {
    if (!username) return; // cannot send if not logged in
    msg = msg.trim();
    if (!msg) return;

    const messageData = { user: username, text: msg, timestamp: Date.now() };
    messages.push(messageData);
    cleanupMessages();
    io.emit("chat_message", messageData);
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (username) {
      usernames.delete(username);
      const leaveMsg = { user: "SYSTEM", text: `${username} left.`, timestamp: Date.now() };
      messages.push(leaveMsg);
      cleanupMessages();
      io.emit("chat_message", leaveMsg);
      io.emit("user_list", Array.from(usernames));
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`Listening on ${PORT}`));
