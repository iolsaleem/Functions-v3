"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadUser = loadUser;
exports.getCallerEmail = getCallerEmail;
exports.validateRequest = validateRequest;
exports.canAccessBU = canAccessBU;
exports.canAccessSensitivity = canAccessSensitivity;
exports.canDelegateTo = canDelegateTo;
exports.getValidDelegates = getValidDelegates;
const cosmos_1 = require("./cosmos");
const constants_1 = require("./constants");
// ── LOAD USER (Cosmos first, DEFAULT_ORG fallback) ────────
async function loadUser(email) {
    const lower = email.toLowerCase();
    // Try Cosmos first (live data)
    const cosmosUser = await (0, cosmos_1.getById)(cosmos_1.CONTAINERS.USERS, lower);
    if (cosmosUser)
        return cosmosUser;
    // Fall back to DEFAULT_ORG (before Cosmos is seeded)
    const defaults = constants_1.DEFAULT_ORG[lower];
    if (!defaults)
        return null;
    return {
        id: lower,
        email: lower,
        displayName: lower.split('@')[0].replace('.', ' '),
        level: defaults.level,
        buScope: defaults.buScope,
        function: 'Executive',
        sensitivityClearance: defaults.level >= 9 ? 'Board' : defaults.level >= 7 ? 'Confidential' : 'Standard',
        phaseAccess: defaults.level >= 9 ? 12 : defaults.level >= 7 ? 6 : 3,
        dotLineManagers: defaults.dotLines ?? [],
        isActive: true,
    };
}
// ── EXTRACT CALLER IDENTITY FROM SWA AUTH HEADERS ─────────
// Azure Static Web Apps injects these headers on every proxied request.
// x-ms-client-principal-name = the user's UPN / email from Azure AD.
// In local dev (APP_ENV=development), falls back to CEO_EMAIL env var.
function getCallerEmail(req) {
    // SWA-injected identity header (present in all authenticated requests)
    const principal = req.headers.get('x-ms-client-principal-name');
    if (principal)
        return principal.toLowerCase();
    // Local development fallback — never set in production
    if (process.env.APP_ENV === 'development') {
        return (process.env.DEV_USER_EMAIL || process.env.CEO_EMAIL || 'ceo@iol.world').toLowerCase();
    }
    return null;
}
// ── VALIDATE REQUEST & RETURN CALLER ──────────────────────
// Returns the verified caller email, or null if unauthenticated.
// All HTTP handlers call this instead of a shared API key check.
async function validateRequest(req) {
    const email = getCallerEmail(req);
    if (!email)
        return null;
    const user = await loadUser(email);
    if (!user || !user.isActive)
        return null;
    return { email, user };
}
// ── CAN USER ACCESS BU ────────────────────────────────────
function canAccessBU(user, bu) {
    if (user.level >= 10)
        return true;
    return user.buScope.includes(bu);
}
// ── CAN USER ACCESS SENSITIVITY ──────────────────────────
function canAccessSensitivity(user, sensitivity) {
    const levels = { 'Standard': 1, 'Confidential': 2, 'Board': 3, 'Private': 4 };
    const userLevel = levels[user.sensitivityClearance] ?? 1;
    const requiredLevel = levels[sensitivity] ?? 1;
    // Private is ONLY for fM (level 10, CEO)
    if (sensitivity === 'Private' && user.email !== (process.env.CEO_EMAIL || 'ceo@iol.world').toLowerCase())
        return false;
    return userLevel >= requiredLevel;
}
// ── CAN USER DELEGATE TO ──────────────────────────────────
function canDelegateTo(user, targetUser) {
    // Can only delegate downward (never upward)
    return targetUser.level < user.level;
}
// ── GET VALID DELEGATES FOR USER ──────────────────────────
async function getValidDelegates(user) {
    const allUsers = Object.keys(constants_1.DEFAULT_ORG);
    const delegates = [];
    for (const email of allUsers) {
        if (email === user.email)
            continue;
        const candidate = await loadUser(email);
        if (candidate && canDelegateTo(user, candidate)) {
            const hasOverlap = candidate.buScope.some(bu => user.buScope.includes(bu));
            if (hasOverlap || user.level >= 9)
                delegates.push(candidate);
        }
    }
    return delegates.sort((a, b) => b.level - a.level);
}
//# sourceMappingURL=rbac.js.map