import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWidgetZip } from "../src/widget-zip";

const widgetDir = join(import.meta.dir, "../../widget");

test("архив виджета: файлы в корне, адрес сервера подставлен, unzip проверяет", () => {
  const zip = buildWidgetZip(widgetDir, "https://rr.example.com");
  const dir = mkdtempSync(join(tmpdir(), "rr-zip-"));
  const file = join(dir, "widget.zip");
  writeFileSync(file, zip);

  const check = Bun.spawnSync(["unzip", "-t", file]);
  expect(check.exitCode).toBe(0);

  const list = Bun.spawnSync(["unzip", "-Z1", file]).stdout.toString().trim().split("\n");
  expect(list).toContain("manifest.json");
  expect(list).toContain("script.js");
  expect(list).toContain("i18n/ru.json");
  expect(list).toContain("images/logo_main.png");

  const script = Bun.spawnSync(["unzip", "-p", file, "script.js"]).stdout.toString();
  expect(script).toContain('var SERVER_URL = "https://rr.example.com"');
  expect(script).not.toContain("__SERVER_URL__");
  const manifest = JSON.parse(
    Bun.spawnSync(["unzip", "-p", file, "manifest.json"]).stdout.toString(),
  );
  expect(manifest.widget.support.link).toBe("https://rr.example.com");
});
