export function makeLabel(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 50);
}
