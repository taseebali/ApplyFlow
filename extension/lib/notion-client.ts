import type { Settings } from './settings';

/**
 * Only the two fields an API call actually needs. Taking the whole settings
 * object would drag UI-only state (such as `skipped`) into the client.
 */
export type NotionCredentials = Pick<Settings['notion'], 'token' | 'databaseId'>;

const NOTION_VERSION = '2022-06-28';
const MAX_RICH_TEXT_LENGTH = 2000;

export interface NotionLogEntry {
  title: string;
  company: string;
  jobUrl: string;
  source: string;
  jobDescription: string | null;
}

/** Splits text into <=2000-char chunks without cutting words, respecting Notion's rich_text length limit. */
function chunkText(text: string, maxLength = MAX_RICH_TEXT_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt < 1) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks;
}

function jobDescriptionBlocks(jobDescription: string | null) {
  if (!jobDescription) return [];
  return chunkText(jobDescription).map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
  }));
}

export class NotionApiError extends Error {}

export interface NotionDatabaseOption {
  id: string;
  title: string;
}

/** Lists the databases the given integration token has been shared with, so the user can pick one instead of copy-pasting its ID. */
export async function searchDatabases(token: string): Promise<NotionDatabaseOption[]> {
  const response = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filter: { property: 'object', value: 'database' } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new NotionApiError(`Notion API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    results: Array<{ id: string; title?: Array<{ plain_text: string }> }>;
  };

  return data.results.map((r) => ({
    id: r.id,
    title: r.title?.map((t) => t.plain_text).join('') || 'Untitled database',
  }));
}

/** Creates a row in the user's Job Application Tracker database, with the JD as page body content. */
export async function logApplicationToNotion(
  notion: NotionCredentials,
  entry: NotionLogEntry
): Promise<{ url: string }> {
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notion.token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: notion.databaseId },
      properties: {
        Title: { title: [{ text: { content: entry.title || 'Untitled role' } }] },
        Company: { rich_text: [{ text: { content: entry.company } }] },
        'Job URL': entry.jobUrl ? { url: entry.jobUrl } : undefined,
        'Applied Date': { date: { start: new Date().toISOString().slice(0, 10) } },
        Status: { select: { name: 'Applied' } },
        Source: { select: { name: entry.source } },
      },
      children: jobDescriptionBlocks(entry.jobDescription),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new NotionApiError(`Notion API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const created = (await response.json()) as { url: string };
  return { url: created.url };
}

/** Confirms the token and database id actually work, so setup gives a yes/no answer instead of failing later. */
export async function testConnection(
  notion: NotionCredentials
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

export interface ExistingApplication {
  title: string;
  appliedDate: string | null;
  status: string | null;
  url: string;
}

function readTitle(page: NotionPage): string {
  const prop = Object.values(page.properties ?? {}).find((p) => p?.type === 'title');
  return prop?.title?.map((t) => t.plain_text).join('') || 'Untitled';
}

interface NotionPage {
  url: string;
  properties?: Record<
    string,
    {
      type?: string;
      title?: Array<{ plain_text: string }>;
      date?: { start?: string } | null;
      select?: { name?: string } | null;
    }
  >;
}

/**
 * Looks for applications already logged to the same company, so the user can
 * be warned before creating a duplicate row. Returns an empty list rather
 * than throwing — a warning is a nicety and must never block logging.
 */
export async function findExistingApplications(
  notion: NotionCredentials,
  company: string
): Promise<ExistingApplication[]> {
  if (!notion.token || !notion.databaseId || !company.trim()) return [];

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${encodeURIComponent(notion.databaseId)}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notion.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: { property: 'Company', rich_text: { contains: company.trim() } },
          page_size: 5,
        }),
      }
    );
    if (!response.ok) return [];

    const data = (await response.json()) as { results?: NotionPage[] };
    return (data.results ?? []).map((page) => ({
      title: readTitle(page),
      appliedDate: page.properties?.['Applied Date']?.date?.start ?? null,
      status: page.properties?.Status?.select?.name ?? null,
      url: page.url,
    }));
  } catch {
    return [];
  }
}
