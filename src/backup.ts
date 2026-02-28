import fs from "fs";
import path from "path";

export interface BackupResult {
  backupPath: string;
  memoriesBackedUp: number;
  timestamp: string;
}

export class BackupManager {
  private dbPath: string;
  private backupDir: string;
  private lastBackupTime: Date | null = null;
  private maxBackups = 10;
  private backupIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(dbPath: string, backupDir?: string) {
    this.dbPath = dbPath;
    this.backupDir = backupDir ?? path.join(path.dirname(dbPath), "backups");
  }

  createBackup(memories: Array<Record<string, unknown>>): BackupResult {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const timestamp = new Date();
    const folderName = `memory_backup_${timestamp.toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15)}`;
    const backupPath = path.join(this.backupDir, folderName);
    fs.mkdirSync(backupPath, { recursive: true });

    // Copy database file
    if (fs.existsSync(this.dbPath)) {
      fs.copyFileSync(this.dbPath, path.join(backupPath, "memories.db"));
    }

    // Export memories as JSON
    const exportData = {
      export_timestamp: timestamp.toISOString(),
      total_memories: memories.length,
      memories,
    };
    fs.writeFileSync(
      path.join(backupPath, "memories_export.json"),
      JSON.stringify(exportData, null, 2),
      "utf-8",
    );

    this.lastBackupTime = timestamp;

    this.pruneBackups();

    return {
      backupPath,
      memoriesBackedUp: memories.length,
      timestamp: timestamp.toISOString(),
    };
  }

  pruneBackups(): void {
    if (!fs.existsSync(this.backupDir)) return;

    const dirs = fs
      .readdirSync(this.backupDir)
      .filter((d) => {
        const fullPath = path.join(this.backupDir, d);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse(); // newest first

    for (const old of dirs.slice(this.maxBackups)) {
      fs.rmSync(path.join(this.backupDir, old), { recursive: true, force: true });
    }
  }

  shouldBackup(memoryCount: number): boolean {
    if (memoryCount > 0 && memoryCount % 100 === 0) return true;

    if (this.lastBackupTime === null) return true;

    const elapsed = Date.now() - this.lastBackupTime.getTime();
    return elapsed >= this.backupIntervalMs;
  }
}
