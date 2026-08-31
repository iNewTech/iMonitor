/**
 * Converts common Markdown produced by IBMEye AI into readable ClickUp text.
 * ClickUp's comment_text API field does not consistently render Markdown.
 */
export function formatClickUpComment(markdown: string): string {
    return String(markdown || '')
        .split(/\r?\n/)
        .filter((line) => {
            if (line.trim().startsWith('```')) {
                return false;
            }

            return true;
        })
        .map((line) => line
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/(?<!\w)[*_]([^*_]+)[*_](?!\w)/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
