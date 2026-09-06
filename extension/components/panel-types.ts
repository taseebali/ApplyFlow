import type { GroupId } from '@/lib/setup-groups';

/** Opens settings at a group, and optionally at one section inside it. */
export type OpenSetup = (group?: GroupId, step?: string) => void;
