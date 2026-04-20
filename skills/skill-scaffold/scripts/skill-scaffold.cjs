#!/usr/bin/env node
// skill-scaffold.cjs — Generate new trackhub skill skeletons
// Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' || arg === '-n') args.name = argv[++i];
    else if (arg === '--desc' || arg === '-d') args.desc = argv[++i];
    else if (arg === '--scripts' || arg === '-s') args.scripts = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--output' || arg === '-o') args.output = argv[++i];
    else if (arg === '--template' || arg === '-t') args.template = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--lint') args.lint = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`skill-scaffold — Generate a new skill skeleton

Usage: node skill-scaffold.cjs --name <name> [options]

Options:
  -n, --name <name>       Skill name (kebab-case) [required]
  -d, --desc <desc>       Skill description for frontmatter
  -s, --scripts <list>    Comma-separated script filenames to create
  -o, --output <dir>      Base skills directory (default: ./skills/)
  -t, --template <type>   Template: default, cron, read-only-api, heartbeat
      --dry-run           Show what would be created without writing
      --json              Output result as JSON
      --lint              Run skill-lint after creation (if available)
      --force             Overwrite existing skill directory
  -h, --help              Show this help`);
}

// ── Templates ─────────────────────────────────────────────────────────────

const TEMPLATES = {
  default: {
    descriptionSuffix: 'Use when asked about {name} or related tasks.',
    sections: [
      { heading: 'Why', body: 'This skill solves a specific problem in the trackhub ecosystem.' },
      { heading: 'Script', body: '`scripts/{scriptName}` — Zero dependencies. Node.js 18+.' },
      { heading: 'Usage', body: '```bash\n# Basic usage\nnode {scriptName} --help\n```' },
      { heading: 'Integration', body: 'Pair with related skills for a complete workflow.' },
      { heading: 'Limitations', body: '- Read-only by default\n- Requires {scriptName} to be in the same directory' }
    ]
  },
  cron: {
    descriptionSuffix: 'Designed for cron job integration. Use when scheduling {name} as a recurring task.',
    sections: [
      { heading: 'Why', body: 'Automating this as a cron job saves time and ensures consistent execution.' },
      { heading: 'Script', body: '`scripts/{scriptName}` — Zero dependencies. Node.js 18+.' },
      { heading: 'Usage', body: '```bash\n# Basic usage\nnode {scriptName} --help\n\n# As a cron pre-flight\nnode {scriptName} --check\n```' },
      { heading: 'Cron Integration', body: 'Add to cron payload:\n```\n1. Run: node /path/to/{scriptName} --check\n2. If status is not ok, bail out with an alert.\n3. Otherwise, proceed with the main task.\n```' },
      { heading: 'Integration', body: '- **credential-health**: Check API credentials before running\n- **graceful-degradation**: Handle failures with cooldowns\n- **cron-preflight**: Wire pre-flight checks into cron jobs' },
      { heading: 'Limitations', body: '- Read-only by default\n- Requires valid credentials for API-dependent checks\n- Designed for isolated cron sessions, not interactive use' }
    ]
  },
  'read-only-api': {
    descriptionSuffix: 'Queries external APIs with read-only access. Use when checking {name} data.',
    sections: [
      { heading: 'Why', body: 'Provides a read-only interface to external data without risking accidental mutations.' },
      { heading: 'Script', body: '`scripts/{scriptName}` — Zero dependencies. Node.js 18+.' },
      { heading: 'Requirements', body: '- API key/token set via environment variable\n- Network access to the external API' },
      { heading: 'Usage', body: '```bash\n# Basic query\nnode {scriptName} --query "example"\n\n# JSON output for programmatic use\nnode {scriptName} --json --limit 10\n```' },
      { heading: 'Integration', body: '- **credential-health**: Validate API token before queries\n- **graceful-degradation**: Handle expired tokens gracefully\n- **quick-reports**: Format results for messaging platforms' },
      { heading: 'Limitations', body: '- Read-only — never modifies external data\n- Rate limits may apply\n- Depends on API availability' }
    ]
  },
  heartbeat: {
    descriptionSuffix: 'Designed for heartbeat-triggered checks. Use when {name} should run during periodic heartbeat polls.',
    sections: [
      { heading: 'Why', body: 'This check adds value during heartbeat polls without being noisy.' },
      { heading: 'Script', body: '`scripts/{scriptName}` — Zero dependencies. Node.js 18+.' },
      { heading: 'Usage', body: '```bash\n# Quick check\nnode {scriptName}\n\n# JSON output\nnode {scriptName} --json\n```' },
      { heading: 'Heartbeat Integration', body: 'Add to HEARTBEAT.md or run during heartbeat:\n```\n1. Run the check script\n2. If something needs attention, report it (don\'t include HEARTBEAT_OK)\n3. If nothing needs attention, stay quiet\n```' },
      { heading: 'Integration', body: '- **heartbeat-checklist**: Manage recurring checks with rotation\n- **time-aware**: Respect quiet hours and business hours\n- **graceful-degradation**: Handle failures without spam' },
      { heading: 'Limitations', body: '- Designed for periodic checks, not real-time monitoring\n- Respects quiet hours (23:00–08:00 by default)\n- Stateful tracking via heartbeat-state.json if needed' }
    ]
  }
};

// ── Generators ────────────────────────────────────────────────────────────

function generateSkillMd(name, desc, template, scripts) {
  const tpl = TEMPLATES[template] || TEMPLATES.default;
  const descText = desc || `Skill for ${name.replace(/-/g, ' ')}. ${tpl.descriptionSuffix.replace(/\{name\}/g, name)}`;
  const primaryScript = scripts.length > 0 ? scripts[0] : `${name}.cjs`;

  let md = '---\n';
  md += `name: ${name}\n`;
  md += `description: >\n  ${descText.split('\n').join('\n  ')}\n`;
  md += '---\n\n';
  md += `# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n`;
  md += `${descText}\n\n`;

  for (const section of tpl.sections) {
    md += `## ${section.heading}\n\n`;
    md += section.body.replace(/\{scriptName\}/g, primaryScript).replace(/\{name\}/g, name) + '\n\n';
  }

  return md;
}

function generateScriptStub(name, scriptFile) {
  const ext = path.extname(scriptFile);
  const baseName = path.basename(scriptFile, ext);
  let stub = '';

  if (ext === '.sh') {
    stub = `#!/usr/bin/env bash
# ${baseName} — Part of the ${name} skill
# Zero dependencies.

set -euo pipefail

# Defaults
JSON_OUTPUT=false
QUIET=false

for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
    --quiet|-q) QUIET=true ;;
    --help|-h)
      echo "${baseName} — ${name}"
      echo "Usage: $0 [--json] [--quiet] [--help]"
      exit 0
      ;;
  esac
done

# TODO: Implement skill logic here

if [ "$JSON_OUTPUT" = true ]; then
  echo '{"status":"ok","data":{}}'
elif [ "$QUIET" = false ]; then
  echo "✅ ${name}: ok"
fi
`;
  } else {
    stub = `#!/usr/bin/env node
// ${baseName} — Part of the ${name} skill
// Zero dependencies. Node.js 18+.

'use strict';

const args = process.argv.slice(2);
const json = args.includes('--json');
const quiet = args.includes('--quiet') || args.includes('-q');

if (args.includes('--help') || args.includes('-h')) {
  console.log('${baseName} — ${name}');
  console.log('Usage: node ${scriptFile} [--json] [--quiet] [--help]');
  process.exit(0);
}

function main() {
  // TODO: Implement skill logic here
  const result = { status: 'ok', data: {} };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    console.log('✅ ${name}: ok');
  }
}

try {
  main();
} catch (err) {
  if (json) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ ${name}: ' + err.message);
  }
  process.exit(1);
}
`;
  }

  return stub;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (!args.name) {
    console.error('Error: --name is required. Use --help for usage.');
    process.exit(2);
  }

  // Validate name is kebab-case
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.name)) {
    console.error('Error: Skill name must be kebab-case (e.g. my-skill-name).');
    process.exit(2);
  }

  const name = args.name;
  const template = args.template || 'default';
  const scripts = args.scripts || [];
  const outputDir = args.output || path.join(process.cwd(), 'skills');
  const skillDir = path.join(outputDir, name);
  const scriptsDir = path.join(skillDir, 'scripts');
  const refsDir = path.join(skillDir, 'references');

  // Check if skill already exists
  if (fs.existsSync(skillDir) && !args.force) {
    const msg = `Error: Skill "${name}" already exists at ${skillDir}. Use --force to overwrite.`;
    if (args.json) {
      console.log(JSON.stringify({ status: 'error', error: msg }));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }

  // Generate files
  const files = [];

  // SKILL.md
  const skillMd = generateSkillMd(name, args.desc, template, scripts);
  files.push({ path: path.join(skillDir, 'SKILL.md'), content: skillMd, label: 'SKILL.md' });

  // Script stubs
  for (const scriptFile of scripts) {
    const stub = generateScriptStub(name, scriptFile);
    files.push({ path: path.join(scriptsDir, scriptFile), content: stub, label: `scripts/${scriptFile}` });
  }

  // If no scripts specified, create a default one
  if (scripts.length === 0) {
    const defaultScript = `${name}.cjs`;
    const stub = generateScriptStub(name, defaultScript);
    files.push({ path: path.join(scriptsDir, defaultScript), content: stub, label: `scripts/${defaultScript}` });
  }

  // .gitkeep for references/
  files.push({ path: path.join(refsDir, '.gitkeep'), content: '', label: 'references/.gitkeep' });

  if (args.dryRun) {
    if (args.json) {
      console.log(JSON.stringify({
        status: 'dry-run',
        skill: name,
        template,
        files: files.map(f => f.label),
        skillDir
      }, null, 2));
    } else {
      console.log(`🏗️  Skill scaffold (dry-run): ${name}`);
      console.log(`   Template: ${template}`);
      console.log(`   Directory: ${skillDir}`);
      console.log(`   Files to create:`);
      for (const f of files) {
        console.log(`     • ${f.label}`);
      }
    }
    process.exit(0);
  }

  // Write files
  for (const file of files) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.content, 'utf8');
  }

  // Make shell scripts executable
  for (const file of files) {
    if (file.label.endsWith('.sh')) {
      fs.chmodSync(file.path, 0o755);
    }
  }

  const result = {
    status: 'created',
    skill: name,
    template,
    files: files.map(f => f.label),
    skillDir
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`✅ Skill "${name}" created successfully!`);
    console.log(`   📂 ${skillDir}`);
    console.log(`   📄 Files:`);
    for (const f of files) {
      console.log(`      • ${f.label}`);
    }
    console.log();
    console.log('Next steps:');
    console.log('  1. Edit SKILL.md with your skill\'s actual description and documentation');
    console.log('  2. Implement the script logic in scripts/');
    console.log('  3. Run skill-lint to validate: node skill-lint.cjs --skill ' + name);
    console.log('  4. Run skill-test to verify scripts: node skill-test.cjs --skill ' + name);
    console.log('  5. Commit and push to trackhub');
  }

  // Optional lint check
  if (args.lint) {
    const lintPath = path.join(outputDir, '..', 'skills', 'skill-lint', 'scripts', 'skill-lint.cjs');
    // Try common locations
    const lintLocations = [
      path.join(path.dirname(outputDir), 'skill-lint', 'scripts', 'skill-lint.cjs'),
      path.join(process.cwd(), 'skill-lint', 'scripts', 'skill-lint.cjs'),
    ];

    let lintScript = null;
    for (const loc of lintLocations) {
      if (fs.existsSync(loc)) {
        lintScript = loc;
        break;
      }
    }

    if (lintScript) {
      console.log(`\n🔍 Running skill-lint...`);
      try {
        const { execSync } = require('child_process');
        execSync(`node "${lintScript}" --skill "${name}"`, {
          cwd: outputDir,
          stdio: 'inherit'
        });
      } catch (e) {
        // Lint found issues — that's fine, just informational
      }
    } else {
      console.log('\n⚠️  skill-lint not found nearby. Run it manually to validate.');
    }
  }
}

main();
