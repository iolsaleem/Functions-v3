// ============================================================
// ATHENA SHARED TYPES & CONSTANTS
// ============================================================

export type BU =
  | 'Corporate'
  | 'iOLX'
  | 'iOLX Supply'
  | 'iOL X3 Supply'
  | 'iOLX Demand'
  | 'iOL Pay'
  | 'iOL Pay Issuing'
  | 'iOL Pulse'
  | 'iOL Edge'
  | 'iOL Escapes'
  | 'Bank of iOL'
  | 'Engineering';

export type SeniorityLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type FunctionCategory =
  | 'Executive'
  | 'Commercial'
  | 'Engineering'
  | 'Product'
  | 'Operations'
  | 'Finance'
  | 'HR'
  | 'Legal';

export type SensitivityLevel = 'Standard' | 'Confidential' | 'Board' | 'Private';

export type EmailTier = 1 | 2 | 3;

export type EmailStatus =
  | 'active'
  | 'done'
  | 'archived'
  | 'delegated'
  | 'snoozed'
  | 'escalated';

export type ChannelSource = 'email' | 'teams' | 'whatsapp';

export type TagType =
  | 'urgent'
  | 'investor'
  | 'contract'
  | 'rfp'
  | 'launch'
  | 'regulatory'
  | 'deadline'
  | 'report'
  | 'vip'
  | 'pinned';

// ── BU HIERARCHY ───────────────────────────────────────────
export const BU_HIERARCHY: Record<string, string | null> = {
  'Corporate':         null,
  'iOLX':              null,
  'iOLX Supply':       'iOLX',
  'iOL X3 Supply':     'iOLX',
  'iOLX Demand':       'iOLX',
  'iOL Pay':           null,
  'iOL Pay Issuing':   null,
  'iOL Pulse':         null,
  'iOL Edge':          null,
  'iOL Escapes':       null,
  'Bank of iOL':       null,
  'Engineering':       null,
};

// ── INTERNAL DOMAINS ───────────────────────────────────────
export const INTERNAL_DOMAINS = ['iol.world', 'illusions-online.com'];

// ── VIP SENDERS ────────────────────────────────────────────
// Add external contacts whose emails always surface to Tier 1
export const VIP_SENDERS: string[] = [
  // Investors
  'tpg.com', 'goldmansachs.com', 'summitpartners.com',
  // Key partners
  'accor.com', 'geidea.net', 'radissonhotels.com',
  // Regulators
  'adgm.com', 'centralbank.ae', 'sama.gov.sa', 'mas.gov.sg',
];

// ── PINNED SENDERS (always route to specified BU) ──────────
export const PINNED_SENDERS: Record<string, BU> = {
  'tony.h@iol.world':          'iOL Pay Issuing',
  'richard.c@iol.world':       'iOL Pay Issuing',
  'sam.n@iol.world':           'iOL Pay Issuing',
  'nicholas.d@iol.world':      'iOL Pay Issuing',
};

// ── BU KEYWORD CLASSIFIER ──────────────────────────────────
export const BU_KEYWORDS: Record<BU, string[]> = {
  'Corporate':       ['board', 'investor', 'funding', 'equity', 'audit', 'governance', 'metrics', 'term sheet', 'cap table'],
  'iOLX':            ['distribution', 'channel', 'iOLX', 'hospitality distribution'],
  'iOLX Supply':     ['rate loading', 'allocation', 'direct contract', 'property setup', 'connectivity', 'direct hotel', 'GDS'],
  'iOL X3 Supply':   ['wholesale', 'net rates', 'allotment', 'B2B rates', 'XML feed', 'supplier connectivity', 'hotelbeds', 'webbeds', 'expedia supply'],
  'iOLX Demand':     ['booking API', 'request for rates', 'markup', 'sell to our customers', 'demand partner', 'distribution sales'],
  'iOL Pay':         ['MDR', 'acquiring', 'merchant', 'payment gateway', 'acceptance', 'checkout', 'interchange', 'PSP', 'card scheme', 'settlement', 'payin'],
  'iOL Pay Issuing': ['VCC', 'virtual card', 'card issuing', 'ConnexPay', 'TripLink', 'BIN', 'card reconciliation', 'prepaid card', 'virtual credit card', 'card number'],
  'iOL Pulse':       ['intelligence', 'data feed', 'ARI', 'chain coverage', 'rate intelligence', 'market data', 'travel data'],
  'iOL Edge':        ['SaaS', 'white-label', 'platform license', 'API access', 'SDK', 'client portal', 'technology partner', 'subscription'],
  'iOL Escapes':     ['villa', 'luxury', 'bespoke', 'concierge', 'itinerary', 'UHNW', 'charter', 'safari', 'private', 'tailor-made', 'high-net-worth'],
  'Bank of iOL':     ['license', 'EMI', 'ADGM', 'regulatory', 'compliance', 'FCA', 'MPI', 'PSP license', 'central bank', 'MSB', 'payment institution'],
  'Engineering':     ['deployment', 'bug', 'sprint', 'PR', 'pull request', 'incident', 'downtime', 'infrastructure', 'release'],
};

// ── URGENT TRIGGER KEYWORDS ────────────────────────────────
export const URGENT_KEYWORDS = [
  'deadline', 'overdue', 'urgent', 'LOI', 'sign-off', '24h', 'EOD', 'ASAP',
  'license window', 'immediate', 'critical', 'today only', 'expires',
];

// ── TAG KEYWORD MAPS ───────────────────────────────────────
export const TAG_KEYWORDS: Record<TagType, string[]> = {
  urgent:     URGENT_KEYWORDS,
  investor:   ['portfolio', 'metrics', 'capital', 'term sheet', 'due diligence', 'DD', 'investment'],
  contract:   ['agreement', 'clause', 'MSA', 'LOI', 'NDA', 'sign', 'execute', 'draft v', 'contract'],
  rfp:        ['RFP', 'tender', 'proposal', 'invitation to bid', 'ITT', 'request for proposal'],
  launch:     ['go-live', 'launch', 'deploy', 'UAT', 'go/no-go', 'release', 'go live'],
  regulatory: ['license', 'authority', 'compliance', 'notice', 'submission', 'regulator'],
  deadline:   ['by Friday', 'by Monday', 'by EOD', 'respond by', 'submit by', 'confirm by'],
  report:     ['report', 'statement', 'summary', 'weekly', 'monthly', 'update'],
  vip:        [],
  pinned:     [],
};

// ── MONDAY.COM BOARD ROUTING ───────────────────────────────
// Loaded at runtime from env vars — gracefully undefined if not set
export const MONDAY_BOARDS: Partial<Record<BU, string>> = {};
const mondayEnvMap: Array<[string, BU]> = [
  ['MONDAY_BOARD_CORPORATE',  'Corporate'],
  ['MONDAY_BOARD_IOLX_SUPPLY','iOLX Supply'],
  ['MONDAY_BOARD_IOLX_X3',    'iOL X3 Supply'],
  ['MONDAY_BOARD_IOLX_DEMAND','iOLX Demand'],
  ['MONDAY_BOARD_IOLPAY',     'iOL Pay'],
  ['MONDAY_BOARD_ISSUING',    'iOL Pay Issuing'],
  ['MONDAY_BOARD_PULSE',      'iOL Pulse'],
  ['MONDAY_BOARD_EDGE',       'iOL Edge'],
  ['MONDAY_BOARD_ESCAPES',    'iOL Escapes'],
  ['MONDAY_BOARD_BANK',       'Bank of iOL'],
];
mondayEnvMap.forEach(([envKey, bu]) => {
  const val = process.env[envKey];
  if (val) MONDAY_BOARDS[bu] = val;
});

// ── ORG CHART ─────────────────────────────────────────────
// Source of truth for delegation defaults before Azure AD sync completes
export const DEFAULT_ORG: Record<string, { level: SeniorityLevel; buScope: BU[]; reportsTo: string | null; dotLines?: string[] }> = {
  'ceo@iol.world':          { level: 10, buScope: ['Corporate','iOLX','iOLX Supply','iOL X3 Supply','iOLX Demand','iOL Pay','iOL Pay Issuing','iOL Pulse','iOL Edge','iOL Escapes','Bank of iOL','Engineering'], reportsTo: null },
  'saleem.s@illusions-online.com': { level: 10, buScope: ['Corporate','iOLX','iOLX Supply','iOL X3 Supply','iOLX Demand','iOL Pay','iOL Pay Issuing','iOL Pulse','iOL Edge','iOL Escapes','Bank of iOL','Engineering'], reportsTo: null },
  'james.b@iol.world':      { level: 9,  buScope: ['Corporate','iOLX','iOLX Supply','iOL X3 Supply','iOLX Demand','iOL Pay Issuing','Bank of iOL'], reportsTo: 'ceo@iol.world' },
  'paul.d@iol.world':       { level: 8,  buScope: ['iOL Pay'], reportsTo: 'ceo@iol.world' },
  'wilmer.l@iol.world':     { level: 8,  buScope: ['Engineering'], reportsTo: 'ceo@iol.world' },
  'omer.b@iol.world':       { level: 5,  buScope: ['Corporate','iOLX','iOL Pay','iOL Pay Issuing','iOL Pulse','iOL Edge','iOL Escapes','Bank of iOL','Engineering'], reportsTo: 'ceo@iol.world' },
  'jeff.k@iol.world':       { level: 7,  buScope: ['iOLX','iOLX Supply','iOL Escapes'], reportsTo: 'james.b@iol.world' },
  'mohsen.k@iol.world':     { level: 6,  buScope: ['iOLX','iOL X3 Supply'], reportsTo: 'james.b@iol.world' },
  'sebastian.k@iol.world':  { level: 6,  buScope: ['iOL Edge'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
  'diego.l@iol.world':      { level: 5,  buScope: ['iOLX Demand'], reportsTo: 'james.b@iol.world' },
  'tahleel.a@iol.world':    { level: 5,  buScope: ['iOL X3 Supply','iOL Pulse'], reportsTo: 'mohsen.k@iol.world', dotLines: ['ceo@iol.world'] },
  'tony.h@iol.world':       { level: 6,  buScope: ['iOL Pay Issuing'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
  'richard.c@iol.world':    { level: 6,  buScope: ['iOL Pay Issuing'], reportsTo: 'james.b@iol.world', dotLines: ['ceo@iol.world'] },
  'arjun.r@iol.world':      { level: 3,  buScope: ['Corporate'], reportsTo: 'james.b@iol.world' },
  'gourav.j@iol.world':     { level: 4,  buScope: ['Engineering'], reportsTo: 'wilmer.l@iol.world' },
  'sam.n@iol.world':        { level: 4,  buScope: ['iOL Pay Issuing'], reportsTo: 'tony.h@iol.world' },
  'nicholas.d@iol.world':   { level: 4,  buScope: ['iOL Pay Issuing'], reportsTo: 'tony.h@iol.world' },
};

// ── LOW SIGNAL CATEGORIES ─────────────────────────────────
export const LOW_SIGNAL_GROUPS = [
  { id: 'banking',    label: 'Banking & Financial',  icon: '🏦', triggers: ['statement', 'transaction', 'credit', 'debit', 'receipt', 'payment advice'] },
  { id: 'automated',  label: 'Automated / System',   icon: '🤖', triggers: ['noreply', 'no-reply', 'donotreply', 'notifications@', 'alerts@', 'automated@'] },
  { id: 'social',     label: 'Social / LinkedIn',    icon: '🌐', triggers: ['linkedin.com', 'twitter.com', 'facebook.com', 'instagram.com'] },
  { id: 'marketing',  label: 'Marketing',            icon: '📣', triggers: ['unsubscribe', 'view in browser', 'monthly digest', 'special offer', 'promotion'] },
  { id: 'newsletter', label: 'Newsletters',          icon: '📰', triggers: ['newsletter', 'this week in', 'digest', 'mailchimp', 'sendgrid'] },
  { id: 'hr',         label: 'HR & Admin',           icon: '👥', triggers: ['payroll', 'leave request', 'expense', 'reimbursement', 'timesheet'] },
  { id: 'calendar',   label: 'Calendar Responses',  icon: '📅', triggers: ['accepted:', 'declined:', 'tentative:', 'meeting invitation'] },
];
