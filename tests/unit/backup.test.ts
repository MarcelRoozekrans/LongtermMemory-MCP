import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BackupManager } from "../../src/backup.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("BackupManager", () => {
  let tmpDir: string;
  let backupDir: string;
  let dbPath: string;
  let manager: BackupManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    backupDir = path.join(tmpDir, "backups");
    dbPath = path.join(tmpDir, "memories.db");
    fs.writeFileSync(dbPath, "fake-db-content");
    manager = new BackupManager(dbPath, backupDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createBackup()", () => {
    it("creates backup directory if it does not exist", () => {
      expect(fs.existsSync(backupDir)).toBe(false);
      manager.createBackup([]);
      expect(fs.existsSync(backupDir)).toBe(true);
    });

    it("copies the database file", () => {
      const result = manager.createBackup([]);
      const files = fs.readdirSync(result.backupPath);
      expect(files).toContain("memories.db");
    });

    it("exports memories as JSON", () => {
      const memories = [
        { id: "1", content: "test", tags: ["a"], importance: 5, memoryType: "fact", createdAt: "2026-01-01T00:00:00Z" },
      ];
      const result = manager.createBackup(memories);
      const files = fs.readdirSync(result.backupPath);
      expect(files).toContain("memories_export.json");

      const exported = JSON.parse(fs.readFileSync(path.join(result.backupPath, "memories_export.json"), "utf-8"));
      expect(exported.total_memories).toBe(1);
      expect(exported.memories).toHaveLength(1);
    });

    it("returns backup metadata", () => {
      const result = manager.createBackup([]);
      expect(result.backupPath).toContain("memory_backup_");
      expect(result.memoriesBackedUp).toBe(0);
      expect(result.timestamp).toBeTruthy();
    });
  });

  describe("pruneBackups()", () => {
    it("keeps only the last 10 backups", () => {
      for (let i = 0; i < 12; i++) {
        manager.createBackup([]);
      }
      manager.pruneBackups();
      const dirs = fs.readdirSync(backupDir).filter((d) =>
        fs.statSync(path.join(backupDir, d)).isDirectory()
      );
      expect(dirs.length).toBeLessThanOrEqual(10);
    });
  });

  describe("shouldBackup()", () => {
    it("returns true when no backup has been made", () => {
      expect(manager.shouldBackup(5)).toBe(true);
    });

    it("returns false immediately after a backup", () => {
      manager.createBackup([]);
      expect(manager.shouldBackup(5)).toBe(false);
    });

    it("returns true when memory count is multiple of 100", () => {
      manager.createBackup([]);
      expect(manager.shouldBackup(100)).toBe(true);
      expect(manager.shouldBackup(200)).toBe(true);
      expect(manager.shouldBackup(99)).toBe(false);
    });
  });
});
