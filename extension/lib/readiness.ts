import { missingRequiredFields, REQUIRED_FIELDS } from './profile-completeness';
import { groupForRequiredSection, type GroupId } from './setup-groups';
import type { Profile } from './schema';

/**
 * What stands between the user and applying, answered before they touch
 * anything.
 *
 * The old panel let you find out mid-fill, from a card that refused. Every
 * blocker here names the control that resolves it and where that control is,
 * because "your profile is incomplete" is not actionable and "Phone number is
 * empty → Add it" is.
 */

export interface Blocker {
  id: string;
  /** What is wrong, in the user's terms. */
  label: string;
  /** The verb on the link that fixes it. */
  action: string;
  target: GroupId;
  /** Which section inside the group to scroll to, when one is obvious. */
  step?: string;
}

export interface Readiness {
  blockers: Blocker[];
  /** A one-line summary when nothing is blocking. */
  summary: string;
  ready: boolean;
}

export interface ReadinessInput {
  profile: Profile;
  /** Source items with no variants in the bank. Empty when there is no bank. */
  uncoveredSources: number;
  totalSources: number;
  hasBank: boolean;
  documentsFolderLinked: boolean;
  aiConfigured: boolean;
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const blockers: Blocker[] = [];

  // Required fields first: these are the ones that actually stop a fill.
  for (const field of missingRequiredFields(input.profile)) {
    blockers.push({
      id: `required:${field.key}`,
      label: `${field.label} is empty`,
      action: 'Add it',
      target: groupForRequiredSection(field.section),
      step: field.section === 'workAuthorization' ? 'work-auth' : 'contact',
    });
  }

  if (!input.documentsFolderLinked) {
    blockers.push({
      id: 'documents',
      label: 'No documents folder linked',
      action: 'Link one',
      target: 'documents',
      step: 'documents',
    });
  }

  // A bank gap does not stop an application — the resume falls back to the
  // user's own wording — so it is reported as a warning, never as a blocker.
  const warnings: Blocker[] = [];
  if (input.hasBank && input.uncoveredSources > 0) {
    warnings.push({
      id: 'bank',
      label: `${input.uncoveredSources} of ${input.totalSources} items are not in the bank`,
      action: 'Rebuild',
      target: 'documents',
      step: 'bank',
    });
  }

  return {
    blockers: [...blockers, ...warnings],
    ready: blockers.length === 0,
    summary: summarize(input),
  };
}

function summarize(input: ReadinessInput): string {
  // Derived, not hardcoded: the required list is edited from time to time and
  // a stale "of 7" on screen would be wrong without anything failing.
  const missing = missingRequiredFields(input.profile).length;
  const parts = [`${REQUIRED_FIELDS.length - missing} of ${REQUIRED_FIELDS.length} required fields`];

  if (input.hasBank) {
    const covered = input.totalSources - input.uncoveredSources;
    parts.push(`bank covers ${covered} of ${input.totalSources} items`);
  } else if (input.aiConfigured) {
    parts.push('no tailoring bank yet');
  }

  return parts.join(', ');
}
