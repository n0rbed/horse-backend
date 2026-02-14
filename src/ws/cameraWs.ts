// src/ws/cameraWs.ts - Optimized with frame buffering
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { prisma } from "../lib/prisma.js";

// Frame buffer for each horse - stores up to 100 frames
interface FrameBuffer {
  frames: Buffer[];
  maxSize: number;
  writeIndex: number;
  readIndex: number;
  count: number;
}

const frameBuffers = new Map<string, FrameBuffer>();
const activeFrames = new Map<string, Buffer>();

const connectedCameras = new Map<
  string,
  {
    deviceId: string;
    horseId: string;
    thingName: string;
    connectedAt: number;
    frameCount: number;
    droppedFrames: number;
    ws: WebSocket;
  }
>();

function createFrameBuffer(maxSize: number = 100): FrameBuffer {
  return {
    frames: new Array(maxSize),
    maxSize,
    writeIndex: 0,
    readIndex: 0,
    count: 0,
  };
}

function enqueueFrame(buffer: FrameBuffer, frame: Buffer): boolean {
  if (buffer.count >= buffer.maxSize) {
    // Buffer full - drop oldest frame
    buffer.readIndex = (buffer.readIndex + 1) % buffer.maxSize;
    buffer.count--;
  }

  buffer.frames[buffer.writeIndex] = frame;
  buffer.writeIndex = (buffer.writeIndex + 1) % buffer.maxSize;
  buffer.count++;

  return true;
}

function dequeueFrame(buffer: FrameBuffer): Buffer | null {
  if (buffer.count === 0) {
    return null;
  }

  const frame = buffer.frames[buffer.readIndex];
  buffer.readIndex = (buffer.readIndex + 1) % buffer.maxSize;
  buffer.count--;

  return frame;
}

function getBufferStats(buffer: FrameBuffer) {
  return {
    count: buffer.count,
    maxSize: buffer.maxSize,
    utilization: ((buffer.count / buffer.maxSize) * 100).toFixed(1),
  };
}

function isValidImage(buffer: Buffer): boolean {
  return (
    buffer.length > 2 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

async function authenticateCamera(thingName: string): Promise<{
  authenticated: boolean;
  deviceId?: string;
  horseId?: string;
  error?: string;
}> {
  try {
    console.log(`🔍 Looking up camera: ${thingName}`);

    const device = await prisma.device.findUnique({
      where: { thingName },
      select: {
        id: true,
        deviceType: true,
        horsesAsCamera: {
          select: { id: true },
        },
      },
    });

    if (!device) {
      return { authenticated: false, error: "Camera not found in database" };
    }

    if (device.deviceType !== "CAMERA") {
      return { authenticated: false, error: "Device is not a camera" };
    }

    if (!device.horsesAsCamera || device.horsesAsCamera.length === 0) {
      return { authenticated: false, error: "Camera not linked to any horse" };
    }

    const horse = device.horsesAsCamera[0];

    return {
      authenticated: true,
      deviceId: device.id,
      horseId: horse!.id,
    };
  } catch (error) {
    console.error("❌ Camera auth error:", error);
    return { authenticated: false, error: "Database error" };
  }
}

function safeSend(ws: WebSocket, data: object): boolean {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ safeSend error:", error);
    return false;
  }
}

export function setupCameraWs(wss: WebSocketServer): void {
  console.log("🔹 Setting up camera WebSocket handlers");

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    console.log("\n🔵 ========== CAMERA CONNECTION ==========");
    console.log("URL:", req.url);

    // Extract thingName from URL: /ws/camera/CAMERA_NAME
    const urlParts = req.url?.split("/");
    const thingName = urlParts?.[3]?.split("?")[0];

    if (!thingName) {
      console.error("❌ No thingName in URL");
      safeSend(ws, {
        type: "ERROR",
        error: "Invalid URL format. Use /ws/camera/YOUR_THING_NAME",
      });
      ws.close();
      return;
    }

    console.log(`🔹 Camera connecting: ${thingName}`);

    try {
      safeSend(ws, { type: "CONNECTED", thingName });

      console.log("🔍 Authenticating...");
      const authResult = await authenticateCamera(thingName);

      if (!authResult.authenticated) {
        console.error(`❌ Auth failed: ${authResult.error}`);
        safeSend(ws, { type: "CAMERA_AUTH_FAILED", error: authResult.error });
        ws.close();
        return;
      }

      const cameraData = {
        deviceId: authResult.deviceId!,
        horseId: authResult.horseId!,
        thingName,
        connectedAt: Date.now(),
        frameCount: 0,
        droppedFrames: 0,
        ws,
      };

      connectedCameras.set(thingName, cameraData);

      // Create frame buffer for this horse
      if (!frameBuffers.has(cameraData.horseId)) {
        frameBuffers.set(cameraData.horseId, createFrameBuffer(100));
        console.log(`📦 Frame buffer created for horse: ${cameraData.horseId}`);
      }

      console.log(`✅ AUTHENTICATED`);
      console.log(`   Device: ${authResult.deviceId}`);
      console.log(`   Horse: ${authResult.horseId}`);

      safeSend(ws, {
        type: "CAMERA_AUTHENTICATED",
        message: "Camera stream active",
        horseId: authResult.horseId,
        thingName,
        timestamp: Date.now(),
      });

      console.log("✅ Waiting for frames...\n");

      // Handle frames
      ws.on("message", (data: Buffer) => {
        const camera = connectedCameras.get(thingName);
        if (!camera) return;

        // Check if it's a text message or binary frame
        if (data.length < 5000) {
          try {
            const text = data.toString("utf8");
            if (text.length < 200) {
              console.log(`📩 Received text message: ${text}`);
            }
          } catch (e) {
            // Not text, might be small image
          }
          return;
        }

        // Validate frame
        if (!isValidImage(data)) {
          camera.droppedFrames++;
          return;
        }

        camera.frameCount++;

        // Get or create frame buffer
        const buffer = frameBuffers.get(camera.horseId);
        if (buffer) {
          // Add frame to buffer
          enqueueFrame(buffer, data);

          // Also keep latest frame for immediate access
          activeFrames.set(camera.horseId, data);

          // Log stats every 300 frames
          if (camera.frameCount % 300 === 0) {
            const stats = getBufferStats(buffer);
            console.log(
              `🔹 ${thingName}: ${camera.frameCount} frames | Buffer: ${stats.count}/${stats.maxSize} (${stats.utilization}%) | Dropped: ${camera.droppedFrames}`
            );
          }
        }
      });

      ws.on("close", (code, reason) => {
        console.log(`\n🔴 Camera disconnected: ${thingName}`);
        console.log(`   Code: ${code}`);
        console.log(`   Reason: ${reason}`);

        const camera = connectedCameras.get(thingName);

        if (camera) {
          const uptime = ((Date.now() - camera.connectedAt) / 1000).toFixed(1);
          const buffer = frameBuffers.get(camera.horseId);
          const stats = buffer ? getBufferStats(buffer) : null;

          console.log(`   Frames received: ${camera.frameCount}`);
          console.log(`   Frames dropped: ${camera.droppedFrames}`);
          if (stats) {
            console.log(
              `   Buffer state: ${stats.count}/${stats.maxSize} (${stats.utilization}%)`
            );
          }
          console.log(`   Uptime: ${uptime}s\n`);

          // Clear active frame but keep buffer for streaming
          activeFrames.delete(camera.horseId);
          connectedCameras.delete(thingName);
        }
      });

      ws.on("error", (error) => {
        console.error(`❌ WebSocket error (${thingName}):`, error);
      });
    } catch (error) {
      console.error("❌ Handler error:", error);
      ws.close();
    }
  });
}

// Get latest frame (for immediate display)
export function getLatestFrame(horseId: string): Buffer | null {
  return activeFrames.get(horseId) || null;
}

// Get buffered frame (for smooth playback)
export function getBufferedFrame(horseId: string): Buffer | null {
  const buffer = frameBuffers.get(horseId);
  if (!buffer) return null;

  const frame = dequeueFrame(buffer);
  return frame || activeFrames.get(horseId) || null;
}

// Get buffer statistics
export function getBufferInfo(horseId: string) {
  const buffer = frameBuffers.get(horseId);
  if (!buffer) return null;

  return getBufferStats(buffer);
}

// Clear buffer for a horse
export function clearBuffer(horseId: string): void {
  const buffer = frameBuffers.get(horseId);
  if (buffer) {
    buffer.readIndex = 0;
    buffer.writeIndex = 0;
    buffer.count = 0;
  }
}

export function disconnectCamera(thingName: string): boolean {
  const camera = connectedCameras.get(thingName);
  if (camera) {
    camera.ws.close();
    return true;
  }
  return false;
}
