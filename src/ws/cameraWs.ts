import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { prisma } from "../lib/prisma.js";

const frameQueues = new Map<string, Buffer[]>();

const MAX_QUEUE = 300;

function isValidImage(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

async function authenticateCamera(thingName: string) {
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
  if (!device.horsesAsCamera || device.horsesAsCamera.length === 0) return null;

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

    frameQueues.set(auth.horseId, []);

    ws.on("message", (data: Buffer) => {
      if (!isValidImage(data)) return;

      const queue = frameQueues.get(auth.horseId);
      if (!queue) return;

      queue.push(data);

      if (queue.length > MAX_QUEUE) {
        queue.shift();
      }
    });

    ws.on("close", () => {
      frameQueues.delete(auth.horseId);
    });
  });
}

export function getNextFrame(horseId: string): Buffer | null {
  const queue = frameQueues.get(horseId);
  if (!queue || queue.length === 0) return null;
  return queue.shift()!;
}
