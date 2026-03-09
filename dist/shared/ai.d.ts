/**
 * AI_ENABLED feature flag
 * ─────────────────────────────────────────────────────────────────────────────
 * Azure Portal → Function App → Environment variables:
 *   AI_ENABLED=false  → keyword fallbacks, no Anthropic API calls
 *   AI_ENABLED=true   → full Claude AI (default when var is absent)
 */
import Anthropic from '@anthropic-ai/sdk';
export declare const AI_ENABLED: boolean;
export declare const MODEL_CLASSIFY: string;
export declare const MODEL_RAG: string;
export declare const MODEL_BRIEF: string;
export declare function getAnthropicClient(): Anthropic;
//# sourceMappingURL=ai.d.ts.map