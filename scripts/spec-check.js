import { existsSync, readFileSync } from "node:fs";

const required = [
  "docs/specs/product-requirements.md",
  "docs/specs/system-architecture.md",
  "docs/specs/data-contracts.md",
  "docs/specs/acceptance-tests.md",
  "docs/specs/provider-integrations.md",
  "public/index.html",
  "vercel.json",
  "public/app-assets/router.js",
  "tests/router.test.js"
];

const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`Missing required spec/app files:\n${missing.join("\n")}`);
  process.exit(1);
}

const requirements = readFileSync("docs/specs/product-requirements.md", "utf8");
for (const phrase of ["Flight capture", "Airport map and routing", "Live positioning", "Wi-Fi assistance"]) {
  if (!requirements.includes(phrase)) {
    console.error(`Product requirements missing section: ${phrase}`);
    process.exit(1);
  }
}

console.log("Spec check passed");
