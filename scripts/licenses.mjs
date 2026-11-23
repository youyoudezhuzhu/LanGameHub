import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runtime libraries bundled by the browser and server production builds.
const runtime = ['lucide-react', 'react', 'react-dom', 'scheduler', 'ws'];
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const sections = [];
for (const name of runtime) {
  const path = join('node_modules', name);
  const version = lock.packages[path].version;
  const documents = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(licen[cs]e|notice|copying)(\.|$)/i.test(entry.name));
  if (documents.length === 0) throw new Error(`No license file for ${name}@${version}`);
  for (const document of documents) {
    sections.push(`==== ${name}@${version} / ${document.name} ====\n${readFileSync(join(path, document.name), 'utf8')}`);
  }
}
writeFileSync(process.argv[2], sections.join('\n\n') + '\n');
