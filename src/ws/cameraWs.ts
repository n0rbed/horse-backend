import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { prisma } from "../lib/prisma.js";

type FrameQueue = {
  queue: Buffer[];
  waiters: ((frame: Buffer) => void)[];
};

const frameQueues = new Map<string, FrameQueue>();
const MAX_QUEUE = 600; // ~10s @60fps

function isValidImage(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

async function authenticateCamera(thingName: string): Promise<{
  deviceId: string;
  horseId: string;
} | null> {
  const device = await prisma.device.findUnique({
    where: { thingName },
    select: {
      id: true,
      deviceType: true,
      horsesAsCamera: { select: { id: true } },
    },
  });

  if (!device) return null;
  if (device.deviceType !== "CAMERA") return null;
  if (!device.horsesAsCamera?.length) return null;

  return {
    deviceId: device.id,
    horseId: device.horsesAsCamera[0].id,
  };
}

export function setupCameraWs(wss: WebSocketServer): void {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url;
    if (!url) return ws.close();
    const parts = url.split("/");
    const thingName = parts[3];
    if (!thingName) return ws.close();

    const auth = await authenticateCamera(thingName);
    if (!auth) return ws.close();

    // Initialize the queue for this horse
    frameQueues.set(auth.horseId, { queue: [], waiters: [] });

    ws.on("message", (data: Buffer) => {
      if (!isValidImage(data)) return;
      const fq = frameQueues.get(auth.horseId);
      if (!fq) return;

      // Wake a waiting stream immediately
      const waiter = fq.waiters.shift();
      if (waiter) {
        waiter(data);
        return;
      }

      fq.queue.push(data);
      if (fq.queue.length > MAX_QUEUE) {
        fq.queue.shift(); // drop oldest if buffer too big
      }
    });

    ws.on("close", () => {
      frameQueues.delete(auth.horseId);
    });

    ws.on("error", () => {
      frameQueues.delete(auth.horseId);
    });
  });
}

/**
 * Waits for the next frame from a given horseId.
 * Resolves immediately if a frame is already queued.
 */
export async function waitForFrame(horseId: string): Promise<Buffer | null> {
  const fq = frameQueues.get(horseId);
  if (!fq) return null;

  if (fq.queue.length > 0) {
    return fq.queue.shift() ?? null;
  }

  return new Promise<Buffer>((resolve) => {
    fq.waiters.push(resolve);
  });
}
