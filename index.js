import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, "public")));

let usernames = new Set();
let messages = []; // store {user, text, timestamp}

// Remove messages older than 24 hours every hour
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  messages = messages.filter(msg => msg.timestamp > cutoff);
}, 60 * 60 * 1000);

io.on("connection", (socket) => {
  let username = null;

  // send current users list to new connection
  socket.emit("user_list", Array.from(usernames));

  // send existing chat history
  socket.emit("chat_history", messages);

  socket.on("choose_username", (name, cb) => {
    name = name.trim();
    if (!name) return cb({ ok: false, error: "Username required" });
    if (usernames.has(name)) return cb({ ok: false, error: "Username taken" });

    usernames.add(name);
    username = name;
    cb({ ok: true });

    io.emit("chat_message", { user: "SYSTEM", text: `${name} joined.`, timestamp: Date.now() });
    io.emit("user_list", Array.from(usernames));
  });

  socket.on("send_message", (msg) => {
    if (!username) return;
    msg = msg.trim();
    if (!msg) return;

    const messageData = { user: username, text: msg, timestamp: Date.now() };
    messages.push(messageData);
    io.emit("chat_message", messageData);
  });

  socket.on("disconnect", () => {
    if (username) {
      usernames.delete(username);
      io.emit("chat_message", { user: "SYSTEM", text: `${username} left.`, timestamp: Date.now() });
      io.emit("user_list", Array.from(usernames));
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
