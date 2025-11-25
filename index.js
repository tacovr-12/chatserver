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

// serve the public folder
app.use(express.static(path.join(__dirname, "public")));

let usernames = new Set();

io.on("connection", socket => {
  let username = null;

  socket.on("choose_username", (name, cb) => {
    if (usernames.has(name)) {
      return cb({ ok: false, error: "Username taken" });
    }
    usernames.add(name);
    username = name;
    cb({ ok: true });

    io.emit("chat_message", { user: "SYSTEM", text: `${name} joined.` });
  });

  socket.on("send_message", msg => {
    if (!username) return; // ignore ghosts
    io.emit("chat_message", { user: username, text: msg });
  });

  socket.on("disconnect", () => {
    if (username) {
      usernames.delete(username);
      io.emit("chat_message", {
        user: "SYSTEM",
        text: `${username} left.`,
      });
    }
  });
});

httpServer.listen(3000, () => {
  console.log("Listening on 3000");
});
