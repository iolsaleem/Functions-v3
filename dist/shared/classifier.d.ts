import { BU, TagType, EmailTier } from './constants';
import { GraphEmail } from './graph';
export interface ClassificationResult {
    bu: BU;
    tier: EmailTier;
    aiScore: number;
    tags: TagType[];
    isVip: boolean;
    isPinned: boolean;
    isInternal: boolean;
    lane: 'active' | 'low-signal' | 'automated';
    summary: string;
    actionRequired: string;
    suggestedDelegatee: string | null;
    sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
}
export declare function detectLane(email: GraphEmail): 'automated' | 'low-signal' | 'active';
export declare function classifyEmail(email: GraphEmail, pinnedSenderMap?: Record<string, BU>): Promise<ClassificationResult>;
export declare function keywordClassifyBU(text: string): BU;
export declare function keywordClassifyTags(text: string): TagType[];
export declare function ragQuery(question: string, context: {
    emails: string[];
    calendar: string[];
    teams: string[];
    emailsFailed?: boolean;
}): Promise<string>;
export declare function generateDailyBrief(emails: Array<{
    subject: string;
    from: string;
    summary: string;
    tags: string[];
}>, calendarEvents: Array<{
    subject: string;
    start: string;
    end: string;
}>): Promise<string>;
//# sourceMappingURL=classifier.d.ts.map