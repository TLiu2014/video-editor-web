import {
  exportProjectAsZip,
  importProjectFromZip,
} from './projectArchive';
import { useTimelineStore } from '../store/useTimelineStore';

/**
 * Side-effecting archive actions that work without any UI state.
 * The Toolbar wraps these with progress/error indicators; the
 * command palette and other surfaces can call them directly.
 */

export async function downloadCurrentProjectAsZip(): Promise<void> {
  const project = useTimelineStore.getState().currentProject;
  if (!project) return;
  const blob = await exportProjectAsZip(project);
  const url = URL.createObjectURL(blob);
  const safeName =
    project.name.replace(/[^a-z0-9-_]+/gi, '_') || 'project';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function loadArchiveFromFile(file: File): Promise<void> {
  const project = await importProjectFromZip(file);
  useTimelineStore.getState().loadProject(project);
}
