import express, { Router } from "express";
import type { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { validateStreamToken } from "../services/streamService.js";
import { getNextFrame } from "../ws/cameraWs.js";

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

  // Fix: token can be string | string[]
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!token) return res.sendStatus(400);

  const streamData = await validateStreamToken(token);
  if (!streamData || !streamData.horseId) return res.sendStatus(410);

  const horseId: string = streamData.horseId; // now guaranteed string

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache",
    Connection: "close",
  });

  const interval = setInterval(() => {
    const frame = getNextFrame(horseId) || placeholderBuffer;
    if (!frame) return;

    res.write(createMjpegFrame(frame));
  }, 33); // ~30fps playback

  req.on("close", () => clearInterval(interval));
});

export default router;
