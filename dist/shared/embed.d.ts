import { GraphEmail, GraphEvent, GraphTeamsMessage } from './graph';
export declare function generateEmbedding(text: string): Promise<number[]>;
export declare function buildEmailEmbedText(email: {
    subject?: string;
    from?: {
        name?: string;
        email?: string;
    } | {
        emailAddress?: {
            name?: string;
            address?: string;
        };
    };
    bodyPreview?: string;
    bu?: string;
    tags?: string[];
    summary?: string;
}): string;
export declare function buildTeamsEmbedText(thread: {
    fromName?: string;
    content?: string;
    subject?: string;
    importanceScore?: number;
}): string;
export declare function buildCalendarEmbedText(event: {
    subject?: string;
    location?: string;
    attendees?: string[];
    bodyPreview?: string;
    start?: string;
}): string;
export declare function buildEmailEmbedTextFromGraph(email: GraphEmail): string;
export declare function buildCalendarEmbedTextFromGraph(event: GraphEvent): string;
export declare function buildTeamsEmbedTextFromGraph(msg: GraphTeamsMessage): string;
//# sourceMappingURL=embed.d.ts.map