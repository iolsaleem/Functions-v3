export type BU = 'Corporate' | 'iOLX' | 'iOLX Supply' | 'iOL X3 Supply' | 'iOLX Demand' | 'iOL Pay' | 'iOL Pay Issuing' | 'iOL Pulse' | 'iOL Edge' | 'iOL Escapes' | 'Bank of iOL' | 'Engineering';
export type SeniorityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type FunctionCategory = 'Executive' | 'Commercial' | 'Engineering' | 'Product' | 'Operations' | 'Finance' | 'HR' | 'Legal';
export type SensitivityLevel = 'Standard' | 'Confidential' | 'Board' | 'Private';
export type EmailTier = 1 | 2 | 3;
export type EmailStatus = 'active' | 'done' | 'archived' | 'delegated' | 'snoozed' | 'escalated';
export type ChannelSource = 'email' | 'teams' | 'whatsapp';
export type TagType = 'urgent' | 'investor' | 'contract' | 'rfp' | 'launch' | 'regulatory' | 'deadline' | 'report' | 'vip' | 'pinned';
export declare const BU_HIERARCHY: Record<string, string | null>;
export declare const INTERNAL_DOMAINS: string[];
export declare const VIP_SENDERS: string[];
export declare const PINNED_SENDERS: Record<string, BU>;
export declare const BU_KEYWORDS: Record<BU, string[]>;
export declare const URGENT_KEYWORDS: string[];
export declare const TAG_KEYWORDS: Record<TagType, string[]>;
export declare const MONDAY_BOARDS: Partial<Record<BU, string>>;
export declare const DEFAULT_ORG: Record<string, {
    level: SeniorityLevel;
    buScope: BU[];
    reportsTo: string | null;
    dotLines?: string[];
}>;
export declare const LOW_SIGNAL_GROUPS: {
    id: string;
    label: string;
    icon: string;
    triggers: string[];
}[];
//# sourceMappingURL=constants.d.ts.map