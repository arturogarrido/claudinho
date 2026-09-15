export interface PrivateDocRef {
  line: number;
  token: string;
}
export function isPrivateDocRef(token: string): boolean;
export function privateDocRefs(text: string): PrivateDocRef[];
export function scanTrackedFiles(root: string): { scanned: number; leaks: string[] };
