import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { load } from "js-yaml";

const response = await fetch("https://render.com/schema/render.yaml.json", {
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Schema download failed: ${response.status}`);
const schema = await response.json();
const validator = new Ajv({ allErrors: true, strict: false });
addFormats(validator);
const valid = validator.validate(schema, load(await readFile("render.yaml", "utf8")));
if (!valid) {
  console.error(validator.errors);
  process.exitCode = 1;
} else console.log("Render Blueprint matches the official JSON schema. No resources created.");
