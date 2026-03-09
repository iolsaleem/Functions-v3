"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLane = detectLane;
exports.classifyEmail = classifyEmail;
exports.keywordClassifyBU = keywordClassifyBU;
exports.keywordClassifyTags = keywordClassifyTags;
exports.ragQuery = ragQuery;
exports.generateDailyBrief = generateDailyBrief;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const constants_1 = require("./constants");
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
// Model names — override in Azure Portal → Function App → Configuration
const MODEL_CLASSIFY = process.env.ANTHROPIC_MODEL_CLASSIFY ?? 'claude-haiku-4-5-20251001';
const MODEL_RAG = process.env.ANTHROPIC_MODEL_RAG ?? 'claude-sonnet-4-5-20251001';
const MODEL_BRIEF = process.env.ANTHROPIC_MODEL_BRIEF ?? 'claude-sonnet-4-5-20251001';
// ── LANE DETECTION ────────────────────────────────────────
// Runs BEFORE Claude to short-circuit low-value emails cheaply.
// Returns 'automated' | 'low-signal' | 'active'
function detectLane(email) {
    const senderEmail = email.from?.emailAddress?.address?.toLowerCase() ?? '';
    const subject = (email.subject ?? '').toLowerCase();
    const bodyPreview = (email.bodyPreview ?? '').toLowerCase();
    const combined = `${senderEmail} ${subject} ${bodyPreview}`;
    for (const group of constants_1.LOW_SIGNAL_GROUPS) {
        if (group.triggers.some(t => combined.includes(t.toLowerCase()))) {
            // 'automated' senders are noreply / system accounts
            return group.id === 'automated' ? 'automated' : 'low-signal';
        }
    }
    return 'active';
}
// ── MAIN CLASSIFY FUNCTION ────────────────────────────────
async function classifyEmail(email, pinnedSenderMap = {}) {
    const senderEmail = email.from?.emailAddress?.address?.toLowerCase() ?? '';
    const senderDomain = senderEmail.split('@')[1] ?? '';
    const isInternal = constants_1.INTERNAL_DOMAINS.some(d => senderDomain.endsWith(d));
    const isPinned = senderEmail in constants_1.PINNED_SENDERS || senderEmail in pinnedSenderMap;
    const isVip = !isInternal && constants_1.VIP_SENDERS.some(v => senderDomain.endsWith(v));
    // ── PINNED SENDER — instant Tier 1, no Claude ────────
    if (isPinned) {
        const bu = constants_1.PINNED_SENDERS[senderEmail] ?? pinnedSenderMap[senderEmail];
        return {
            bu, tier: 1, aiScore: 100, tags: ['pinned'], lane: 'active',
            isVip: false, isPinned: true, isInternal,
            summary: `Email from pinned sender (${bu}).`,
            actionRequired: '', suggestedDelegatee: null, sentiment: 'neutral',
        };
    }
    // ── LANE DETECTION — skip Claude for automated / low-signal ──
    const lane = detectLane(email);
    if (lane !== 'active') {
        return {
            bu: keywordClassifyBU(email.subject + ' ' + email.bodyPreview),
            tier: 3, aiScore: 10, tags: [], lane,
            isVip: false, isPinned: false, isInternal,
            summary: email.bodyPreview?.slice(0, 120) ?? '',
            actionRequired: '', suggestedDelegatee: null, sentiment: 'neutral',
        };
    }
    // ── KEYWORD PRE-CLASSIFICATION ────────────────────────
    const buGuess = keywordClassifyBU(email.subject + ' ' + email.bodyPreview);
    const tagGuess = keywordClassifyTags(email.subject + ' ' + email.bodyPreview);
    const quickScore = calculateQuickScore(email, isVip, tagGuess);
    // Only call Claude for Tier 1 candidates or ambiguous cases
    if (quickScore >= 50 || isVip) {
        return await claudeClassify(email, buGuess, tagGuess, quickScore, isVip, isPinned, isInternal);
    }
    return {
        bu: buGuess,
        tier: 3,
        aiScore: quickScore,
        tags: tagGuess,
        lane: 'active',
        isVip, isPinned, isInternal,
        summary: email.bodyPreview?.slice(0, 120) ?? '',
        actionRequired: '',
        suggestedDelegatee: null,
        sentiment: 'neutral',
    };
}
// ── CLAUDE CLASSIFICATION ─────────────────────────────────
async function claudeClassify(email, buHint, tagHint, scoreHint, isVip, isPinned, isInternal) {
    const prompt = `You are an AI assistant for Faisal Memon, CEO of iOL (Illusions Online), a travel technology and fintech company.

Classify this email and return a JSON object only — no markdown, no explanation.

EMAIL:
Subject: ${email.subject}
From: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>
Received: ${email.receivedDateTime}
Body preview: ${email.bodyPreview}

BU DEFINITIONS:
- Corporate: Board, investors, governance, auditors
- iOLX: Parent BU for all distribution sub-BUs
- iOLX Supply: Direct hotel connectivity and contracting
- iOL X3 Supply: Third-party wholesalers (Hotelbeds, WebBeds, etc.)
- iOLX Demand: B2B buyers of iOL hotel inventory
- iOL Pay: Payment acceptance, acquiring, MDR, gateway
- iOL Pay Issuing: VCC, virtual cards, TripLink, ConnexPay (INDEPENDENT from iOL Pay)
- iOL Pulse: Travel intelligence, data feeds, ARI, chain coverage
- iOL Edge: SaaS, white-label platform, technology licensing
- iOL Escapes: Luxury bespoke travel, UHNW, concierge
- Bank of iOL: Regulatory licensing, EMI, ADGM, MAS, FCA

Hints: BU=${buHint}, tags=${tagHint.join(',')}, score=${scoreHint}, vip=${isVip}

Return ONLY this JSON:
{
  "bu": "<one of the BU names exactly>",
  "aiScore": <0-100 integer>,
  "tags": [<array of: urgent|investor|contract|rfp|launch|regulatory|deadline|report>],
  "summary": "<1 sentence summary for CEO>",
  "actionRequired": "<what CEO needs to do, or empty string>",
  "suggestedDelegatee": "<email address of best delegate, or null>",
  "sentiment": "<positive|neutral|negative|urgent>"
}`;
    try {
        const msg = await anthropic.messages.create({
            model: MODEL_CLASSIFY,
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }],
        });
        const raw = msg.content[0].text.trim();
        const parsed = JSON.parse(raw);
        const tier = parsed.aiScore >= 80 || isVip ? 1 : parsed.aiScore >= 50 ? 2 : 3;
        return {
            bu: parsed.bu, tier, aiScore: parsed.aiScore,
            tags: parsed.tags ?? [], lane: 'active',
            isVip, isPinned, isInternal,
            summary: parsed.summary ?? '',
            actionRequired: parsed.actionRequired ?? '',
            suggestedDelegatee: parsed.suggestedDelegatee ?? null,
            sentiment: parsed.sentiment ?? 'neutral',
        };
    }
    catch (err) {
        console.error('Claude classify error, falling back:', err);
        const tier = scoreHint >= 80 || isVip ? 1 : scoreHint >= 50 ? 2 : 3;
        return {
            bu: buHint, tier, aiScore: scoreHint, tags: tagHint, lane: 'active',
            isVip, isPinned, isInternal,
            summary: email.bodyPreview?.slice(0, 120) ?? '',
            actionRequired: '', suggestedDelegatee: null, sentiment: 'neutral',
        };
    }
}
// ── KEYWORD BU CLASSIFIER ─────────────────────────────────
function keywordClassifyBU(text) {
    const lower = text.toLowerCase();
    let best = 'Corporate';
    let bestScore = 0;
    for (const [bu, keywords] of Object.entries(constants_1.BU_KEYWORDS)) {
        const score = keywords.filter(k => lower.includes(k.toLowerCase())).length;
        if (score > bestScore) {
            bestScore = score;
            best = bu;
        }
    }
    return best;
}
// ── KEYWORD TAG CLASSIFIER ────────────────────────────────
function keywordClassifyTags(text) {
    const lower = text.toLowerCase();
    const tags = [];
    for (const [tag, keywords] of Object.entries(constants_1.TAG_KEYWORDS)) {
        if (keywords.length > 0 && keywords.some(k => lower.includes(k.toLowerCase()))) {
            tags.push(tag);
        }
    }
    return tags;
}
// ── QUICK SCORE (no Claude) ───────────────────────────────
function calculateQuickScore(email, isVip, tags) {
    let score = 40; // baseline
    if (isVip)
        score += 40;
    if (tags.includes('urgent'))
        score += 20;
    if (tags.includes('regulatory'))
        score += 15;
    if (tags.includes('contract'))
        score += 10;
    if (tags.includes('investor'))
        score += 15;
    if (email.importance === 'high')
        score += 10;
    if (!email.isRead)
        score += 5;
    // +20 if CEO is in direct To recipients (not CC)
    const toAddresses = (email.toRecipients ?? []).map(r => r.emailAddress?.address?.toLowerCase() ?? '');
    const ceoEmail = (process.env.CEO_EMAIL || 'ceo@iol.world').toLowerCase();
    if (toAddresses.includes(ceoEmail))
        score += 20;
    // -15 if CEO is only CC'd (not direct recipient)
    const ccAddresses = (email.ccRecipients ?? []).map(r => r.emailAddress?.address?.toLowerCase() ?? '');
    if (!toAddresses.includes(ceoEmail) && ccAddresses.includes(ceoEmail))
        score -= 15;
    return Math.min(Math.max(score, 0), 100);
}
// ── RAG QUERY ─────────────────────────────────────────────
async function ragQuery(question, context) {
    const systemPrompt = `You are Athena, the AI assistant for Faisal Memon (fM), CEO of iOL (Illusions Online), a travel technology and fintech company based in Dubai.
You have direct access to his live Microsoft 365 data: emails, calendar, and Teams messages.
RULES:
- NEVER say you don't have access to emails. If email context is empty say "No emails found in current snapshot" and suggest trying again.
- Be concise and direct. Use iOL internal terminology correctly.
- Format with bullet points for lists. Bold names and subjects.
- Current date/time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })} GST`;
    const contextBlock = [
        context.emails.length > 0
            ? `EMAILS (${context.emails.length}):\n${context.emails.join('\n---\n')}`
            : context.emailsFailed
                ? 'EMAILS: [Temporarily unavailable — try again in 30 seconds]'
                : 'EMAILS: [No active emails in current snapshot]',
        context.calendar.length > 0 ? `CALENDAR:\n${context.calendar.join('\n')}` : 'CALENDAR: [No upcoming events]',
        context.teams.length > 0 ? `TEAMS:\n${context.teams.slice(0, 20).join('\n')}` : 'TEAMS: [No recent messages]',
    ].join('\n\n');
    const msg = await anthropic.messages.create({
        model: MODEL_RAG,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: `CONTEXT:\n${contextBlock}\n\n---\nQUESTION: ${question}` }],
    });
    return msg.content[0].text;
}
// ── DAILY BRIEF GENERATION ────────────────────────────────
async function generateDailyBrief(emails, calendarEvents) {
    const emailList = emails.slice(0, 20).map(e => `- [${e.tags.join(',')}] From ${e.from}: ${e.subject} — ${e.summary}`).join('\n');
    const calList = calendarEvents.slice(0, 10).map(e => `- ${e.start}: ${e.subject}`).join('\n');
    const msg = await anthropic.messages.create({
        model: MODEL_BRIEF,
        max_tokens: 600,
        messages: [{
                role: 'user',
                content: `Generate a concise CEO morning brief for Faisal Memon at iOL.

EMAILS NEEDING ATTENTION:
${emailList}

TODAY'S CALENDAR:
${calList}

Format:
1. Top 3 actions (most urgent first)
2. Key pending items
3. One relationship flag (if any contact hasn't been responded to in 48h+)
Keep under 200 words. Use bullet points.`,
            }],
    });
    return msg.content[0].text;
}
//# sourceMappingURL=classifier.js.map