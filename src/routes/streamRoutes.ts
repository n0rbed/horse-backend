// src/routes/streamRoutes.ts - Optimized with buffered frame delivery
import express, { type Request, type Response, Router } from "express";
import path from "path";
import fs from "fs/promises";
import { validateStreamToken } from "../services/streamService.js";
import { getBufferedFrame, getLatestFrame, getBufferInfo } from "../ws/cameraWs.js";

const router: Router = express.Router();
const PLACEHOLDER_PATH = path.resolve("./temp/placeholder.jpg");

// Pre-load placeholder once at startup
let placeholderBuffer: Buffer | null = null;

(async () => {
  try {
    placeholderBuffer = await fs.readFile(PLACEHOLDER_PATH);
    console.log("✅ Placeholder image loaded");
  } catch (error) {
    console.error("❌ Failed to load placeholder:", error);
  }
})();

function createMjpegFrame(frameBytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from("--frame\r\n"),
    Buffer.from("Content-Type: image/jpeg\r\n"),
    Buffer.from(`Content-Length: ${frameBytes.length}\r\n\r\n`),
    frameBytes,
    Buffer.from("\r\n"),
  ]);
}

router.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const streamData = await validateStreamToken(token);
  
  if (!streamData) {
    return res.status(410).json({ error: "Stream expired" });
  }

  console.log(`🎥 Stream started for horse: ${streamData.horseId}`);

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    Connection: "close",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "X-Accel-Buffering": "no",
  });

  let frameCount = 0;
  let isActive = true;
  let consecutivePlaceholders = 0;
  let lastBufferLog = Date.now();

  // Adaptive frame rate based on buffer state
  let frameInterval = 33; // Start at ~30 FPS

  const streamLoop = () => {
    if (!isActive || res.destroyed || res.writableEnded) {
      return;
    }

    try {
      // Try to get buffered frame first (for smooth playback)
      let frameBytes = getBufferedFrame(streamData.horseId!);

      // If no buffered frame, try latest frame
      if (!frameBytes) {
        frameBytes = getLatestFrame(streamData.horseId!);
      }

      // If still no frame, use placeholder
      if (!frameBytes) {
        frameBytes = placeholderBuffer;
        consecutivePlaceholders++;
      } else {
        consecutivePlaceholders = 0;
      }

      // If we have too many placeholders, reduce frame rate
      if (consecutivePlaceholders > 10) {
        frameInterval = 100; // Slow down to 10 FPS when no frames
      } else if (consecutivePlaceholders === 0) {
        // Get buffer stats to adjust frame rate
        const bufferInfo = getBufferInfo(streamData.horseId!);
        
        if (bufferInfo) {
          const utilization = parseFloat(bufferInfo.utilization);
          
          // Adaptive frame rate based on buffer utilization
          if (utilization > 80) {
            // Buffer filling up - increase frame rate to drain it
            frameInterval = 20; // ~50 FPS
          } else if (utilization > 50) {
            // Moderate buffer - normal speed
            frameInterval = 33; // ~30 FPS
          } else if (utilization < 20) {
            // Buffer low - slow down slightly to avoid starvation
            frameInterval = 40; // ~25 FPS
          }

          // Log buffer stats every 5 seconds
          if (Date.now() - lastBufferLog > 5000) {
            console.log(
              `📊 Stream buffer: ${bufferInfo.count}/${bufferInfo.maxSize} (${bufferInfo.utilization}%) | FPS target: ${(1000 / frameInterval).toFixed(1)}`
            );
            lastBufferLog = Date.now();
          }
        }
      }

      if (!frameBytes) {
        // No frame and no placeholder - skip this iteration
        setTimeout(streamLoop, frameInterval);
        return;
      }

      const mjpegFrame = createMjpegFrame(frameBytes);

      // Write frame to response
      const writeSuccess = res.write(mjpegFrame);

      if (writeSuccess) {
        frameCount++;
        
        if (frameCount % 100 === 0) {
          console.log(
            `🔹 Stream: ${frameCount} frames sent (${(1000 / frameInterval).toFixed(1)} FPS target)`
          );
        }

        // Schedule next frame
        setTimeout(streamLoop, frameInterval);
      } else {
        // Backpressure - wait for drain event
        res.once("drain", () => {
          setTimeout(streamLoop, frameInterval);
        });
      }
    } catch (error) {
      console.error("❌ Stream error:", error);
      cleanup();
    }
  };

  const cleanup = () => {
    if (!isActive) return;
    isActive = false;

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
    
    const duration = ((Date.now() - lastBufferLog) / 1000).toFixed(1);
    console.log(
      `🔌 Stream closed: ${frameCount} frames sent in ${duration}s`
    );
  };

  req.on("close", cleanup);
  req.on("error", cleanup);

  // Start the streaming loop
  streamLoop();
});

// Health check endpoint
router.get("/health/:horseId", async (req: Request, res: Response) => {
  const { horseId } = req.params;
  const bufferInfo = getBufferInfo(horseId);

  if (!bufferInfo) {
    return res.status(404).json({
      error: "No active stream for this horse",
      horseId,
    });
  }

  return res.json({
    horseId,
    buffer: bufferInfo,
    status: "active",
  });
});

export default router;
