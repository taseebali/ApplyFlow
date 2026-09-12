/**
 * The five places settings live.
 *
 * Replaces fifteen pill-tabs that wrapped over four rows and always reset to
 * the first one — so every "Complete profile" link in the app landed on
 * Contact regardless of what was actually missing.
 *
 * Grouping is by what the user is trying to do, not by which storage key the
 * data ends up in: work authorisation sits with saved answers because both are
 * things a form asks, even though one is a profile field and the other is not.
 */

export type GroupId = 'profile' | 'answers' | 'documents' | 'ai' | 'history' | 'appearance';

export interface SetupGroup {
  id: GroupId;
  title: string;
  blurb: string;
  /** Step ids from SetupView, in the order they appear inside the group. */
  steps: string[];
}

export const SETUP_GROUPS: SetupGroup[] = [
  {
    id: 'profile',
    title: 'Profile',
    blurb: 'Contact, work, education, projects, skills',
    steps: ['contact', 'links', 'work', 'education', 'projects', 'skills', 'certifications', 'languages'],
  },
  {
    id: 'answers',
    title: 'Application answers',
    blurb: 'Work authorisation, logistics, saved answers',
    steps: ['work-auth', 'logistics', 'saved-answers', 'learned'],
  },
  {
    id: 'documents',
    title: 'Documents',
    blurb: 'Folder and tailoring bank',
    steps: ['documents', 'bank'],
  },
  {
    id: 'ai',
    title: 'AI',
    blurb: 'Provider, key, model and fallbacks',
    steps: ['ai'],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    blurb: 'How the panel looks',
    steps: ['appearance'],
  },
  {
    id: 'history',
    title: 'History',
    blurb: 'Applications, earlier versions',
    steps: ['applications', 'versions'],
  },
];

/**
 * Which group holds a given step, so a link can open the group *and* scroll to
 * the section rather than dropping the user at the top of a long page.
 */
export function groupForStep(stepId: string): GroupId | null {
  return SETUP_GROUPS.find((group) => group.steps.includes(stepId))?.id ?? null;
}

/**
 * The group a required-field section belongs to.
 *
 * `RequiredField.section` in profile-completeness.ts has carried this mapping's
 * input since it was written — its comment says it is there "so the UI can
 * point at the right setup tab" — and nothing ever read it.
 */
export function groupForRequiredSection(section: string): GroupId {
  return section === 'workAuthorization' ? 'answers' : 'profile';
}
