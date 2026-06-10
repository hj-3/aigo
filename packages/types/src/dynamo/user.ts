import type { ISODateString, OrgId, UserId, UserRole } from '../common.js';

export interface UserPreferences {
  readonly notifyOnAnalysisComplete: boolean;
  readonly notifyOnHighRisk: boolean;
  readonly notifyOnFixReady: boolean;
  readonly slackUserId?: string;
  readonly timezone: string;
  readonly language: 'ko' | 'en';
}

export interface UserItem {
  readonly PK: `USER#${UserId}`;
  readonly SK: 'METADATA';
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly githubLogin?: string;
  readonly role: UserRole;
  readonly preferences: UserPreferences;
  readonly isActive: boolean;
  readonly lastLoginAt?: ISODateString;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  // GSI1: orgId → email lookup
  readonly GSI1PK: `ORG#${OrgId}`;
  readonly GSI1SK: string; // email
}

export interface User extends Omit<UserItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {}
