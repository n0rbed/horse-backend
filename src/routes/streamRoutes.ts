import express, { Request, Response, Router } from "express";
import path from "path";
import fs from "fs/promises";
import { validateStreamToken } from "../services/streamService.js";
import { getNextFrame } from "../ws/cameraWs.js";

const router: Router = express.Router();
const PLACEHOLDER_PATH = path.resolve("./temp/placeholder.jpg");

let placeholderBuffer: Buffer | null = null;

(async () => {
  placeholderBuffer = await fs.readFile(PLACEHOLDER_PATH);
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
  const streamData = await validateStreamToken(req.params.token);
  if (!streamData) return res.sendStatus(410);

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-cache",
    Connection: "close",
  });

  const interval = setInterval(() => {
    const frame = getNextFrame(streamData.horseId!) || placeholderBuffer;
    if (!frame) return;

    res.write(createMjpegFrame(frame));
  }, 33); // ~30fps playback

  req.on("close", () => clearInterval(interval));
});

export default router;
