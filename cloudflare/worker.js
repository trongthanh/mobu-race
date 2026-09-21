// Cloudflare Worker + Durable Object realtime backend for Mobu Race.
import { createGameLogic, buildPlan, maxRacersForTime, randomSlots, progressAt } from '../src/game-logic.js';

// The worker and local server intentionally share the same plan/grid module;
// race type is presentation-only and never changes authoritative mechanics.
export { buildPlan, maxRacersForTime, randomSlots, progressAt };

// ---------------------------------------------------------------------------
// Cloudflare adapter
// ---------------------------------------------------------------------------

function makeCfAdapter() {
  const peers = new Map(); // ws -> user (maintained by registerPeer / unregisterPeer)
  return {
    send(ws, obj) {
      if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    broadcast(obj) {
      const data = JSON.stringify(obj);
      for (const ws of peers.keys()) {
        if (ws.readyState === 1) ws.send(data);
      }
    },
    registerPeer(ws, user) {
      peers.set(ws, user);
    },
    unregisterPeer(ws) {
      peers.delete(ws);
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

// ---------------------------------------------------------------------------
// Durable Object
// ---------------------------------------------------------------------------

export class RaceRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.logic = createGameLogic(makeCfAdapter());
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket endpoint; connect with Upgrade: websocket.', {
        status: 426,
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.connect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  connect(ws) {
    ws.accept();
    this.logic.connect(ws);

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data),
        );
      } catch {
        return;
      }
      this.logic.handleMessage(ws, msg);
    });

    ws.addEventListener('close', () => this.logic.disconnect(ws));
    ws.addEventListener('error', () => this.logic.disconnect(ws));
  }
}

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Mobu Race realtime worker. Connect to /ws.', {
        status: 200,
      });
    }
    const id = env.RACE_ROOM.idFromName('main');
    return env.RACE_ROOM.get(id).fetch(request);
  },
};
