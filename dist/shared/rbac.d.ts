import { SeniorityLevel, BU } from './constants';
import type { HttpRequest } from '@azure/functions';
export interface AthenaUser {
    id: string;
    email: string;
    displayName: string;
    level: SeniorityLevel;
    buScope: BU[];
    function: string;
    sensitivityClearance: 'Standard' | 'Confidential' | 'Board' | 'Private';
    phaseAccess: number;
    dotLineManagers: string[];
    mondayUserId?: string;
    isActive: boolean;
}
export declare function loadUser(email: string): Promise<AthenaUser | null>;
export declare function getCallerEmail(req: HttpRequest): string | null;
export declare function validateRequest(req: HttpRequest): Promise<{
    email: string;
    user: AthenaUser;
} | null>;
export declare function canAccessBU(user: AthenaUser, bu: BU): boolean;
export declare function canAccessSensitivity(user: AthenaUser, sensitivity: string): boolean;
export declare function canDelegateTo(user: AthenaUser, targetUser: AthenaUser): boolean;
export declare function getValidDelegates(user: AthenaUser): Promise<AthenaUser[]>;
//# sourceMappingURL=rbac.d.ts.map