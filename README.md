# TAGOPS Socket Relay (`tagops-socket-relay`)

The **TAGOPS Socket Relay** is the central communication hub of the TAGOPS Platform. It utilizes `Socket.IO` to establish and maintain real-time, bi-directional WebSocket connections between the user-facing Dashboard and the remote Linux VPS Agents.

---

## 🚀 Features
- **Real-Time Data Streams:** Handles the relay of live system telemetry (CPU, RAM, UFW, Mongo) emitted by connected Agents.
- **Bi-Directional Command Execution:** securely routes dashboard action commands (e.g., Deploy, Stop, Nginx Map) to the specific target server.
- **Live Log Streaming:** Pipes `pm2 logs` dynamically from the Agents straight into the Dashboard UI.
- **Server Tracking:** Maintains a live registry of active Agents and immediately alerts the Dashboard if a server goes offline.

---

## 🛠️ Installation & Setup

1. **Clone and Install Dependencies**
   ```bash
   git clone https://github.com/tagobuyhelp/tagops-socket-relay.git
   cd tagops-socket-relay
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file to define your security token and port:
   ```env
   PORT=8001
   AGENT_TOKEN=secret_agent_token
   ```

3. **Start the Relay Server**
   ```bash
   node index.js
   ```

---

## 🔒 Security
The Socket Server utilizes a simple token-based handshake to verify that incoming Agent and Dashboard connections are authorized to join the relay network.
