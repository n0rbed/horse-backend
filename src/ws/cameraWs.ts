import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { prisma } from "../lib/prisma.js";

const frameQueues = new Map<string, Buffer[]>();
const connectedCameras = new Map<string, any>();

const MAX_QUEUE = 300; // ~5s @60fps

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

  if (!device || device.deviceType !== "CAMERA" || !device.horsesAsCamera?.length) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    deviceId: device.id,
    horseId: device.horsesAsCamera[0].id,
  };
}

export function setupCameraWs(wss: WebSocketServer): void {
  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const thingName = req.url?.split("/")[3];
    if (!thingName) return ws.close();

    const auth = await authenticateCamera(thingName);
    if (!auth.authenticated) return ws.close();

    connectedCameras.set(thingName, auth);
    frameQueues.set(auth.horseId!, []);

    ws.on("message", (data: Buffer) => {
      if (!isValidImage(data)) return;

      const queue = frameQueues.get(auth.horseId!);
      if (!queue) return;

      queue.push(data);

      if (queue.length > MAX_QUEUE) {
        queue.shift(); // controlled drop
      }
    });

    ws.on("close", () => {
      frameQueues.delete(auth.horseId!);
      connectedCameras.delete(thingName);
    });
  });
}

export function getNextFrame(horseId: string): Buffer | null {
  const queue = frameQueues.get(horseId);
  if (!queue || queue.length === 0) return null;
  return queue.shift()!;
}
