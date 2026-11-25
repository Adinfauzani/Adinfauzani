#!/usr/bin/env node
/**
 * Aggregate public GitHub repository analytics for one user and two organizations.
 * No third-party dependencies; output is a self-contained SVG.
 */
const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const SOURCES = [
  { login: "Adinfauzani", label: "PERSONAL", kind: "user" },
  { login: "Rynexid", label: "RYNEXID", kind: "org" },
  { login: "Sorakuid", label: "SORAKUID", kind: "org" },
];

if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

async function request(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-analytics-aggregator",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return response.json();
}

async function getRepositories(source) {
  const repositories = [];
  for (let page = 1; page <= 100; page += 1) {
    const endpoint = source.kind === "user"
      ? `users/${source.login}/repos?type=owner&sort=updated&per_page=100&page=${page}`
      : `orgs/${source.login}/repos?type=public&sort=updated&per_page=100&page=${page}`;
    const batch = await request(`${API}/${endpoint}`);
    repositories.push(...batch.filter((repo) => !repo.private));
    if (batch.length < 100) break;
  }
  return repositories;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

const sourceResults = await Promise.all(SOURCES.map(async (source) => ({
  ...source,
  repositories: await getRepositories(source),
})));

const unique = new Map();
for (const source of sourceResults) {
  for (const repo of source.repositories) {
    if (!unique.has(repo.full_name)) unique.set(repo.full_name, repo);
  }
}
const repositories = [...unique.values()];

const languagesByRepo = await mapLimit(repositories, 8, async (repo) => {
  try {
    return await request(`${API}/repos/${repo.full_name}/languages`);
  } catch (error) {
    console.warn(`Skipping language stats for ${repo.full_name}: ${error.message}`);
    return {};
  }
});

const languages = {};
for (const languageMap of languagesByRepo) {
  for (const [name, bytes] of Object.entries(languageMap)) {
    languages[name] = (languages[name] ?? 0) + bytes;
  }
}

const totals = repositories.reduce((sum, repo) => ({
  stars: sum.stars + repo.stargazers_count,
  forks: sum.forks + repo.forks_count,
  issues: sum.issues + (repo.open_issues_count ?? 0),
}), { stars: 0, forks: 0, issues: 0 });

const topLanguages = Object.entries(languages)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6);
const languageTotal = topLanguages.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");
const number = (value) => new Intl.NumberFormat("en-US").format(value);
const shortNumber = (value) => value >= 1000
  ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  : String(value);

const colors = ["#88c0d0", "#a3be8c", "#ebcb8b", "#b48ead", "#81a1c1", "#d08770"];
const metric = (x, label, value, hint) => `
  <g transform="translate(${x} 128)">
    <rect width="214" height="91" rx="12" fill="#2e3440" stroke="#434c5e"/>
    <text x="18" y="27" fill="#a3b0c2" font-size="11" font-weight="700" letter-spacing="1.1">${label}</text>
    <text x="18" y="62" fill="#eceff4" font-size="29" font-weight="700">${value}</text>
    <text x="18" y="80" fill="#7f8a9c" font-size="10">${hint}</text>
  </g>`;

const sourceLine = sourceResults.map((source, index) => {
  const count = source.repositories.length;
  const x = 48 + index * 300;
  return `
    <g transform="translate(${x} 270)">
      <circle cx="5" cy="-4" r="4" fill="${colors[index]}"/>
      <text x="17" y="0" fill="#aeb9ca" font-size="11" font-weight="700" letter-spacing=".8">${source.label}</text>
      <text x="17" y="25" fill="#eceff4" font-size="21" font-weight="700">${number(count)} <tspan fill="#8994a6" font-size="11" font-weight="400">public repos</tspan></text>
    </g>`;
}).join("");

let languageRows = "";
topLanguages.forEach(([name, bytes], index) => {
  const y = 345 + index * 24;
  const width = Math.max(3, (bytes / languageTotal) * 490);
  languageRows += `
    <g transform="translate(48 ${y})">
      <text x="0" y="0" fill="#d8dee9" font-size="11">${escapeXml(name)}</text>
      <rect x="126" y="-10" width="330" height="7" rx="3.5" fill="#3b4252"/>
      <rect x="126" y="-10" width="${(width / 490) * 330}" height="7" rx="3.5" fill="${colors[index % colors.length]}"/>
      <text x="470" y="0" fill="#8994a6" font-size="10" text-anchor="end">${Math.round((bytes / languageTotal) * 100)}%</text>
    </g>`;
});

const updated = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="510" viewBox="0 0 1000 510" role="img" aria-labelledby="title desc">
  <title id="title">Combined GitHub Analytics</title>
  <desc id="desc">Aggregated public repository statistics for Adinfauzani, Rynexid, and Sorakuid.</desc>
  <rect width="1000" height="510" rx="18" fill="#242933"/>
  <rect x="1" y="1" width="998" height="508" rx="17" fill="none" stroke="#434c5e"/>
  <text x="48" y="54" fill="#eceff4" font-size="23" font-weight="700">GitHub Analytics</text>
  <text x="48" y="78" fill="#8994a6" font-size="12">COMBINED OVERVIEW · ADINFAUZANI + RYNEXID + SORAKUID</text>
  <rect x="804" y="35" width="148" height="28" rx="14" fill="#2e3440" stroke="#434c5e"/>
  <circle cx="820" cy="49" r="4" fill="#a3be8c"/>
  <text x="832" y="53" fill="#c7d0dc" font-size="10" font-weight="700">PUBLIC DATA</text>
  ${metric(48, "PUBLIC REPOSITORIES", number(repositories.length), "Across all three sources")}
  ${metric(278, "TOTAL STARS", shortNumber(totals.stars), "Stars received")}
  ${metric(508, "TOTAL FORKS", shortNumber(totals.forks), "Repository forks")}
  ${metric(738, "OPEN ISSUES", shortNumber(totals.issues), "Across public repositories")}
  <text x="48" y="245" fill="#eceff4" font-size="13" font-weight="700">SOURCE BREAKDOWN</text>
  ${sourceLine}
  <line x1="48" y1="310" x2="952" y2="310" stroke="#3b4252"/>
  <text x="48" y="333" fill="#eceff4" font-size="13" font-weight="700">TOP LANGUAGES</text>
  ${languageRows || '<text x="48" y="370" fill="#8994a6" font-size="12">No language data available yet.</text>'}
  <text x="952" y="486" fill="#687386" font-size="10" text-anchor="end">Updated ${escapeXml(updated)} · Generated automatically with GitHub Actions</text>
</svg>`;

await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir("assets", { recursive: true })
  .then(() => writeFile("assets/github-analytics.svg", svg, "utf8")));

console.log(`Generated analytics for ${repositories.length} unique public repositories.`);
