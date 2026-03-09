"use strict";
// ============================================================
// ATHENA SHARED TYPES & CONSTANTS
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOW_SIGNAL_GROUPS = exports.DEFAULT_ORG = exports.MONDAY_BOARDS = exports.TAG_KEYWORDS = exports.URGENT_KEYWORDS = exports.BU_KEYWORDS = exports.PINNED_SENDERS = exports.VIP_SENDERS = exports.INTERNAL_DOMAINS = exports.BU_HIERARCHY = void 0;
// ── BU HIERARCHY ───────────────────────────────────────────
exports.BU_HIERARCHY = {
    'Corporate': null,
    'iOLX': null,
    'iOLX Supply': 'iOLX',
    'iOL X3 Supply': 'iOLX',
    'iOLX Demand': 'iOLX',
    'iOL Pay': null,
    'iOL Pay Issuing': null,
    'iOL Pulse': null,
    'iOL Edge': null,
    'iOL Escapes': null,
    'Bank of iOL': null,
    'Engineering': null,
};
// ── INTERNAL DOMAINS ───────────────────────────────────────
exports.INTERNAL_DOMAINS = ['iol.world', 'illusions-online.com'];
// ── VIP SENDERS ────────────────────────────────────────────
// Add external contacts whose emails always surface to Tier 1
exports.VIP_SENDERS = [
    // Investors
    'tpg.com', 'goldmansachs.com', 'summitpartners.com',
    // Key partners
    'accor.com', 'geidea.net', 'radissonhotels.com',
    // Regulators
    'adgm.com', 'centralbank.ae', 'sama.gov.sa', 'mas.gov.sg',
];
// ── PINNED SENDERS (always route to specified BU) ──────────
exports.PINNED_SENDERS = {
    'tony.h@iol.world': 'iOL Pay Issuing',
    'richard.c@iol.world': 'iOL Pay Issuing',
    'sam.n@iol.world': 'iOL Pay Issuing',
    'nicholas.d@iol.world': 'iOL Pay Issuing',
};
// ── BU KEYWORD CLASSIFIER ──────────────────────────────────
exports.BU_KEYWORDS = {
    'Corporate': ['board', 'investor', 'funding', 'equity', 'audit', 'governance', 'metrics', 'term sheet', 'cap table'],
    'iOLX': ['distribution', 'channel', 'iOLX', 'hospitality distribution'],
    'iOLX Supply': ['rate loading', 'allocation', 'direct contract', 'property setup', 'connectivity', 'direct hotel', 'GDS'],
    'iOL X3 Supply': ['wholesale', 'net rates', 'allotment', 'B2B rates', 'XML feed', 'supplier connectivity', 'hotelbeds', 'webbeds', 'expedia supply'],
    'iOLX Demand': ['booking API', 'request for rates', 'markup', 'sell to our customers', 'demand partner', 'distribution sales'],
    'iOL Pay': ['MDR', 'acquiring', 'merchant', 'payment gateway', 'acceptance', 'checkout', 'interchange', 'PSP', 'card scheme', 'settlement', 'payin'],
    'iOL Pay Issuing': ['VCC', 'virtual card', 'card issuing', 'ConnexPay', 'TripLink', 'BIN', 'card reconciliation', 'prepaid card', 'virtual credit card', 'card number'],
    'iOL Pulse': ['intelligence', 'data feed', 'ARI', 'chain coverage', 'rate intelligence', 'market data', 'travel data'],
    'iOL Edge': ['SaaS', 'white-label', 'platform license', 'API access', 'SDK', 'client portal', 'technology partner', 'subscription'],
    'iOL Escapes': ['villa', 'luxury', 'bespoke', 'concierge', 'itinerary', 'UHNW', 'charter', 'safari', 'private', 'tailor-made', 'high-net-worth'],
    'Bank of iOL': ['license', 'EMI', 'ADGM', 'regulatory', 'compliance', 'FCA', 'MPI', 'PSP license', 'central bank', 'MSB', 'payment institution'],
    'Engineering': ['deployment', 'bug', 'sprint', 'PR', 'pull request', 'incident', 'downtime', 'infrastructure', 'release'],
};
// ── URGENT TRIGGER KEYWORDS ────────────────────────────────
exports.URGENT_KEYWORDS = [
    'deadline', 'overdue', 'urgent', 'LOI', 'sign-off', '24h', 'EOD', 'ASAP',
    'license window', 'immediate', 'critical', 'today only', 'expires',
];
// ── TAG KEYWORD MAPS ───────────────────────────────────────
exports.TAG_KEYWORDS = {
    urgent: exports.URGENT_KEYWORDS,
    investor: ['portfolio', 'metrics', 'capital', 'term sheet', 'due diligence', 'DD', 'investment'],
    contract: ['agreement', 'clause', 'MSA', 'LOI', 'NDA', 'sign', 'execute', 'draft v', 'contract'],
    rfp: ['RFP', 'tender', 'proposal', 'invitation to bid', 'ITT', 'request for proposal'],
    launch: ['go-live', 'launch', 'deploy', 'UAT', 'go/no-go', 'release', 'go live'],
    regulatory: ['license', 'authority', 'compliance', 'notice', 'submission', 'regulator'],
    deadline: ['by Friday', 'by Monday', 'by EOD', 'respond by', 'submit by', 'confirm by'],
    report: ['report', 'statement', 'summary', 'weekly', 'monthly', 'update'],
    vip: [],
    pinned: [],
};
// ── MONDAY.COM BOARD ROUTING ───────────────────────────────
// Loaded at runtime from env vars — gracefully undefined if not set
exports.MONDAY_BOARDS = {};
const mondayEnvMap = [
    ['MONDAY_BOARD_CORPORATE', 'Corporate'],
    ['MONDAY_BOARD_IOLX_SUPPLY', 'iOLX Supply'],
    ['MONDAY_BOARD_IOLX_X3', 'iOL X3 Supply'],
    ['MONDAY_BOARD_IOLX_DEMAND', 'iOLX Demand'],
    ['MONDAY_BOARD_IOLPAY', 'iOL Pay'],
    ['MONDAY_BOARD_ISSUING', 'iOL Pay Issuing'],
    ['MONDAY_BOARD_PULSE', 'iOL Pulse'],
    ['MONDAY_BOARD_EDGE', 'iOL Edge'],
    ['MONDAY_BOARD_ESCAPES', 'iOL Escapes'],
    ['MONDAY_BOARD_BANK', 'Bank of iOL'],
];
mondayEnvMap.forEach(([envKey, bu]) => {
    const val = process.env[envKey];
    if (val)
        exports.MONDAY_BOARDS[bu] = val;
});
// ── ORG CHART ─────────────────────────────────────────────
// Source of truth for delegation defaults before Azure AD sync completes
exports.DEFAULT_ORG = {
    'ceo@iol.world': { level: 10, buScope: ['Corporate', 'iOLX', 'iOLX Supply', 'iOL X3 Supply', 'iOLX Demand', 'iOL Pay', 'iOL Pay Issuing', 'iOL Pulse', 'iOL Edge', 'iOL Escapes', 'Bank of iOL', 'Engineering'], reportsTo: null },
    'saleem.s@illusions-online.com': { level: 10, buScope: ['Corporate', 'iOLX', 'iOLX Supply', 'iOL X3 Supply', 'iOLX Demand', 'iOL Pay', 'iOL Pay Issuing', 'iOL Pulse', 'iOL Edge', 'iOL Escapes', 'Bank of iOL', 'Engineering'], reportsTo: null },
    'james.b@iol.world': { level: 9, buScope: ['Corporate', 'iOLX', 'iOLX Supply', 'iOL X3 Supply', 'iOLX Demand', 'iOL Pay Issuing', 'Bank of iOL'], reportsTo: 'ceo@iol.world' },
    'paul.d@iol.world': { level: 8, buScope: ['iOL Pay'], reportsTo: 'ceo@iol.world' },
    'wilmer.l@iol.world': { level: 8, buScope: ['Engineering'], reportsTo: 'ceo@iol.world' },
    'omer.b@iol.world': { level: 5, buScope: ['Corporate', 'iOLX', 'iOL Pay', 'iOL Pay Issuing', 'iOL Pulse', 'iOL Edge', 'iOL Escapes', 'Bank of iOL', 'Engineering'], reportsTo: 'ceo@iol.world' },
    'jeff.k@iol.world': { level: 7, buScope: ['iOLX', 'iOLX Supply', 'iOL Escapes'], reportsTo: 'james.b@iol.world' },
    'mohsen.k@iol.world': { level: 6, buScope: ['iOLX', 'iOL X3 Supply'], reportsTo: 'james.b@iol.world' },
    'sebastian.k@iol.world': { level: 6, buScope: ['iOL Edge'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
    'diego.l@iol.world': { level: 5, buScope: ['iOLX Demand'], reportsTo: 'james.b@iol.world' },
    'tahleel.a@iol.world': { level: 5, buScope: ['iOL X3 Supply', 'iOL Pulse'], reportsTo: 'mohsen.k@iol.world', dotLines: ['ceo@iol.world'] },
    'tony.h@iol.world': { level: 6, buScope: ['iOL Pay Issuing'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
    'richard.c@iol.world': { level: 6, buScope: ['iOL Pay Issuing'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
    'arjun.r@iol.world': { level: 3, buScope: ['Corporate'], reportsTo: 'james.b@iol.world' },
    'gourav.j@iol.world': { level: 4, buScope: ['Engineering'], reportsTo: 'wilmer.l@iol.world' },
    'sam.n@iol.world': { level: 4, buScope: ['iOL Pay Issuing'], reportsTo: 'tony.h@iol.world' },
    'nicholas.d@iol.world': { level: 4, buScope: ['iOL Pay Issuing'], reportsTo: 'tony.h@iol.world' },
};
// ── LOW SIGNAL CATEGORIES ─────────────────────────────────
exports.LOW_SIGNAL_GROUPS = [
    { id: 'banking', label: 'Banking & Financial', icon: '🏦', triggers: ['statement', 'transaction', 'credit', 'debit', 'receipt', 'payment advice'] },
    { id: 'automated', label: 'Automated / System', icon: '🤖', triggers: ['noreply', 'no-reply', 'donotreply', 'notifications@', 'alerts@', 'automated@'] },
    { id: 'social', label: 'Social / LinkedIn', icon: '🌐', triggers: ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com'] },
    { id: 'marketing', label: 'Marketing', icon: '📣', triggers: ['unsubscribe', 'view in browser', 'monthly digest', 'special offer', 'promotion'] },
    { id: 'newsletter', label: 'Newsletters', icon: '📰', triggers: ['newsletter', 'this week in', 'digest', 'mailchimp', 'sendgrid'] },
    { id: 'hr', label: 'HR & Admin', icon: '👥', triggers: ['payroll', 'leave request', 'expense', 'reimbursement', 'timesheet'] },
    { id: 'calendar', label: 'Calendar Responses', icon: '📅', triggers: ['accepted:', 'declined:', 'tentative:', 'meeting invitation'] },
];
//# sourceMappingURL=constants.js.map