import { getById, CONTAINERS } from './cosmos';
import { SeniorityLevel, BU, DEFAULT_ORG } from './constants';
import type { HttpRequest } from '@azure/functions';

export interface AthenaUser {
  id: string;                     // email address (primary key)
  email: string;
  displayName: string;
  level: SeniorityLevel;
  buScope: BU[];
  function: string;
  sensitivityClearance: 'Standard' | 'Confidential' | 'Board' | 'Private';
  phaseAccess: number;            // max phase number visible
  dotLineManagers: string[];      // emails of dotted-line managers
  mondayUserId?: string;          // cached Monday.com user ID
  isActive: boolean;
}

// ── LOAD USER (Cosmos first, DEFAULT_ORG fallback) ────────
export async function loadUser(email: string): Promise<AthenaUser | null> {
  const lower = email.toLowerCase();

  // Try Cosmos first (live data)
  const cosmosUser = await getById<AthenaUser>(CONTAINERS.USERS, lower);
  if (cosmosUser) return cosmosUser;

  // Fall back to DEFAULT_ORG (before Cosmos is seeded)
  const defaults = DEFAULT_ORG[lower];
  if (!defaults) return null;

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
export function getCallerEmail(req: HttpRequest): string | null {
  // SWA-injected identity header (present in all authenticated requests)
  const principal = req.headers.get('x-ms-client-principal-name');
  if (principal) return principal.toLowerCase();

  // Local development fallback — never set in production
  if (process.env.APP_ENV === 'development') {
    return (process.env.DEV_USER_EMAIL || process.env.CEO_EMAIL || 'ceo@iol.world').toLowerCase();
  }

  return null;
}

// ── VALIDATE REQUEST & RETURN CALLER ──────────────────────
// Returns the verified caller email, or null if unauthenticated.
// All HTTP handlers call this instead of a shared API key check.
export async function validateRequest(req: HttpRequest): Promise<{ email: string; user: AthenaUser } | null> {
  const email = getCallerEmail(req);
  if (!email) return null;

  const user = await loadUser(email);
  if (!user || !user.isActive) return null;

  return { email, user };
}

// ── CAN USER ACCESS BU ────────────────────────────────────
export function canAccessBU(user: AthenaUser, bu: BU): boolean {
  if (user.level >= 10) return true;
  return user.buScope.includes(bu);
}

// ── CAN USER ACCESS SENSITIVITY ──────────────────────────
export function canAccessSensitivity(user: AthenaUser, sensitivity: string): boolean {
  const levels = { 'Standard': 1, 'Confidential': 2, 'Board': 3, 'Private': 4 };
  const userLevel = levels[user.sensitivityClearance as keyof typeof levels] ?? 1;
  const requiredLevel = levels[sensitivity as keyof typeof levels] ?? 1;
  // Private is ONLY for fM (level 10, CEO)
  if (sensitivity === 'Private' && user.email !== (process.env.CEO_EMAIL || 'ceo@iol.world').toLowerCase()) return false;
  return userLevel >= requiredLevel;
}

// ── CAN USER DELEGATE TO ──────────────────────────────────
export function canDelegateTo(user: AthenaUser, targetUser: AthenaUser): boolean {
  // Can only delegate downward (never upward)
  return targetUser.level < user.level;
}

// ── GET VALID DELEGATES FOR USER ──────────────────────────
export async function getValidDelegates(user: AthenaUser): Promise<AthenaUser[]> {
  const allUsers = Object.keys(DEFAULT_ORG);
  const delegates: AthenaUser[] = [];
  for (const email of allUsers) {
    if (email === user.email) continue;
    const candidate = await loadUser(email);
    if (candidate && canDelegateTo(user, candidate)) {
      const hasOverlap = candidate.buScope.some(bu => user.buScope.includes(bu));
      if (hasOverlap || user.level >= 9) delegates.push(candidate);
    }
  }
  return delegates.sort((a, b) => b.level - a.level);
}
