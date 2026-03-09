import { Container } from '@azure/cosmos';
export declare function container(name: string): Container;
export declare const CONTAINERS: {
    readonly EMAILS: "emails";
    readonly EMAIL_ARCHIVE: "email-archive";
    readonly SENT_ITEMS: "sent-items";
    readonly TEAMS_THREADS: "teams-threads";
    readonly CALENDAR_EVENTS: "calendar-events";
    readonly BRIEFS: "daily-briefs";
    readonly CONTACTS_INTEL: "contacts-intelligence";
    readonly CLASSIFIER_CONFIG: "classifier-config";
    readonly USERS: "users";
    readonly CONTACTS: "contacts";
    readonly COMPANIES: "companies";
    readonly CLASSIFIER: "classifier-corrections";
    readonly WEBHOOKS: "webhook-subscriptions";
    readonly BACKFILL_STATE: "backfill-state";
};
export declare function withRetry<T>(fn: () => Promise<T>, maxAttempts?: number, label?: string): Promise<T>;
export declare function upsert<T extends {
    id: string;
}>(containerName: string, item: T): Promise<T>;
export declare function query<T>(containerName: string, sql: string, params?: Array<{
    name: string;
    value: unknown;
}>): Promise<T[]>;
export declare function getById<T>(containerName: string, id: string, partitionKey?: string): Promise<T | null>;
export declare function vectorSearch<T>(containerName: string, embedding: number[], topK?: number, filter?: string): Promise<T[]>;
//# sourceMappingURL=cosmos.d.ts.map