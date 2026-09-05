/**
 * OneDrive 路徑無法安裝 esbuild/vite。
 * 不論從哪裡執行 npm run dev，都轉到 C:\Temp\novel-map-app 啟動。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TEMP_APP = "C:\\Temp\\novel-map-app";
const viteJs = join(TEMP_APP, "node_modules", "vite", "bin", "vite.js");

if (!existsSync(join(TEMP_APP, "package.json"))) {
  console.error(`[novel-map] 找不到本機複本: ${TEMP_APP}`);
  console.error("請先把專案複製到該目錄，或聯絡 Agent 建立複本。");
  process.exit(1);
}

if (!existsSync(viteJs)) {
  console.error(`[novel-map] ${TEMP_APP} 尚未安裝依賴。`);
  console.error("請執行:");
  console.error(`  cd /d ${TEMP_APP}`);
  console.error("  npm install");
  process.exit(1);
}

console.log(`[novel-map] 從本機複本啟動: ${TEMP_APP}`);
const child = spawn(
  process.execPath,
  [viteJs, "--host", "127.0.0.1", "--port", "5173"],
  { cwd: TEMP_APP, stdio: "inherit", shell: false }
);

child.on("exit", (code) => process.exit(code ?? 0));
