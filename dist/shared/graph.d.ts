import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
export declare function graphClient(): Promise<Client>;
export declare function fetchRecentEmails(userEmail: string, top?: number, skip?: number, filterDate?: string): Promise<GraphEmail[]>;
export declare function fetchEmailById(userEmail: string, emailId: string): Promise<GraphEmail>;
export declare function fetchAttachments(userEmail: string, emailId: string): Promise<GraphAttachment[]>;
export declare function fetchCalendarEvents(userEmail: string, startDate: string, endDate: string): Promise<GraphEvent[]>;
export declare function fetchTeamsChats(userEmail: string): Promise<GraphTeamsMessage[]>;
export declare function archiveEmail(userEmail: string, emailId: string): Promise<void>;
export declare function markEmailRead(userEmail: string, emailId: string): Promise<void>;
export declare function sendTeamsMessage(fromUserEmail: string, toUserEmail: string, content: string): Promise<void>;
export declare function registerWebhook(userEmail: string): Promise<string>;
export interface GraphEmail {
    id: string;
    subject: string;
    from: {
        emailAddress: {
            name: string;
            address: string;
        };
    };
    toRecipients: Array<{
        emailAddress: {
            name: string;
            address: string;
        };
    }>;
    ccRecipients: Array<{
        emailAddress: {
            name: string;
            address: string;
        };
    }>;
    receivedDateTime: string;
    isRead: boolean;
    importance: string;
    hasAttachments: boolean;
    bodyPreview: string;
    body: {
        contentType: string;
        content: string;
    };
    conversationId: string;
}
export interface GraphAttachment {
    id: string;
    name: string;
    contentType: string;
    size: number;
}
export interface GraphEvent {
    id: string;
    subject: string;
    start: {
        dateTime: string;
        timeZone: string;
    };
    end: {
        dateTime: string;
        timeZone: string;
    };
    location: {
        displayName: string;
    };
    attendees: Array<{
        emailAddress: {
            name: string;
            address: string;
        };
        status: {
            response: string;
        };
    }>;
    organizer: {
        emailAddress: {
            name: string;
            address: string;
        };
    };
    isAllDay: boolean;
    showAs: string;
    importance: string;
    bodyPreview: string;
}
export interface GraphTeamsMessage {
    id: string;
    createdDateTime: string;
    from: {
        user: {
            displayName: string;
            id: string;
        };
    };
    body: {
        contentType: string;
        content: string;
    };
    importance: string;
    chatId: string;
}
export interface TeamsThread {
    id: string;
    chatId: string;
    fromName: string;
    fromUserId: string;
    content: string;
    subject?: string;
    createdDateTime: string;
    importance: string;
}
export declare function fetchAllTeamsThreads(userEmail: string, sinceDate?: string): Promise<TeamsThread[]>;
export declare function fetchEmailPageForBackfill(userEmail: string, nextLink?: string, filterDate?: string): Promise<{
    emails: import('./graph').GraphEmail[];
    nextLink?: string;
}>;
export declare function fetchSentPageForBackfill(userEmail: string, nextLink?: string, filterDate?: string): Promise<{
    emails: import('./graph').GraphEmail[];
    nextLink?: string;
}>;
//# sourceMappingURL=graph.d.ts.map