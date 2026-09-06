import "server-only";

import { emptyDriveConfig, type DriveConfig } from "@/app/crm/shell/drive-links";

export function getDriveConfig(): DriveConfig {
  const raw = process.env.EVERLETTER_DRIVE_CONFIG?.trim();
  if (!raw) return emptyDriveConfig;

  try {
    const parsed = JSON.parse(raw) as Partial<DriveConfig>;
    return {
      printReadyFolderUrl: parsed.printReadyFolderUrl || "",
      characterFolders: parsed.characterFolders || {},
      envelopeFolders: parsed.envelopeFolders || {},
      letterFolders: parsed.letterFolders || {},
    };
  } catch {
    console.error("EVERLETTER_DRIVE_CONFIG is not valid JSON; Drive buttons will remain unlinked.");
    return emptyDriveConfig;
  }
}
