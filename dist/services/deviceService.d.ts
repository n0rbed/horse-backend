export declare function startFeeding(horseId: string, amountKg: number, userId: string): Promise<{
    feeding: {
        id: string;
        deviceId: string;
        horseId: string;
        status: import("@prisma/client").$Enums.FeedingStatus;
    };
    horse: {
        name: string;
        id: string;
        feederId: string | null;
    };
    feeder: {
        id: string;
        thingName: string;
        deviceType: import("@prisma/client").$Enums.DeviceType;
    };
}>;
/**
 * Start camera streaming for horse
 */
export declare function startStreaming(horseId: string, userId: string): Promise<{
    horse: {
        name: string;
        id: string;
        cameraId: string | null;
    };
    device: {
        id: string;
        thingName: string;
        deviceType: import("@prisma/client").$Enums.DeviceType;
    };
}>;
//# sourceMappingURL=deviceService.d.ts.map