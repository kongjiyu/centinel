import { api } from '../api/client';

export type LocalSourceFile = { file: File; path: string };

const extensions = /\.(?:txt|md|markdown|pdf|docx?|csv|[cm]?[jt]sx?|py|sol|java|cs|jsonc?|ya?ml|html?|css|go|rb|php|rs|cpp|c|h|xml|toml|ini|mod|csproj|gradle|kts?|swift|scala|dart|vue|svelte|sql|sh|bash|lua)$/i;
const skippedFolders = new Set(['node_modules', 'dist', 'build', '__pycache__', 'vendor', 'target', 'bin', 'obj']);
export const MAX_LOCAL_SOURCE_FILES = 200;

function skippedPath(path: string) {
  return path.split('/').some(part => !part || part.startsWith('.') || skippedFolders.has(part.toLowerCase()) || /[\\\x00-\x1f]/.test(part));
}

export function isSupportedLocalSource({ file, path }: LocalSourceFile) {
  return !skippedPath(path) && file.size > 0 && file.size <= 10 * 1024 * 1024
    && (extensions.test(file.name) || /^(?:Gemfile|Dockerfile|Makefile)$/.test(file.name));
}

export async function readDroppedLocalSources(transfer: DataTransfer) {
  const entries = Array.from(transfer.items ?? []).filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.());
  const files = Array.from(transfer.files);
  if (!entries.some(entry => entry?.isDirectory)) {
    return { files: files.map(file => ({ file, path: file.webkitRelativePath || file.name })), limited: false };
  }

  const result: LocalSourceFile[] = [];
  let visited = 0;
  let limited = false;
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (++visited > 2000) { limited = true; return; }
    const path = entry.fullPath.replace(/^\//, '');
    if (skippedPath(path)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      result.push({ file, path });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (!limited) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) {
          await walk(child);
          if (limited) break;
        }
      }
    }
  };
  for (const entry of entries) {
    if (entry) await walk(entry);
    if (limited) break;
  }
  return { files: result, limited };
}

export async function uploadLocalSources(projectId: string, files: LocalSourceFile[]) {
  const warnings: string[] = [];
  for (const { file, path } of files) {
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await api.uploadArtifact(projectId, { fileName: path, content });
    } catch {
      warnings.push(`Could not add ${path}.`);
    }
  }
  return warnings;
}
