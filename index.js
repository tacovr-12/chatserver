<!DOCTYPE html>
<html>
<head>
  <title>Global Chat</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 20px auto;
    }

    #chat {
      width: 100%;
      height: 500px;
      border: 1px solid #ccc;
      padding: 10px;
      overflow-y: auto;
      background-color: #f9f9f9;
      margin-bottom: 10px;
    }

    #msg {
      width: 80%;
      padding: 8px;
    }

    button {
      padding: 8px 12px;
    }
  </style>
</head>
<body>
  <h2>Global Chat</h2>
  <input id="name" placeholder="Enter username" />
  <button onclick="join()">Join</button>

  <div id="chat"></div>

  <input id="msg" placeholder="Message" />
  <button onclick="send()">Send</button>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    let socket;

    // Escape HTML special characters to prevent injection
    function escapeHTML(str) {
      const div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }

    function join() {
      const name = document.getElementById("name").value.trim();
      if (!name) return alert("Enter a username");
      socket = io();
      socket.emit("choose_username", name, res => {
        if (!res.ok) return alert(res.error);

        const chatDiv = document.getElementById("chat");
        chatDiv.innerHTML += `<div>Joined as ${escapeHTML(name)}</div>`;

        socket.on("chat_message", data => {
          chatDiv.innerHTML += `<div><strong>${escapeHTML(data.user)}:</strong> ${escapeHTML(data.text)}</div>`;
          chatDiv.scrollTop = chatDiv.scrollHeight; // auto-scroll
        });
      });
    }

    function send() {
      const msg = document.getElementById("msg").value;
      if (!msg || !socket) return;
      socket.emit("send_message", msg);
      document.getElementById("msg").value = "";
    }
  </script>
</body>
</html>
