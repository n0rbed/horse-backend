import { Socket } from "socket.io";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../app.js";
import { publishWeightStreamStartMany, publishWeightStreamStopMany, } from "../iot/initAwsIot.js";
import { stopStreaming } from "../services/deviceService.js";
const STOP_GRACE_MS = 10000;
function feederRoom(thingName) {
    return `feeder-weight:${thingName}`;
}
function extractThingNameFromRoom(room) {
    return room.replace("feeder-weight:", "");
}
export async function initializeWeightStreaming(socket, userId, io) {
    try {
        const rows = await prisma.horse.findMany({
            where: {
                ownerId: userId,
                feeder: { deviceType: "FEEDER" },
            },
            select: {
                feeder: { select: { thingName: true } },
            },
        });
        const thingNames = rows.map((r) => r.feeder?.thingName);
        const toStart = [];
        for (const thingName of thingNames) {
            const room = feederRoom(thingName);
            const sizeBefore = io.sockets.adapter.rooms.get(room)?.size ?? 0;
            socket.join(room);
            if (sizeBefore === 0)
                toStart.push(thingName);
        }
        if (toStart.length) {
            await publishWeightStreamStartMany(toStart);
        }
    }
    catch (err) {
        console.error("❌ Weight streaming init failed", { userId, err });
    }
}
export async function handleLogout(socket, userId, io, ack) {
    socket.data.didLogout = true;
    try {
        // 1) Stop weight streaming immediately if last watcher
        const toStopNow = getLastWatcherRooms(socket, io);
        if (toStopNow.length) {
            await publishWeightStreamStopMany(toStopNow);
        }
        // 2) Stop active camera stream immediately if this is the last socket for that user
        await stopActiveUserStreamIfLastSocket(userId, io);
        // ACK back to client: server processed LOGOUT
        ack?.({ ok: true, stopped: toStopNow });
    }
    catch (err) {
        console.error("❌ LOGOUT stop failed", { userId, err });
        ack?.({ ok: false, error: err?.message ?? "LOGOUT failed" });
    }
    finally {
        socket.disconnect(true);
    }
}
export function handleDisconnecting(socket, userId, io) {
    if (socket.data.didLogout)
        return;
    const disconnectingSocketId = socket.id;
    const toMaybeStop = getLastWatcherRooms(socket, io);
    const snapshotThingNames = Object.freeze([...toMaybeStop]);
    const snapshotUserId = userId;
    // weights timer only if needed
    if (snapshotThingNames.length) {
        setTimeout(() => {
            const stillEmpty = [];
            for (const thingName of snapshotThingNames) {
                const room = feederRoom(thingName);
                const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
                if (size === 0)
                    stillEmpty.push(thingName);
            }
            if (!stillEmpty.length)
                return;
            publishWeightStreamStopMany(stillEmpty).catch((err) => {
                console.error("❌ Delayed weight STOP failed", {
                    userId: snapshotUserId,
                    socketId: disconnectingSocketId,
                    stillEmpty,
                    err,
                });
            });
        }, STOP_GRACE_MS);
    }
    // camera timer ONLY if this was the last user socket at disconnect time
    const userRoomSizeNow = io.sockets.adapter.rooms.get(snapshotUserId)?.size ?? 0;
    if (userRoomSizeNow !== 1)
        return;
    setTimeout(() => {
        const sizeAfterGrace = io.sockets.adapter.rooms.get(snapshotUserId)?.size ?? 0;
        if (sizeAfterGrace !== 0)
            return;
        stopActiveUserStreamIfNoSockets(snapshotUserId).catch((err) => {
            console.error("❌ Delayed camera STOP failed", {
                userId: snapshotUserId,
                socketId: disconnectingSocketId,
                err,
            });
        });
    }, STOP_GRACE_MS);
}
/**
 * Get feeder thingNames where this socket is the last watcher
 */
function getLastWatcherRooms(socket, io) {
    const result = [];
    for (const room of socket.rooms) {
        if (!room.startsWith("feeder-weight:"))
            continue;
        const sizeNow = io.sockets.adapter.rooms.get(room)?.size ?? 0;
        if (sizeNow === 1) {
            result.push(extractThingNameFromRoom(room));
        }
    }
    return result;
}
/**
 * Stop camera stream immediately ONLY if this socket is the last socket
 * in the user room (userId room). This handles multi-tabs correctly.
 */
async function stopActiveUserStreamIfLastSocket(userId, io) {
    const userRoomSize = io.sockets.adapter.rooms.get(userId)?.size ?? 0;
    if (userRoomSize !== 1)
        return; // not last socket
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeStreamHorseId: true },
    });
    if (user?.activeStreamHorseId) {
        await stopStreaming(user.activeStreamHorseId, userId);
    }
}
/**
 * Stop camera stream after grace ONLY if user room has 0 sockets.
 * (Used in disconnecting timer.)
 */
async function stopActiveUserStreamIfNoSockets(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeStreamHorseId: true },
    });
    if (user?.activeStreamHorseId) {
        await stopStreaming(user.activeStreamHorseId, userId);
    }
}
//# sourceMappingURL=weightStreaming.js.map