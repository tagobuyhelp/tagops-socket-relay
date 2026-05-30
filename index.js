require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const alertQueue = new Queue('alertQueue', { connection: redisConnection });

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

app.get('/health', (req, res) => {
  res.send('TAGOPS Socket Server is running');
});

// Store connected agents and dashboards
const agents = new Map(); // socket.id -> serverName
const agentSockets = new Map(); // serverName -> socket.id
const dashboards = new Set(); // socket.id
const serverMetricsCache = new Map(); // serverName -> latest metrics object

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Agent connects and authenticates
  socket.on('agent:register', (data) => {
    const { serverName, token } = data;
    // In a real scenario, verify the token here
    agents.set(socket.id, serverName);
    agentSockets.set(serverName, socket.id);
    console.log(`Agent registered: ${serverName} (${socket.id})`);
    
    // Broadcast to dashboards that a new server is online
    io.to('dashboards').emit('server:status', { serverName, status: 'online' });
  });

  // Agent sends metrics
  socket.on('agent:metrics', async (metrics) => {
    const serverName = agents.get(socket.id);
    if (serverName) {
      serverMetricsCache.set(serverName, metrics);
      // Broadcast metrics to all connected dashboards
      io.to('dashboards').emit('server:metrics', { serverName, metrics });
      
      // Warning alert for High CPU
      if (metrics.cpuUsage > 90) {
        await alertQueue.add('high-cpu', {
          type: 'HIGH_CPU',
          serverName,
          metrics,
          message: `CPU usage is critically high (${metrics.cpuUsage}%).`,
          severity: 'warning'
        }, {
          removeOnComplete: true,
          removeOnFail: 10
        });
      }
    }
  });

  // Dashboard connects
  socket.on('dashboard:register', () => {
    dashboards.add(socket.id);
    socket.join('dashboards');
    console.log(`Dashboard registered: ${socket.id}`);
  });

  socket.on('disconnect', async () => {
    if (agents.has(socket.id)) {
      const serverName = agents.get(socket.id);
      console.log(`Agent disconnected: ${serverName}`);
      agents.delete(socket.id);
      agentSockets.delete(serverName);
      
      const lastMetrics = serverMetricsCache.get(serverName);
      io.to('dashboards').emit('server:status', { serverName, status: 'offline' });
      
      // Push critical alert to BullMQ
      await alertQueue.add('server-down', {
        type: 'SERVER_DOWN',
        serverName,
        metrics: lastMetrics,
        message: 'Server unexpectedly went offline.',
        severity: 'critical'
      });
    } else if (dashboards.has(socket.id)) {
      console.log(`Dashboard disconnected: ${socket.id}`);
      dashboards.delete(socket.id);
    } else {
      console.log(`Disconnected: ${socket.id}`);
    }
  });

  // --- Deployment Routing ---
  
  // From Dashboard -> Agent
  socket.on('deployment:trigger', ({ serverName, appName }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('deployment:trigger', { appName });
    } else {
      socket.emit('deployment:log', { serverName, appName, log: `Error: Agent ${serverName} is offline.\n` });
      socket.emit('deployment:end', { serverName, appName, success: false });
    }
  });

  socket.on('pm2:action', ({ serverName, appName, action }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('pm2:action', { appName, action });
    }
  });

  socket.on('app:create', ({ serverName, appData }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('app:create', appData);
    } else {
      socket.emit('deployment:log', { serverName, appName: appData.appName, log: `Error: Server ${serverName} is offline.\n` });
      socket.emit('deployment:end', { serverName, appName: appData.appName, success: false });
    }
  });

  socket.on('env:get', ({ serverName, appName }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('env:get', { appName });
    }
  });

  socket.on('env:save', ({ serverName, appName, envContent }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('env:save', { appName, envContent });
    }
  });

  socket.on('pm2:logs:start', ({ serverName, appName }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('pm2:logs:start', { appName });
    }
  });

  socket.on('pm2:logs:stop', ({ serverName, appName }) => {
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('pm2:logs:stop', { appName });
    }
  });

  socket.on('nginx:map', (data) => {
    const { serverName } = data;
    const agentSocketId = agentSockets.get(serverName);
    if (agentSocketId) {
      io.to(agentSocketId).emit('nginx:map', data);
    } else {
      socket.emit('deployment:log', { serverName, appName: data.appName, log: `Error: Server ${serverName} is offline.\n` });
      socket.emit('deployment:end', { serverName, appName: data.appName, success: false });
    }
  });

  socket.on('ufw:action', (data) => {
    const agentSocketId = agentSockets.get(data.serverName);
    if (agentSocketId) io.to(agentSocketId).emit('ufw:action', data);
  });

  socket.on('mongo:action', (data) => {
    const agentSocketId = agentSockets.get(data.serverName);
    if (agentSocketId) io.to(agentSocketId).emit('mongo:action', data);
  });

  socket.on('cron:action', (data) => {
    const agentSocketId = agentSockets.get(data.serverName);
    if (agentSocketId) io.to(agentSocketId).emit('cron:action', data);
  });

  // From Agent -> Dashboards
  socket.on('deployment:log', (data) => {
    io.to('dashboards').emit('deployment:log', data);
  });

  socket.on('env:data', (data) => {
    io.to('dashboards').emit('env:data', data);
  });

  socket.on('pm2:logs:data', (data) => {
    io.to('dashboards').emit('pm2:logs:data', data);
  });

  socket.on('deployment:end', async (data) => {
    io.to('dashboards').emit('deployment:end', data);
    
    try {
      await fetch(`${BACKEND_API_URL}/api/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: data.serverName,
          appName: data.appName,
          success: data.success,
          logs: data.fullLog
        })
      });
    } catch (err) {
      console.error('Failed to save deployment history:', err.message);
    }
  });
});

// Periodically ingest latest metrics to Backend API
setInterval(async () => {
  for (const [serverName, metrics] of serverMetricsCache.entries()) {
    try {
      await fetch(`${BACKEND_API_URL}/api/metrics/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, metrics })
      });
    } catch (err) {
      console.error(`Failed to persist metrics for ${serverName}:`, err.message);
    }
  }
}, 60000); // 1 minute

const PORT = process.env.PORT || 8001;

server.listen(PORT, () => {
  console.log(`Socket.IO Server running on port ${PORT}`);
});
