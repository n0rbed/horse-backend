import type { Socket } from "socket.io";
export declare function initializeCameraStreaming(socket: Socket, userId: string): void;
export declare function getLatestFrame(horseId: string): Buffer | null;
export declare function getActiveCameraCount(): number;
//# sourceMappingURL=cameraStreaming.d.ts.map