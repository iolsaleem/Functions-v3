import { BU } from './constants';
export declare function isMondayConfigured(): boolean;
export declare function getBoardId(bu: BU): string | null;
export declare function createMondayTask(params: {
    bu: BU;
    title: string;
    description: string;
    assigneeEmail: string;
    emailSubject: string;
    emailId: string;
}): Promise<{
    success: boolean;
    taskId?: string;
    reason?: string;
}>;
//# sourceMappingURL=monday.d.ts.map