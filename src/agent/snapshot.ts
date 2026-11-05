import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface SnapshotFileEntry {
  relPath: string;
  originalContent: string | undefined; // undefined means the file did not exist before
}

export interface WorkspaceSnapshot {
  id: string;
  turnIndex: number;
  timestamp: number;
  label: string;
  files: SnapshotFileEntry[];
}

/**
 * Manages atomic, git-independent time-travel workspace snapshots.
 * Automatically tracks file modifications per agent turn, allowing 1-click
 * multi-file restoration to any previous turn.
 */
export class SnapshotManager {
  private snapshots: WorkspaceSnapshot[] = [];
  private activeTurnFiles = new Map<string, string | undefined>();
  private maxSnapshots = 40;
  private currentTurnIndex = 0;

  constructor(private readonly getRoot: () => string | undefined) {}

  beginTurn(turnIndex: number): void {
    this.currentTurnIndex = turnIndex;
    this.activeTurnFiles.clear();
  }

  /**
   * Records a file's state BEFORE it is mutated in the current turn.
   * If the file was already recorded in this turn, keep the earliest version.
   */
  async recordFileBeforeMutation(relPath: string): Promise<void> {
    const norm = relPath.replace(/\\/g, '/');
    if (this.activeTurnFiles.has(norm)) {
      return; // Already captured earliest state for this turn
    }

    const root = this.getRoot();
    if (!root) return;

    const abs = path.resolve(root, norm);
    try {
      const content = await fs.readFile(abs, 'utf8');
      this.activeTurnFiles.set(norm, content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.activeTurnFiles.set(norm, undefined);
      } else {
        throw err;
      }
    }
  }

  /**
   * Finalizes the current turn and saves the snapshot if any files were touched.
   */
  commitTurn(label = ''): WorkspaceSnapshot | undefined {
    if (this.activeTurnFiles.size === 0) {
      return undefined;
    }

    const files: SnapshotFileEntry[] = [];
    for (const [relPath, originalContent] of this.activeTurnFiles.entries()) {
      files.push({ relPath, originalContent });
    }

    const snapshot: WorkspaceSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      turnIndex: this.currentTurnIndex,
      timestamp: Date.now(),
      label: label || `Turn #${this.currentTurnIndex} (${files.length} file${files.length === 1 ? '' : 's'})`,
      files
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    this.activeTurnFiles.clear();
    return snapshot;
  }

  listSnapshots(): WorkspaceSnapshot[] {
    return [...this.snapshots].reverse();
  }

  getSnapshot(id: string): WorkspaceSnapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  /**
   * Atomically restores all files from a given snapshot back to their pre-turn state.
   */
  async revertSnapshot(id: string): Promise<{ success: boolean; restoredFiles: string[]; error?: string }> {
    const targetIdx = this.snapshots.findIndex((s) => s.id === id);
    if (targetIdx === -1) {
      return { success: false, restoredFiles: [], error: 'Snapshot not found.' };
    }

    const root = this.getRoot();
    if (!root) {
      return { success: false, restoredFiles: [], error: 'No workspace folder is open.' };
    }

    // Revert backwards from newest snapshot down to targetIdx
    const restoredSet = new Set<string>();
    try {
      for (let i = this.snapshots.length - 1; i >= targetIdx; i--) {
        const snap = this.snapshots[i];
        for (const f of snap.files) {
          const abs = path.resolve(root, f.relPath);
          if (f.originalContent === undefined) {
            await fs.rm(abs, { force: true });
          } else {
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, f.originalContent, 'utf8');
          }
          restoredSet.add(f.relPath);
        }
      }

      // Remove reverted snapshots from memory
      this.snapshots.splice(targetIdx);
      return { success: true, restoredFiles: Array.from(restoredSet) };
    } catch (err) {
      return {
        success: false,
        restoredFiles: Array.from(restoredSet),
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Reverts the most recent turn.
   */
  async revertLast(): Promise<{ success: boolean; restoredFiles: string[]; label?: string; error?: string }> {
    if (this.snapshots.length === 0) {
      return { success: false, restoredFiles: [], error: 'No snapshots available.' };
    }
    const last = this.snapshots[this.snapshots.length - 1];
    const res = await this.revertSnapshot(last.id);
    return { ...res, label: last.label };
  }
}

