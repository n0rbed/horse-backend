export declare function startFeeding(horseId: string, amountKg: number, userId: string): Promise<{
    feeding: {
        id: string;
        status: import("@prisma/client").$Enums.FeedingStatus;
        horseId: string;
        deviceId: string;
    };
    horse: {
        name: string;
        id: string;
        feederId: string | null;
    };
    feeder: {
        id: string;
        deviceType: import("@prisma/client").$Enums.DeviceType;
        thingName: string;
    };
}>;
/**
 * Start camera streaming for horse
 */
export declare function startStreaming(horseId: string, userId: string): Promise<{
    horse: {
        id: string;
        name: string;
    };
    device: {
        id: string;
        deviceType: import("@prisma/client").$Enums.DeviceType;
        thingName: string;
    };
    status: string;
}>;
export declare function stopStreaming(horseId: string, userId: string): Promise<{
    horse: {
        id: string;
        cameraId: string | null;
    };
    device: {
        id: string;
        deviceType: import("@prisma/client").$Enums.DeviceType;
        thingName: string;
    };
}>;
//# sourceMappingURL=deviceService.d.ts.map