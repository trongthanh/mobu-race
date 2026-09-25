import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createGameLogic, buildPlan, maxRacersForTime, randomSlots, progressAt } from '../src/game-logic.js';

// Keep the server export stable for tests and downstream callers while sharing
// the exact plan/grid implementation with the browser and Cloudflare worker.
export { buildPlan, maxRacersForTime, randomSlots, progressAt };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Node.js adapter ----------
function createNodeAdapter() {
  const peers = new Set();
  return {
    addPeer(ws) { peers.add(ws); },
    removePeer(ws) { peers.delete(ws); },
    send(ws, obj) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    },
    broadcast(obj) {
      const data = JSON.stringify(obj);
      for (const ws of peers) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      }
    },
    schedule(fn, ms) {
      return setTimeout(fn, ms);
    },
    clearSchedule(id) {
      clearTimeout(id);
    },
    scheduleInterval(fn, ms) {
      return setInterval(fn, ms);
    },
    clearScheduleInterval(id) {
      clearInterval(id);
    },
    now() {
      return Date.now();
    },
    uuid() {
      return crypto.randomUUID();
    },
  };
}

// ---------- server factory ----------
export function createGameServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  const logic = createGameLogic(createNodeAdapter());

  wss.on('connection', (ws) => {
    logic.connect(ws);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      logic.handleMessage(ws, msg);
    });

    ws.on('close', () => {
      logic.disconnect(ws);
    });
  });

  return { wss, state: () => logic.getState().state, users: () => logic.getState().users };
}

// ---------- auto-start ----------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const app = express();
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  // Alternate entries share the client shell: /live enables WebSockets;
  // /moon keeps the private race flow and opts into the Mid-Autumn skin.
  app.get(['/live', '/live/', '/moon', '/moon/'], (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  const httpServer = http.createServer(app);
  createGameServer(httpServer);
  const port = Number(process.env.PORT) || 3000;
  // Bind beyond loopback so the dev server is reachable over Tailscale.
  // Override HOST when a more restrictive interface is preferred.
  const host = process.env.HOST || '0.0.0.0';
  httpServer.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Mobu Race server listening on http://${displayHost}:${port}`);
  });
}
