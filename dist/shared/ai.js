"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_BRIEF = exports.MODEL_RAG = exports.MODEL_CLASSIFY = exports.AI_ENABLED = void 0;
exports.getAnthropicClient = getAnthropicClient;
/**
 * AI_ENABLED feature flag
 * ─────────────────────────────────────────────────────────────────────────────
 * Azure Portal → Function App → Environment variables:
 *   AI_ENABLED=false  → keyword fallbacks, no Anthropic API calls
 *   AI_ENABLED=true   → full Claude AI (default when var is absent)
 */
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
exports.AI_ENABLED = (process.env.AI_ENABLED ?? 'true').toLowerCase() !== 'false';
exports.MODEL_CLASSIFY = process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001';
exports.MODEL_RAG = process.env.ANTHROPIC_MODEL_RAG ?? 'claude-sonnet-4-5-20251001';
exports.MODEL_BRIEF = process.env.ANTHROPIC_MODEL_BRIEF ?? 'claude-sonnet-4-5-20251001';
// Returns an Anthropic client. Always import — SDK initialises lazily.
// Guard with AI_ENABLED check before calling.
function getAnthropicClient() {
    return new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
}
//# sourceMappingURL=ai.js.map