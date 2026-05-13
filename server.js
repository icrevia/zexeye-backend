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

// In-memory device storage (Replace with MongoDB for production)
let devices = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Instantly send the current fleet state to the new dashboard connection
  socket.emit('fleet_update', Array.from(devices.values()));

  // Device registration
  socket.on('register', (deviceData) => {
    const deviceId = deviceData.id;
    const existing = devices.get(deviceId) || {};
    devices.set(deviceId, {
      ...existing,
      ...deviceData,
      socketId: socket.id,   // Always update socketId on reconnect
      lastSeen: new Date(),
      status: 'online'
    });
    console.log(`Device registered/reconnected: ${deviceId}`);
    io.emit('fleet_update', Array.from(devices.values()));
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

  // Dashboard command routing
  socket.on('command', (commandData) => {
    const { targetId, action, payload } = commandData;
    const device = devices.get(targetId);
    
    if (device && device.socketId) {
      console.log(`Routing command ${action} to ${targetId}`);
      io.to(device.socketId).emit('instruction', { action, payload });
    }
  });

  // Gallery relay
  socket.on('gallery_result', (data) => {
    console.log(`Gallery received from device: ${data.id}`);
    io.emit('gallery_result', data);
  });

  // Original image download relay
  socket.on('download_result', (data) => {
    console.log(`Download ready: ${data.name} (${data.id})`);
    io.emit('download_result', data);
  });

  socket.on('disconnect', () => {
    for (let [id, device] of devices.entries()) {
      if (device.socketId === socket.id) {
        devices.set(id, { ...device, status: 'offline' });
        console.log(`Device offline: ${id}`);
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
