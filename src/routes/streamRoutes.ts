import express, { Router } from "express";
import type { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { validateStreamToken } from "../services/streamService.js";
import { waitForFrame } from "../ws/cameraWs.js";

const router: Router = express.Router();
const PLACEHOLDER_PATH = path.resolve("./temp/placeholder.jpg");

let placeholderBuffer: Buffer | null = null;

(async () => {
  try {
    placeholderBuffer = await fs.readFile(PLACEHOLDER_PATH);
  } catch {
    placeholderBuffer = null;
  }
})();

function createMjpegFrame(frameBytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from("--frame\r\n"),
    Buffer.from("Content-Type: image/jpeg\r\n\r\n"),
    frameBytes,
    Buffer.from("\r\n"),
  ]);
}

router.get("/:token", async (req: Request, res: Response) => {
  const rawToken = req.params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!token) return res.sendStatus(400);

  const streamData = await validateStreamToken(token);
  if (!streamData?.horseId) return res.sendStatus(410);

  const horseId = streamData.horseId;

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache",
    Connection: "close",
    "X-Accel-Buffering": "no",
  });

  let firstFrame = true;

  while (!res.destroyed) {
    const frame = await waitForFrame(horseId);

    if (!frame) {
      if (firstFrame && placeholderBuffer) {
        res.write(createMjpegFrame(placeholderBuffer));
      }
      await new Promise(r => setTimeout(r, 50));
      continue;
    }

    firstFrame = false;

    const ok = res.write(createMjpegFrame(frame));
    if (!ok) {
      await new Promise(resolve => res.once("drain", resolve));
    }
  }
});

export default router;
