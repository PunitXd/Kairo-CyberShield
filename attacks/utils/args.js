// Tiny shared CLI parser for the attack scripts: --target, --count, --help.
// No dependencies; works the same under `node` on any platform.

export const parseArgs = (argv = process.argv.slice(2)) => {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
};

export const DEFAULT_TARGET = 'http://localhost:8000';
