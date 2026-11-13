import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
td.remove(['script', 'style', 'img', 'iframe']);

export function htmlToMarkdown(html: string): string {
  return td
    .turndown(html ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
