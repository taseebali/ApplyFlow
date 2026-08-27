# ApplyFlow UI Redesign + AI Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the side panel into a compact Daily view and a separate Setup area (first-run wizard, then tabs), give it a deliberate visual identity, and add AI-drafted answers for free-text application questions.

**Architecture:** The side panel gains a `view` state variable (`'daily' | 'setup'`) — no router library. Existing profile section components are reused unchanged by both the wizard shell and the tabbed settings shell. AI drafting extends the existing `Profile`/`Settings` storage models rather than introducing a new store, and sends the whole (small) projects directory to the LLM directly — no embeddings or retrieval layer.

**Tech Stack:** WXT 0.21, React 19, TypeScript 5.9, Manifest V3 (Chrome side panel API), Vitest (added in Task 1).

**Spec:** `docs/superpowers/specs/2026-08-27-ui-redesign-and-ai-drafting-design.md`

## Global Constraints

- All new UI must use the existing CSS custom properties in `extension/assets/base.css` (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--danger-bg/-text`, `--success-bg/-text`, `--warning-bg/-text`) — never hardcoded colors. Both light and dark must work.
- All new UI must reuse the existing `.btn`, `.btn-primary`, `.btn-danger`, `.btn-plain`, `.pill`, `.pill-neutral/-success/-warning/-danger`, and `.field` classes rather than inventing parallel styles.
- No external icon libraries, no CDN assets, no external fonts — the extension CSP forbids remote resources. Icons are hand-written inline SVG React components.
- Every schema/settings addition must be backfilled in the existing `withDefaults` pattern so previously-saved data still loads.
- Nothing is ever written into a page or submitted without the user seeing it first.
- Run `npm run compile` (tsc --noEmit) and `npm run build` from `extension/` before every commit; both must pass.
- Commit after each task. Commit messages: plain, no branding, no Claude/AI attribution tags.

---

### Task 1: Test infrastructure + schema and settings extensions

**Files:**
- Modify: `extension/package.json` (add vitest devDependency + `test` script)
- Create: `extension/vitest.config.ts`
- Modify: `extension/lib/schema.ts` (add `ProjectEntry`, `Profile.projects`)
- Modify: `extension/lib/settings.ts` (add `LlmSettings`, `Settings.llm`)
- Modify: `extension/lib/storage.ts` (backfill `projects`)
- Create: `extension/lib/storage.test.ts`
- Create: `extension/lib/settings.test.ts`

**Interfaces:**
- Consumes: existing `Profile`, `EMPTY_PROFILE`, `withDefaults` in `lib/storage.ts`; existing `Settings`, `EMPTY_SETTINGS` in `lib/settings.ts`.
- Produces:
  - `ProjectEntry { id: string; name: string; role: string; description: string; techStack: string; outcomes: string }` exported from `lib/schema.ts`
  - `Profile.projects: ProjectEntry[]`
  - `LlmSettings { backend: 'ollama' | 'openrouter' | null; ollamaModel: string; openRouterApiKey: string; openRouterModel: string }` exported from `lib/settings.ts`
  - `Settings.llm: LlmSettings`
  - `applyProfileDefaults(stored: Partial<Profile>): Profile` exported from `lib/storage.ts` (the existing private `withDefaults`, now exported so it is testable without mocking `browser.storage`)
  - `applySettingsDefaults(stored: Partial<Settings>): Settings` exported from `lib/settings.ts`

- [ ] **Step 1: Install Vitest**

```bash
cd extension && npm install -D vitest@^3
```

- [ ] **Step 2: Create the Vitest config**

Create `extension/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add the test script**

In `extension/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing tests**

Create `extension/lib/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyProfileDefaults } from './storage';
import { EMPTY_PROFILE } from './schema';

describe('applyProfileDefaults', () => {
  it('backfills projects for profiles saved before the field existed', () => {
    const legacy = { contact: { ...EMPTY_PROFILE.contact, firstName: 'Jordan' } };
    const result = applyProfileDefaults(legacy);
    expect(result.projects).toEqual([]);
    expect(result.contact.firstName).toBe('Jordan');
  });

  it('preserves projects that are already stored', () => {
    const stored = {
      projects: [
        { id: 'a', name: 'ApplyFlow', role: 'Author', description: 'd', techStack: 't', outcomes: 'o' },
      ],
    };
    expect(applyProfileDefaults(stored).projects).toHaveLength(1);
  });
});
```

Create `extension/lib/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applySettingsDefaults, EMPTY_SETTINGS } from './settings';

describe('applySettingsDefaults', () => {
  it('backfills llm settings for settings saved before the field existed', () => {
    const legacy = { notion: { token: 't', databaseId: 'd' } };
    const result = applySettingsDefaults(legacy);
    expect(result.llm.backend).toBeNull();
    expect(result.notion.token).toBe('t');
  });

  it('preserves a configured llm backend', () => {
    const stored = { llm: { ...EMPTY_SETTINGS.llm, backend: 'ollama' as const } };
    expect(applySettingsDefaults(stored).llm.backend).toBe('ollama');
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd extension && npm test`
Expected: FAIL — `applyProfileDefaults` / `applySettingsDefaults` are not exported.

- [ ] **Step 6: Extend the profile schema**

In `extension/lib/schema.ts`, add above the `Profile` interface:

```ts
export interface ProjectEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  techStack: string;
  outcomes: string;
}
```

Add `projects: ProjectEntry[];` to the `Profile` interface (immediately after `education`), and `projects: [],` to `EMPTY_PROFILE` (same position).

Add `Array.isArray(v.projects) &&` to the `isProfile` type guard's return expression.

- [ ] **Step 7: Extend settings**

Replace the contents of `extension/lib/settings.ts` with:

```ts
export interface LlmSettings {
  /** null means "not configured" — the drafting feature stays inactive. */
  backend: 'ollama' | 'openrouter' | null;
  ollamaModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
}

export interface Settings {
  notion: {
    token: string;
    databaseId: string;
  };
  llm: LlmSettings;
}

export const EMPTY_SETTINGS: Settings = {
  notion: { token: '', databaseId: '' },
  llm: {
    backend: null,
    ollamaModel: 'llama3.1',
    openRouterApiKey: '',
    openRouterModel: 'anthropic/claude-3.5-sonnet',
  },
};

const SETTINGS_KEY = 'settings';

/** Backfills any sections added to Settings after a user's data was last saved. */
export function applySettingsDefaults(stored: Partial<Settings>): Settings {
  return {
    notion: { ...EMPTY_SETTINGS.notion, ...stored.notion },
    llm: { ...EMPTY_SETTINGS.llm, ...stored.llm },
  };
}

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return stored ? applySettingsDefaults(stored) : EMPTY_SETTINGS;
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}
```

- [ ] **Step 8: Export and extend the profile backfill**

In `extension/lib/storage.ts`, rename `withDefaults` to `applyProfileDefaults`, export it, add `projects: stored.projects ?? EMPTY_PROFILE.projects,` after the `education` line, and update the call site in `getProfile`:

```ts
/** Backfills any top-level sections added to Profile after a user's data was last saved. */
export function applyProfileDefaults(stored: Partial<Profile>): Profile {
  return {
    contact: { ...EMPTY_PROFILE.contact, ...stored.contact },
    links: { ...EMPTY_PROFILE.links, ...stored.links },
    workHistory: stored.workHistory ?? EMPTY_PROFILE.workHistory,
    education: stored.education ?? EMPTY_PROFILE.education,
    projects: stored.projects ?? EMPTY_PROFILE.projects,
    workAuthorization: { ...EMPTY_PROFILE.workAuthorization, ...stored.workAuthorization },
    logistics: { ...EMPTY_PROFILE.logistics, ...stored.logistics },
    customQA: stored.customQA ?? EMPTY_PROFILE.customQA,
  };
}

export async function getProfile(): Promise<Profile> {
  const result = await browser.storage.local.get(PROFILE_KEY);
  const stored = result[PROFILE_KEY] as Partial<Profile> | undefined;
  return stored ? applyProfileDefaults(stored) : EMPTY_PROFILE;
}
```

- [ ] **Step 9: Run tests, compile, and build**

Run: `cd extension && npm test && npm run compile && npm run build`
Expected: tests PASS, tsc reports no errors, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add extension/package.json extension/package-lock.json extension/vitest.config.ts extension/lib/schema.ts extension/lib/settings.ts extension/lib/storage.ts extension/lib/storage.test.ts extension/lib/settings.test.ts
git commit -m "Add projects and LLM settings to stored data, with tests"
```

---

### Task 2: Icon set and action-card styles

**Files:**
- Create: `extension/components/icons.tsx`
- Modify: `extension/assets/base.css` (append `.card` / `.action-card` styles)

**Interfaces:**
- Consumes: existing CSS custom properties from `assets/base.css`.
- Produces: from `components/icons.tsx`, React components `FillIcon`, `AttachIcon`, `TrackerIcon`, `DraftIcon`, `GearIcon`, `BackIcon` — each `(props: { className?: string }) => JSX.Element`, rendering a 20x20 `<svg>` with `stroke="currentColor"`, `strokeWidth={1.5}`, `fill="none"`.
- Produces: CSS classes `.action-card`, `.action-card-icon`, `.action-card-body`, `.action-card-title`, `.action-card-desc`, `.action-card-result`, and tint modifiers `.tint-blue`, `.tint-green`, `.tint-amber`, `.tint-neutral`.

- [ ] **Step 1: Create the icon components**

Create `extension/components/icons.tsx`:

```tsx
interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FillIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6h10M4 12h16M4 18h7" />
      <path d="M17 15l3 3-3 3" />
    </Svg>
  );
}

export function AttachIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 7.5V16a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v9.5a1 1 0 0 1-2 0V8" />
    </Svg>
  );
}

export function TrackerIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5v10M15 9.5v10" />
    </Svg>
  );
}

export function DraftIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3.5l1.6 4.3 4.4 1.7-4.4 1.7L12 15.5l-1.6-4.3L6 9.5l4.4-1.7z" />
      <path d="M18 15.5l.8 2.1 2.2.9-2.2.9-.8 2.1-.8-2.1-2.2-.9 2.2-.9z" />
    </Svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}
```

- [ ] **Step 2: Append the action-card styles**

Append to `extension/assets/base.css`:

```css
.action-card {
  display: flex;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 14px;
  transition: border-color 0.15s ease, transform 0.1s ease;
}

.action-card:hover:not(:disabled) {
  border-color: var(--text-muted);
}

.action-card:active:not(:disabled) {
  transform: scale(0.995);
}

.action-card:disabled {
  opacity: 0.6;
  cursor: default;
}

.action-card-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.action-card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.action-card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.action-card-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.action-card-result {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tint-blue .action-card-icon {
  background: var(--tint-blue-bg);
  color: var(--tint-blue-text);
}

.tint-green .action-card-icon {
  background: var(--success-bg);
  color: var(--success-text);
}

.tint-amber .action-card-icon {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.tint-neutral .action-card-icon {
  background: var(--surface-hover);
  color: var(--text-muted);
}
```

- [ ] **Step 3: Add the missing blue tint tokens**

In `extension/assets/base.css`, add to the `:root` block (alongside the other tint tokens):

```css
  --tint-blue-bg: #e1f3fe;
  --tint-blue-text: #1f6c9f;
```

And to the `@media (prefers-color-scheme: dark)` `:root` block:

```css
  --tint-blue-bg: #16303f;
  --tint-blue-text: #86c5ea;
```

- [ ] **Step 4: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/components/icons.tsx extension/assets/base.css
git commit -m "Add inline SVG icon set and action-card styles"
```

---

### Task 3: Extract the Daily view with action cards

**Files:**
- Create: `extension/components/DailyView.tsx`
- Create: `extension/components/ActionCard.tsx`
- Modify: `extension/entrypoints/sidepanel/App.tsx` (delegate to `DailyView`)
- Modify: `extension/entrypoints/sidepanel/App.css`

**Interfaces:**
- Consumes: `FillIcon`, `AttachIcon`, `TrackerIcon` from `components/icons.tsx` (Task 2); the action-card CSS classes from Task 2; existing message types `FillPageMessage`, `FillPageResponse`, `GetJobInfoMessage`, `GetJobInfoResponse`, `AttachDocumentsMessage`, `AttachDocumentsResponse` from `entrypoints/content.ts`; `getDocumentsFolderHandle`, `ensureReadPermission` from `lib/document-store.ts`; `findBestMatch`, `listFolderFiles` from `lib/document-matcher.ts`; `getSettings` from `lib/settings.ts`; `logApplicationToNotion` from `lib/notion-client.ts`.
- Produces:
  - `ActionCard` from `components/ActionCard.tsx` with props `{ icon: React.ReactNode; title: string; description: string; tint: 'blue' | 'green' | 'amber' | 'neutral'; onClick: () => void; disabled?: boolean; children?: React.ReactNode }` — renders a `<button className="action-card tint-{tint}">`; `children` render inside `.action-card-result`.
  - `DailyView` from `components/DailyView.tsx` with props `{ onOpenSetup: () => void }`.
  - `getActiveTabId(): Promise<number>` exported from `components/DailyView.tsx` (moved from `App.tsx`, reused by Task 8).

- [ ] **Step 1: Create the ActionCard component**

Create `extension/components/ActionCard.tsx`:

```tsx
interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tint: 'blue' | 'green' | 'amber' | 'neutral';
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function ActionCard({ icon, title, description, tint, onClick, disabled, children }: ActionCardProps) {
  return (
    <button type="button" className={`action-card tint-${tint}`} onClick={onClick} disabled={disabled}>
      <span className="action-card-icon">{icon}</span>
      <span className="action-card-body">
        <span className="action-card-title">{title}</span>
        <span className="action-card-desc">{description}</span>
        {children && <span className="action-card-result">{children}</span>}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Create DailyView by moving the existing logic**

Create `extension/components/DailyView.tsx`. Move `getActiveTabId`, the whole `FillAndAttachSection` body, and the whole `LogToNotionSection` body out of `entrypoints/sidepanel/App.tsx` into this file, keeping every handler's logic byte-for-byte identical (`handleFillClick`, `attachDocuments`, `handleCheckDocuments`, `handleConfirmAttach`, `inferSource`, `handleStart`, `updateForm`, `handleConfirm`, and all their `useState` types). Export `getActiveTabId`.

Then replace each section's outer `<section className="actions-section">` + bare `<button>` with an `ActionCard`, moving the status output inside it as `children`:

```tsx
<ActionCard
  icon={<FillIcon />}
  title="Fill this page"
  description="Fills the form from your saved profile."
  tint="blue"
  onClick={handleFillClick}
  disabled={fillStatus.kind === 'filling'}
>
  {fillStatus.kind === 'filling' && <span className="pill pill-neutral">Filling…</span>}
  {fillStatus.kind === 'done' && (
    <>
      <span className={`pill ${fillStatus.unmatchedCount > 0 ? 'pill-warning' : 'pill-success'}`}>
        {fillStatus.filledCount} filled
      </span>
      {fillStatus.unmatchedCount > 0 && (
        <span className="pill pill-neutral">{fillStatus.unmatchedCount} need attention</span>
      )}
      {fillStatus.unmatchedLabels.length > 0 && (
        <span className="unmatched-labels">{fillStatus.unmatchedLabels.join(' · ')}</span>
      )}
    </>
  )}
  {fillStatus.kind === 'error' && <span className="pill pill-danger">{fillStatus.message}</span>}
</ActionCard>
```

Apply the same treatment to Attach documents (`AttachIcon`, `tint="green"`, description `"Finds and attaches your resume and cover letter."`, keeping the existing `doc-results`/`doc-row` markup as children) and Log to Notion (`TrackerIcon`, `tint="amber"`, description `"Saves this application to your Notion tracker."`).

Note: the Notion log form and the document "Attach" buttons are interactive controls that must NOT be nested inside the card `<button>` (nested interactive elements are invalid HTML). Render them as siblings *below* the card instead, inside the wrapping `<div className="daily-actions">`.

Export the composed component:

```tsx
export function DailyView({ onOpenSetup }: { onOpenSetup: () => void }) {
  return (
    <div className="daily-actions">
      {/* fill card, attach card + its attach buttons, notion card + its log form */}
    </div>
  );
}
```

(`onOpenSetup` is consumed in Task 4 when the header is added; accept it now so the interface is stable.)

- [ ] **Step 3: Reduce App.tsx to a shell**

`entrypoints/sidepanel/App.tsx` keeps only the profile-editor wiring for now and renders `<DailyView onOpenSetup={() => {}} />` where `<FillAndAttachSection />` and `<LogToNotionSection />` used to be. Task 4 replaces the rest.

- [ ] **Step 4: Move the result styles**

In `extension/entrypoints/sidepanel/App.css`, add:

```css
.panel .daily-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel .unmatched-labels {
  display: block;
  width: 100%;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}
```

Delete the now-unused `.panel .actions-section`, `.panel .actions-section .btn`, and `.panel .status-row` rules.

- [ ] **Step 5: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds.

- [ ] **Step 6: Verify in the browser**

Reload the extension at `brave://extensions`, open the side panel on a real job application page, and confirm: three tinted action cards render, "Fill this page" still fills and shows counts inside its card, "Attach documents" still finds/attaches files, "Log to Notion" still opens its form.

- [ ] **Step 7: Commit**

```bash
git add extension/components/ActionCard.tsx extension/components/DailyView.tsx extension/entrypoints/sidepanel/App.tsx extension/entrypoints/sidepanel/App.css
git commit -m "Rework daily actions as tinted action cards"
```

---

### Task 4: Setup shell — first-run wizard and settings tabs

**Files:**
- Create: `extension/components/Wizard.tsx`
- Create: `extension/components/SetupView.tsx`
- Modify: `extension/entrypoints/sidepanel/App.tsx` (view switching + header)
- Modify: `extension/entrypoints/sidepanel/App.css`
- Modify: `extension/components/ProfileForm.tsx` (export individual sections)

**Interfaces:**
- Consumes: `GearIcon`, `BackIcon` from `components/icons.tsx`; `useProfileEditor` from `components/useProfileEditor.ts`; `DailyView` from Task 3.
- Produces:
  - From `components/ProfileForm.tsx`, these must all be exported (several currently are not): `ContactSection`, `LinksSection`, `WorkHistorySection`, `EducationSection`, `WorkAuthSection`, `LogisticsSection`, `CustomQASection`, `DocumentsSection`, `NotionSettingsSection`. Each profile section keeps its existing props `{ profile: Profile; onChange: (p: Profile) => void }`; `DocumentsSection` and `NotionSettingsSection` take no props.
  - `SetupStep { id: string; title: string; blurb: string; render: () => React.ReactNode }` exported from `components/SetupView.tsx`.
  - `SetupView` from `components/SetupView.tsx` with props `{ mode: 'wizard' | 'tabs'; onDone: () => void }`.
  - `Wizard` from `components/Wizard.tsx` with props `{ steps: SetupStep[]; onDone: () => void }`.

- [ ] **Step 1: Export every section from ProfileForm.tsx**

In `extension/components/ProfileForm.tsx`, add the `export` keyword to `ContactSection`, `LinksSection`, `WorkHistorySection`, `EducationSection`, `WorkAuthSection`, `LogisticsSection`, and `CustomQASection`. Leave the composed `ProfileForm` export in place (still used by the tabs mode's Profile tab).

- [ ] **Step 2: Create the Wizard shell**

Create `extension/components/Wizard.tsx`:

```tsx
import { useState } from 'react';
import type { SetupStep } from './SetupView';

export function Wizard({ steps, onDone }: { steps: SetupStep[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (!step) return null;

  const isLast = index === steps.length - 1;

  return (
    <div className="wizard">
      <div className="wizard-progress" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={steps.length}>
        {steps.map((s, i) => (
          <span key={s.id} className={`wizard-dot ${i <= index ? 'wizard-dot-active' : ''}`} />
        ))}
      </div>

      <div className="wizard-step" key={step.id}>
        <h2 className="wizard-title">{step.title}</h2>
        <p className="wizard-blurb">{step.blurb}</p>
        {step.render()}
      </div>

      <div className="wizard-nav">
        {index > 0 && (
          <button type="button" className="btn" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (isLast ? onDone() : setIndex(index + 1))}
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SetupView with the shared step definitions**

Create `extension/components/SetupView.tsx`. It defines the step list once and renders it either through `Wizard` or as tabs:

```tsx
import { useRef, useState } from 'react';
import {
  ContactSection,
  CustomQASection,
  DocumentsSection,
  EducationSection,
  LinksSection,
  LogisticsSection,
  NotionSettingsSection,
  WorkAuthSection,
  WorkHistorySection,
} from './ProfileForm';
import { useProfileEditor } from './useProfileEditor';
import { Wizard } from './Wizard';

export interface SetupStep {
  id: string;
  title: string;
  blurb: string;
  render: () => React.ReactNode;
}

export function SetupView({ mode, onDone }: { mode: 'wizard' | 'tabs'; onDone: () => void }) {
  const { profile, setProfile, loaded, saveState, save, exportJson, importFile, importError, clearImportError } =
    useProfileEditor();
  const [activeTab, setActiveTab] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!loaded) return <div className="loading-state">Loading your profile…</div>;

  const steps: SetupStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to ApplyFlow',
      blurb:
        'Save your details once, then fill any job application with a click. Everything stays on this computer. You can skip any step and come back later.',
      render: () => null,
    },
    {
      id: 'contact',
      title: 'Your contact details',
      blurb: 'The basics almost every application asks for.',
      render: () => <ContactSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'work',
      title: 'Where have you worked?',
      blurb: 'Add the roles you want to reuse across applications.',
      render: () => <WorkHistorySection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'education',
      title: 'Education',
      blurb: 'Schools, degrees, and dates.',
      render: () => <EducationSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'projects',
      title: 'Your projects',
      blurb: 'Details here are what the AI draws on when drafting answers. The more specific, the better the drafts.',
      render: () => <ProjectsSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'preferences',
      title: 'Job preferences',
      blurb: 'Links, work authorization, and availability.',
      render: () => (
        <>
          <LinksSection profile={profile} onChange={setProfile} />
          <WorkAuthSection profile={profile} onChange={setProfile} />
          <LogisticsSection profile={profile} onChange={setProfile} />
        </>
      ),
    },
    {
      id: 'documents',
      title: 'Your documents folder',
      blurb:
        'Point ApplyFlow at the folder where you keep your resumes and cover letters, and it can attach the right one for you. Optional.',
      render: () => <DocumentsSection />,
    },
    {
      id: 'notion',
      title: 'Notion tracker',
      blurb: 'Optional. Connect a Notion database to log every application you send.',
      render: () => <NotionSettingsSection />,
    },
    {
      id: 'ai',
      title: 'AI answer drafting',
      blurb: 'Optional. Let a local or hosted model draft answers to open-ended questions.',
      render: () => <LlmSettingsSection />,
    },
    {
      id: 'done',
      title: "You're set up",
      blurb: 'Open this panel on any job application and press Fill this page. The gear icon reopens these settings anytime.',
      render: () => null,
    },
  ];

  const handleDone = async () => {
    await save();
    onDone();
  };

  if (mode === 'wizard') {
    return <Wizard steps={steps} onDone={handleDone} />;
  }

  // Tabs mode: same steps minus the wizard-only welcome/done screens.
  const tabs = steps.filter((s) => s.id !== 'welcome' && s.id !== 'done');
  const active = tabs[activeTab];

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };

  return (
    <div className="setup-tabs">
      <div className="tab-bar">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${i === activeTab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab.title}
          </button>
        ))}
      </div>

      {importError && <p className="error">{importError}</p>}
      {active?.render()}

      <div className="setup-footer">
        <button type="button" className="btn" onClick={exportJson}>
          Export JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            clearImportError();
            fileInputRef.current?.click();
          }}
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <button type="button" className="btn btn-primary" onClick={save}>
          {saveState === 'saved' ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

Note: `ProjectsSection` and `LlmSettingsSection` are added in Tasks 5 and 7. Until then, import them as stubs — create both in Task 5/7 respectively, and for this task temporarily replace those two `render` bodies with `() => null` so the file compiles. Task 5 and Task 7 each restore their own line.

- [ ] **Step 4: Add view switching and the header to App.tsx**

Replace `extension/entrypoints/sidepanel/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { DailyView } from '@/components/DailyView';
import { SetupView } from '@/components/SetupView';
import { GearIcon, BackIcon } from '@/components/icons';
import { getProfile } from '@/lib/storage';
import './App.css';

type View = { kind: 'loading' } | { kind: 'daily' } | { kind: 'setup'; mode: 'wizard' | 'tabs' };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    // First run (nothing saved yet) opens the guided wizard instead of the daily view.
    getProfile().then((profile) => {
      const hasProfile = Boolean(profile.contact.firstName || profile.contact.email);
      setView(hasProfile ? { kind: 'daily' } : { kind: 'setup', mode: 'wizard' });
    });
  }, []);

  if (view.kind === 'loading') return <div className="loading-state">Loading…</div>;

  return (
    <div className="panel">
      <header className="app-header">
        {view.kind === 'setup' && view.mode === 'tabs' ? (
          <button type="button" className="icon-btn" onClick={() => setView({ kind: 'daily' })} aria-label="Back">
            <BackIcon />
          </button>
        ) : (
          <span className="wordmark">ApplyFlow</span>
        )}
        {view.kind === 'daily' && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setView({ kind: 'setup', mode: 'tabs' })}
            aria-label="Settings"
          >
            <GearIcon />
          </button>
        )}
      </header>

      {view.kind === 'daily' ? (
        <DailyView onOpenSetup={() => setView({ kind: 'setup', mode: 'tabs' })} />
      ) : (
        <SetupView mode={view.mode} onDone={() => setView({ kind: 'daily' })} />
      )}
    </div>
  );
}

export default App;
```

- [ ] **Step 5: Add header, wizard, and tab styles**

Append to `extension/entrypoints/sidepanel/App.css`:

```css
.panel .app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  margin-bottom: 16px;
}

.panel .wordmark {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.panel .icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
}

.panel .icon-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.panel .wizard-progress {
  display: flex;
  gap: 5px;
  margin-bottom: 22px;
}

.panel .wizard-dot {
  height: 3px;
  flex: 1;
  border-radius: 999px;
  background: var(--border);
  transition: background-color 0.25s ease;
}

.panel .wizard-dot-active {
  background: var(--accent);
}

.panel .wizard-step {
  animation: wizard-in 0.2s ease both;
}

@keyframes wizard-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel .wizard-step {
    animation: none;
  }
}

.panel .wizard-title {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin-bottom: 6px;
}

.panel .wizard-blurb {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 18px;
}

.panel .wizard-nav {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}

.panel .wizard-nav .btn {
  flex: 1;
}

.panel .tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
}

.panel .tab {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  padding: 4px 11px;
  font-size: 11.5px;
  font-weight: 500;
}

.panel .tab-active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.panel .setup-footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
```

- [ ] **Step 6: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds.

- [ ] **Step 7: Verify both entry paths in the browser**

Reload the extension. To test first-run: open the side panel's devtools console and run `chrome.storage.local.clear()`, then reopen the panel — it must open into the wizard. Step through with Next/Back and confirm Finish lands in the Daily view. Then click the gear icon and confirm the same sections appear as tabs with a working Back button.

- [ ] **Step 8: Commit**

```bash
git add extension/components/Wizard.tsx extension/components/SetupView.tsx extension/components/ProfileForm.tsx extension/entrypoints/sidepanel/App.tsx extension/entrypoints/sidepanel/App.css
git commit -m "Split panel into daily view and setup wizard/tabs"
```

---

### Task 5: Projects section

**Files:**
- Modify: `extension/components/ProfileForm.tsx` (add `ProjectsSection`)
- Modify: `extension/components/SetupView.tsx` (restore the projects step's render)

**Interfaces:**
- Consumes: `ProjectEntry`, `Profile` from `lib/schema.ts` (Task 1); the existing `TextField` component in `ProfileForm.tsx`.
- Produces: `ProjectsSection` exported from `components/ProfileForm.tsx` with props `{ profile: Profile; onChange: (p: Profile) => void }`.

- [ ] **Step 1: Add ProjectsSection**

In `extension/components/ProfileForm.tsx`, add `ProjectEntry` to the type import from `@/lib/schema`, then add this component (mirroring the existing `EducationSection` structure exactly):

```tsx
export function ProjectsSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<ProjectEntry>) =>
    onChange({
      ...profile,
      projects: profile.projects.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      projects: [
        ...profile.projects,
        { id: crypto.randomUUID(), name: '', role: '', description: '', techStack: '', outcomes: '' },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...profile, projects: profile.projects.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Projects</h2>
      <p className="hint">
        What you built, what you did on it, and how it turned out. This is what the AI uses to draft answers, so
        specifics beat summaries.
      </p>
      {profile.projects.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField label="Name" value={entry.name} onChange={(v) => update(entry.id, { name: v })} />
            <TextField label="Your role" value={entry.role} onChange={(v) => update(entry.id, { role: v })} />
            <TextField label="Tech stack" value={entry.techStack} onChange={(v) => update(entry.id, { techStack: v })} />
          </div>
          <label className="field">
            <span>Description</span>
            <textarea
              value={entry.description}
              onChange={(e) => update(entry.id, { description: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Outcomes</span>
            <textarea value={entry.outcomes} onChange={(e) => update(entry.id, { outcomes: e.target.value })} />
          </label>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add project
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into SetupView**

In `extension/components/SetupView.tsx`, add `ProjectsSection` to the import list from `./ProfileForm` and restore the projects step's render to:

```tsx
      render: () => <ProjectsSection profile={profile} onChange={setProfile} />,
```

- [ ] **Step 3: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds.

- [ ] **Step 4: Verify in the browser**

Reload the extension, open Settings → Projects, add a project, Save, reopen the panel, and confirm it persisted.

- [ ] **Step 5: Commit**

```bash
git add extension/components/ProfileForm.tsx extension/components/SetupView.tsx
git commit -m "Add projects section to profile"
```

---

### Task 6: Free-text question detection

**Files:**
- Create: `extension/lib/question-detector.ts`
- Create: `extension/lib/question-detector.test.ts`
- Modify: `extension/vitest.config.ts` (switch to a DOM environment)
- Modify: `extension/package.json` (add `jsdom`)

**Interfaces:**
- Consumes: `matchFields`, `getDisplayLabel` from `lib/field-matcher.ts`. `getDisplayLabel` is currently private — this task exports it.
- Produces: `DetectedQuestion { element: HTMLTextAreaElement | HTMLInputElement; question: string }` and `detectQuestions(root?: ParentNode): DetectedQuestion[]`, both exported from `lib/question-detector.ts`.

- [ ] **Step 1: Add jsdom and switch the test environment**

```bash
cd extension && npm install -D jsdom@^25
```

In `extension/vitest.config.ts`, change `environment: 'node'` to `environment: 'jsdom'`.

- [ ] **Step 2: Write the failing test**

Create `extension/lib/question-detector.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { detectQuestions } from './question-detector';

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe('detectQuestions', () => {
  beforeEach(() => setBody(''));

  it('finds a textarea with its label as the question', () => {
    setBody(`
      <label for="q1">Why do you want to work here?</label>
      <textarea id="q1"></textarea>
    `);
    const found = detectQuestions(document);
    expect(found).toHaveLength(1);
    expect(found[0]!.question).toBe('Why do you want to work here?');
  });

  it('ignores textareas already claimed by profile field matching', () => {
    setBody(`
      <label for="addr">Address line 1</label>
      <textarea id="addr"></textarea>
    `);
    expect(detectQuestions(document)).toHaveLength(0);
  });

  it('ignores short-label text inputs that are not open-ended questions', () => {
    setBody(`
      <label for="x">Ref</label>
      <input id="x" type="text" />
    `);
    expect(detectQuestions(document)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd extension && npm test`
Expected: FAIL — `./question-detector` does not exist.

- [ ] **Step 4: Export getDisplayLabel**

In `extension/lib/field-matcher.ts`, add `export` to `function getDisplayLabel`.

- [ ] **Step 5: Implement the detector**

Create `extension/lib/question-detector.ts`:

```ts
import { getDisplayLabel, matchFields } from './field-matcher';

export interface DetectedQuestion {
  element: HTMLTextAreaElement | HTMLInputElement;
  question: string;
}

/** Below this, a label reads like a field name ("Ref", "City") rather than a question. */
const MIN_QUESTION_LABEL_LENGTH = 15;

/**
 * Finds the open-ended, essay-style questions on a page: fields that profile
 * matching did NOT already claim, and that look like prose prompts rather
 * than short data entry fields.
 */
export function detectQuestions(root: ParentNode = document): DetectedQuestion[] {
  const claimed = new Set(matchFields(root).map((m) => m.element));
  const questions: DetectedQuestion[] = [];

  const candidates = Array.from(
    root.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]')
  );

  for (const element of candidates) {
    if (claimed.has(element)) continue;

    const question = getDisplayLabel(element).trim();
    if (!question) continue;

    // A textarea is inherently open-ended; a text input only counts when its
    // label is long enough to read as an actual question.
    const isOpenEnded =
      element instanceof HTMLTextAreaElement || question.length >= MIN_QUESTION_LABEL_LENGTH;
    if (!isOpenEnded) continue;

    questions.push({ element, question });
  }

  return questions;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd extension && npm test`
Expected: PASS (all three cases, plus Task 1's tests still passing).

- [ ] **Step 7: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add extension/package.json extension/package-lock.json extension/vitest.config.ts extension/lib/field-matcher.ts extension/lib/question-detector.ts extension/lib/question-detector.test.ts
git commit -m "Detect open-ended application questions"
```

---

### Task 7: LLM client and settings

**Files:**
- Create: `extension/lib/llm-client.ts`
- Create: `extension/lib/llm-client.test.ts`
- Modify: `extension/components/ProfileForm.tsx` (add `LlmSettingsSection`)
- Modify: `extension/components/SetupView.tsx` (restore the AI step's render)
- Modify: `extension/wxt.config.ts` (host permissions)

**Interfaces:**
- Consumes: `LlmSettings`, `getSettings`, `setSettings` from `lib/settings.ts` (Task 1); `Profile` from `lib/schema.ts`.
- Produces:
  - `DraftContext { question: string; jobDescription: string | null; profile: Profile }` from `lib/llm-client.ts`
  - `buildPrompt(context: DraftContext): string` from `lib/llm-client.ts`
  - `draftAnswer(context: DraftContext, llm: LlmSettings): Promise<string>` from `lib/llm-client.ts`
  - `LlmSettingsSection` (no props) exported from `components/ProfileForm.tsx`

- [ ] **Step 1: Write the failing test**

Create `extension/lib/llm-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './llm-client';
import { EMPTY_PROFILE } from './schema';

describe('buildPrompt', () => {
  it('includes the question, the job description, and project details', () => {
    const prompt = buildPrompt({
      question: 'Why do you want to work here?',
      jobDescription: 'We build security training.',
      profile: {
        ...EMPTY_PROFILE,
        projects: [
          {
            id: 'a',
            name: 'ApplyFlow',
            role: 'Author',
            description: 'A job application autofiller',
            techStack: 'TypeScript',
            outcomes: 'Cut application time',
          },
        ],
      },
    });

    expect(prompt).toContain('Why do you want to work here?');
    expect(prompt).toContain('We build security training.');
    expect(prompt).toContain('ApplyFlow');
    expect(prompt).toContain('TypeScript');
  });

  it('still produces a prompt when no job description was found', () => {
    const prompt = buildPrompt({
      question: 'Tell us about yourself.',
      jobDescription: null,
      profile: EMPTY_PROFILE,
    });
    expect(prompt).toContain('Tell us about yourself.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd extension && npm test`
Expected: FAIL — `./llm-client` does not exist.

- [ ] **Step 3: Implement the client**

Create `extension/lib/llm-client.ts`:

```ts
import type { Profile } from './schema';
import type { LlmSettings } from './settings';

export interface DraftContext {
  question: string;
  jobDescription: string | null;
  profile: Profile;
}

export class LlmError extends Error {}

/**
 * A personal project directory is small (a handful of entries), so the whole
 * of it goes into the prompt directly — no retrieval or embedding step.
 */
export function buildPrompt(context: DraftContext): string {
  const { question, jobDescription, profile } = context;

  const work = profile.workHistory
    .map((w) => `- ${w.title} at ${w.company} (${w.startDate}–${w.current ? 'present' : w.endDate}): ${w.description}`)
    .join('\n');

  const projects = profile.projects
    .map((p) => `- ${p.name} (${p.role}) — ${p.description}. Tech: ${p.techStack}. Outcome: ${p.outcomes}`)
    .join('\n');

  return [
    'You are helping a candidate answer a job application question in their own voice.',
    'Write a concise, specific, first-person answer. Use only the facts given below — never invent experience, employers, dates, or metrics.',
    'Return only the answer text, with no preamble, quotes, or commentary.',
    '',
    `QUESTION: ${question}`,
    '',
    'JOB DESCRIPTION:',
    jobDescription || '(not available)',
    '',
    'CANDIDATE WORK HISTORY:',
    work || '(none provided)',
    '',
    'CANDIDATE PROJECTS:',
    projects || '(none provided)',
  ].join('\n');
}

async function draftWithOllama(prompt: string, llm: LlmSettings): Promise<string> {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: llm.ollamaModel, prompt, stream: false }),
  });
  if (!response.ok) {
    throw new LlmError(
      `Ollama returned ${response.status}. Is Ollama running, and is the model "${llm.ollamaModel}" pulled?`
    );
  }
  const data = (await response.json()) as { response?: string };
  return (data.response ?? '').trim();
}

async function draftWithOpenRouter(prompt: string, llm: LlmSettings): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.openRouterModel,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(`OpenRouter returned ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

export async function draftAnswer(context: DraftContext, llm: LlmSettings): Promise<string> {
  const prompt = buildPrompt(context);
  if (llm.backend === 'ollama') return draftWithOllama(prompt, llm);
  if (llm.backend === 'openrouter') return draftWithOpenRouter(prompt, llm);
  throw new LlmError('No AI backend is set up yet. Open Settings to choose one.');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npm test`
Expected: PASS.

- [ ] **Step 5: Add the settings UI**

In `extension/components/ProfileForm.tsx`, add `type LlmSettings` to the existing `@/lib/settings` import and append:

```tsx
export function LlmSettingsSection() {
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    getSettings().then((settings) => setLlm(settings.llm));
  }, []);

  if (!llm) return null;

  const handleSave = async () => {
    const settings = await getSettings();
    await setSettings({ ...settings, llm });
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  return (
    <section>
      <h2>AI answer drafting</h2>
      <p className="hint">
        Optional. Drafts answers to open-ended questions using your work history and projects. Drafts are always
        shown to you to edit — nothing is entered automatically.
      </p>
      <label className="field">
        <span>Where should drafting run?</span>
        <select
          value={llm.backend ?? ''}
          onChange={(e) => setLlm({ ...llm, backend: (e.target.value || null) as LlmSettings['backend'] })}
        >
          <option value="">Off</option>
          <option value="ollama">On my computer (Ollama)</option>
          <option value="openrouter">OpenRouter (API key)</option>
        </select>
      </label>

      {llm.backend === 'ollama' && (
        <>
          <p className="hint" style={{ marginTop: 12 }}>
            Requires <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> running locally with a
            model pulled. Nothing leaves your computer.
          </p>
          <TextField label="Model" value={llm.ollamaModel} onChange={(v) => setLlm({ ...llm, ollamaModel: v })} />
        </>
      )}

      {llm.backend === 'openrouter' && (
        <>
          <p className="hint" style={{ marginTop: 12 }}>
            Uses your own{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
              OpenRouter API key
            </a>
            . Your question and profile details are sent to OpenRouter when you press Draft answers.
          </p>
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={llm.openRouterApiKey}
              onChange={(e) => setLlm({ ...llm, openRouterApiKey: e.target.value })}
            />
          </label>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Model</span>
            <input
              type="text"
              value={llm.openRouterModel}
              onChange={(e) => setLlm({ ...llm, openRouterModel: e.target.value })}
            />
          </label>
        </>
      )}

      <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleSave}>
        {saveState === 'saved' ? 'Saved' : 'Save'}
      </button>
    </section>
  );
}
```

- [ ] **Step 6: Wire it into SetupView**

In `extension/components/SetupView.tsx`, add `LlmSettingsSection` to the import from `./ProfileForm` and restore the AI step's render to `() => <LlmSettingsSection />`.

- [ ] **Step 7: Add host permissions**

In `extension/wxt.config.ts`, change `host_permissions` to:

```ts
    host_permissions: [
      'https://api.notion.com/*',
      'https://openrouter.ai/*',
      'http://localhost:11434/*',
    ],
```

- [ ] **Step 8: Compile and build**

Run: `cd extension && npm run compile && npm run build`
Expected: no tsc errors, build succeeds. Confirm `.output/chrome-mv3/manifest.json` lists all three host permissions.

- [ ] **Step 9: Commit**

```bash
git add extension/lib/llm-client.ts extension/lib/llm-client.test.ts extension/components/ProfileForm.tsx extension/components/SetupView.tsx extension/wxt.config.ts
git commit -m "Add LLM client and AI drafting settings"
```

---

### Task 8: Draft answers action

**Files:**
- Modify: `extension/entrypoints/content.ts` (two new messages)
- Modify: `extension/components/DailyView.tsx` (the Draft answers card)
- Modify: `extension/entrypoints/sidepanel/App.css` (draft styles)

**Interfaces:**
- Consumes: `detectQuestions` (Task 6); `draftAnswer`, `LlmError` (Task 7); `getSettings` from `lib/settings.ts`; `getProfile` from `lib/storage.ts`; `scrapeJobDescription` from `lib/jd-scraper.ts`; `getActiveTabId`, `ActionCard`, `DraftIcon`.
- Produces, from `entrypoints/content.ts`:
  - `GetQuestionsMessage { type: 'get-questions' }`
  - `GetQuestionsResponse { questions: Array<{ id: string; question: string }>; jobDescription: string | null }`
  - `InsertAnswerMessage { type: 'insert-answer'; id: string; text: string }`
  - `InsertAnswerResponse { inserted: boolean }`

- [ ] **Step 1: Add the content-script handlers**

In `extension/entrypoints/content.ts`, add the import `import { detectQuestions } from '@/lib/question-detector';`, add the four interfaces above, add both new message types to the `IncomingMessage` union, and add this module-level cache plus the two handlers:

```ts
// Detected question elements can't cross the message boundary, so they're kept
// here and referenced by id when the side panel asks to insert an answer.
const detectedQuestions = new Map<string, HTMLTextAreaElement | HTMLInputElement>();
```

Inside the listener, before the final `return undefined;`:

```ts
      if (message?.type === 'get-questions') {
        (async () => {
          detectedQuestions.clear();
          const found = detectQuestions(document);
          const questions = found.map((q, i) => {
            const id = `q${i}`;
            detectedQuestions.set(id, q.element);
            return { id, question: q.question };
          });
          const response: GetQuestionsResponse = {
            questions,
            jobDescription: await scrapeJobDescription(),
          };
          sendResponse(response);
        })();
        return true;
      }

      if (message?.type === 'insert-answer') {
        const element = detectedQuestions.get(message.id);
        if (element) {
          setNativeFieldValue(element, message.text);
        }
        const response: InsertAnswerResponse = { inserted: Boolean(element) };
        sendResponse(response);
        return true;
      }
```

- [ ] **Step 2: Share the native-setter helper**

`lib/filler.ts` already writes values through the native prototype setter (so React-controlled forms register the change), but keeps it private. Export it for reuse: in `extension/lib/filler.ts`, add `export` to `function setNativeValue`, and add below it:

```ts
/** Writes a value into a field the way a real user would, so framework-controlled forms notice. */
export function setNativeFieldValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
) {
  setNativeValue(el, value);
  dispatchChange(el);
}
```

Import it in `entrypoints/content.ts` by adding `setNativeFieldValue` to the existing `@/lib/filler` import.

- [ ] **Step 3: Add the Draft answers card**

In `extension/components/DailyView.tsx`, add a `DraftAnswersCard` component and render it inside `DailyView` after the Notion card:

```tsx
type DraftState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; drafts: Array<{ id: string; question: string; text: string; inserted: boolean }> };

function DraftAnswersCard() {
  const [state, setState] = useState<DraftState>({ kind: 'idle' });

  const handleDraft = async () => {
    setState({ kind: 'loading' });
    try {
      const settings = await getSettings();
      if (!settings.llm.backend) {
        setState({ kind: 'not-configured' });
        return;
      }

      const tabId = await getActiveTabId();
      const message: GetQuestionsMessage = { type: 'get-questions' };
      const found: GetQuestionsResponse = await browser.tabs.sendMessage(tabId, message);

      if (found.questions.length === 0) {
        setState({ kind: 'error', message: 'No open-ended questions found on this page.' });
        return;
      }

      const profile = await getProfile();
      const drafts = [];
      for (const q of found.questions) {
        // A saved answer wins over a fresh generation: it is instant, free,
        // and already worded the way the user wants.
        const saved = profile.customQA.find((entry) =>
          entry.question.toLowerCase().includes(q.question.toLowerCase().slice(0, 25))
        );
        const text = saved
          ? saved.answer
          : await draftAnswer(
              { question: q.question, jobDescription: found.jobDescription, profile },
              settings.llm
            );
        drafts.push({ id: q.id, question: q.question, text, inserted: false });
      }
      setState({ kind: 'ready', drafts });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not draft answers.',
      });
    }
  };

  const updateDraft = (id: string, patch: Partial<{ text: string; inserted: boolean }>) =>
    setState((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
        : prev
    );

  const handleInsert = async (id: string, text: string) => {
    const tabId = await getActiveTabId();
    const message: InsertAnswerMessage = { type: 'insert-answer', id, text };
    const response: InsertAnswerResponse = await browser.tabs.sendMessage(tabId, message);
    if (response.inserted) updateDraft(id, { inserted: true });
  };

  const handleSaveReusable = async (question: string, answer: string) => {
    const profile = await getProfile();
    await setProfile({
      ...profile,
      customQA: [...profile.customQA, { id: crypto.randomUUID(), question, answer }],
    });
  };

  return (
    <>
      <ActionCard
        icon={<DraftIcon />}
        title="Draft answers"
        description="Drafts replies to open-ended questions. You review before anything is entered."
        tint="neutral"
        onClick={handleDraft}
        disabled={state.kind === 'loading'}
      >
        {state.kind === 'loading' && <span className="pill pill-neutral">Drafting…</span>}
        {state.kind === 'not-configured' && (
          <span className="pill pill-neutral">Set up AI drafting in Settings first</span>
        )}
        {state.kind === 'error' && <span className="pill pill-danger">{state.message}</span>}
      </ActionCard>

      {state.kind === 'ready' && (
        <div className="drafts">
          {state.drafts.map((draft) => (
            <div className="draft" key={draft.id}>
              <p className="draft-question">{draft.question}</p>
              <textarea value={draft.text} onChange={(e) => updateDraft(draft.id, { text: e.target.value })} />
              <div className="draft-actions">
                <button className="btn btn-primary" onClick={() => handleInsert(draft.id, draft.text)}>
                  {draft.inserted ? 'Inserted' : 'Insert'}
                </button>
                <button className="btn" onClick={() => handleSaveReusable(draft.question, draft.text)}>
                  Save for reuse
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
```

Add the needed imports to `DailyView.tsx`: `DraftIcon` from `./icons`, `draftAnswer` from `@/lib/llm-client`, `getProfile`/`setProfile` from `@/lib/storage`, and the four new message types from `@/entrypoints/content`.

- [ ] **Step 4: Add draft styles**

Append to `extension/entrypoints/sidepanel/App.css`:

```css
.panel .drafts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel .draft {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 12px;
}

.panel .draft-question {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 8px;
}

.panel .draft textarea {
  width: 100%;
  min-height: 110px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 8px;
  font-family: inherit;
  font-size: 12.5px;
}

.panel .draft-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.panel .draft-actions .btn {
  flex: 1;
}
```

- [ ] **Step 5: Compile, test, and build**

Run: `cd extension && npm test && npm run compile && npm run build`
Expected: tests PASS, no tsc errors, build succeeds.

- [ ] **Step 6: Verify in the browser**

Reload the extension. With AI drafting off, confirm the card shows the "Set up AI drafting in Settings first" message. Then configure a backend (Ollama running locally, or an OpenRouter key), open a job application with a free-text question, press Draft answers, and confirm a draft appears, is editable, inserts into the page field, and "Save for reuse" persists it (verify by re-running Draft answers — it should return instantly from `customQA`).

- [ ] **Step 7: Commit**

```bash
git add extension/entrypoints/content.ts extension/lib/filler.ts extension/components/DailyView.tsx extension/entrypoints/sidepanel/App.css
git commit -m "Add AI draft answers action"
```

---

### Task 9: Plain-language Notion setup with a connection test

**Files:**
- Modify: `extension/components/ProfileForm.tsx` (`NotionSettingsSection`)
- Modify: `extension/lib/notion-client.ts` (add `testConnection`)

**Interfaces:**
- Consumes: `searchDatabases`, `NotionApiError` from `lib/notion-client.ts`.
- Produces: `testConnection(notion: Settings['notion']): Promise<{ ok: true; databaseTitle: string } | { ok: false; message: string }>` exported from `lib/notion-client.ts`.

- [ ] **Step 1: Add the connection test**

Append to `extension/lib/notion-client.ts`:

```ts
/** Confirms the token and database id actually work, so setup gives a yes/no answer instead of failing later. */
export async function testConnection(
  notion: Settings['notion']
): Promise<{ ok: true; databaseTitle: string } | { ok: false; message: string }> {
  if (!notion.token) return { ok: false, message: 'Add your integration token first.' };
  if (!notion.databaseId) return { ok: false, message: 'Choose which database to log to.' };

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${notion.databaseId}`, {
      headers: {
        Authorization: `Bearer ${notion.token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });

    if (response.status === 401) {
      return { ok: false, message: "That token wasn't accepted. Check you copied all of it." };
    }
    if (response.status === 404) {
      return {
        ok: false,
        message: "Notion can't see that database. In Notion, open it, click the ••• menu, and share it with your integration.",
      };
    }
    if (!response.ok) {
      return { ok: false, message: `Notion returned an error (${response.status}).` };
    }

    const data = (await response.json()) as { title?: Array<{ plain_text: string }> };
    return {
      ok: true,
      databaseTitle: data.title?.map((t) => t.plain_text).join('') || 'your database',
    };
  } catch {
    return { ok: false, message: 'Could not reach Notion. Check your internet connection.' };
  }
}
```

- [ ] **Step 2: Rewrite the setup copy and add the test button**

In `extension/components/ProfileForm.tsx`, replace the `<p className="hint">` inside `NotionSettingsSection` with numbered, plain-language steps, and add a test button + result. Add `testConnection` to the `@/lib/notion-client` import and these state hooks alongside the existing ones:

```tsx
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
```

Replace the hint paragraph with:

```tsx
      <p className="hint">Log every application you send to a Notion database. Optional — everything else works without it.</p>
      <ol className="setup-steps">
        <li>
          Open{' '}
          <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
            Notion integrations
          </a>{' '}
          and press <strong>New integration</strong>. Give it any name.
        </li>
        <li>Copy the secret it shows you, and paste it below.</li>
        <li>
          In Notion, open the database you want to log to, click the <strong>•••</strong> menu at the top right,
          choose <strong>Connections</strong>, and pick the integration you just made.
        </li>
        <li>Press <strong>Find my databases</strong> below and choose it from the list.</li>
      </ol>
```

Add after the existing Save button:

```tsx
      <button
        type="button"
        className="btn"
        style={{ marginTop: 8 }}
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          const result = await testConnection({ token, databaseId });
          setTestResult(
            result.ok
              ? { ok: true, message: `Connected to ${result.databaseTitle}.` }
              : { ok: false, message: result.message }
          );
          setTesting(false);
        }}
      >
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {testResult && (
        <p className="status-row" style={{ marginTop: 8 }}>
          <span className={`pill ${testResult.ok ? 'pill-success' : 'pill-danger'}`}>{testResult.message}</span>
        </p>
      )}
```

- [ ] **Step 3: Style the numbered steps**

Append to `extension/components/ProfileForm.css`:

```css
.panel .setup-steps {
  margin: 0 0 14px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.6;
}

.panel .setup-steps li {
  margin-bottom: 5px;
}
```

- [ ] **Step 4: Compile, test, and build**

Run: `cd extension && npm test && npm run compile && npm run build`
Expected: tests PASS, no tsc errors, build succeeds.

- [ ] **Step 5: Verify in the browser**

Reload the extension, open Settings → Notion tracker. Confirm: numbered instructions render; "Test connection" with an empty token gives the "Add your integration token first" message; with a real token and database it reports the database name.

- [ ] **Step 6: Commit**

```bash
git add extension/lib/notion-client.ts extension/components/ProfileForm.tsx extension/components/ProfileForm.css
git commit -m "Add plain-language Notion setup steps and connection test"
```

---

### Task 10: Update the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new behaviour**

In `README.md`, update the Features list to describe the guided first-run setup, the daily action cards, and AI answer drafting (noting it is optional, needs either Ollama locally or an OpenRouter key, and always shows drafts for review before inserting). Add a line to "Getting started" noting that the first time the panel opens it walks through setup, and that the gear icon reopens settings later.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Update README for setup wizard and AI drafting"
```
