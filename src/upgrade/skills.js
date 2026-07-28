import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  hashBuffer,
  hashDirectory,
  listDirectories,
  listFiles,
  normalizeTextLineEndings,
  readJsonIfExists,
  toPosixPath,
} from "../fs-utils.js";
import { assetsSkills, PROJECTION_ROOTS } from "../workspace-artifacts.js";
import { threeWayMergeText } from "../skills/merge.js";
import { PACKAGE_VERSION } from "../constants.js";
import { inspectSkillCatalog, skillRiskDiff } from "../skills/catalog.js";
import { preservesHostBundleProjection } from "../host-bundles.js";

function record(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { content: buffer, hash: hashBuffer(buffer) };
}

async function tree(directory, options = {}) {
  const result = new Map();
  for (const file of await listFiles(directory)) {
    const content = await readFile(file);
    result.set(
      toPosixPath(path.relative(directory, file)),
      options.normalizeLineEndings ? normalizeTextLineEndings(content) : content,
    );
  }
  return result;
}

function treeHash(files) {
  const chunks = [];
  for (const [relative, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    chunks.push(Buffer.from(`${relative}\0`), content, Buffer.from("\0"));
  }
  return hashBuffer(Buffer.concat(chunks));
}

function writeOperation(relative, content, current) {
  const next = record(normalizeTextLineEndings(content));
  const previous = current ? record(current) : undefined;
  if (previous?.hash === next.hash) return { kind: "noop", path: relative, proposedHash: next.hash, currentHash: next.hash };
  return {
    kind: previous ? "update-upgrade-managed" : "create-upgrade-managed",
    path: relative,
    currentHash: previous?.hash ?? null,
    proposedHash: next.hash,
    contentEncoding: "base64",
    content: next.content.toString("base64"),
  };
}

function deleteOperation(relative, current) {
  return { kind: "delete-upgrade-managed", path: relative, currentHash: hashBuffer(current), proposedHash: null };
}

function namesEqual(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

async function projectionNames(root) {
  return (await listDirectories(root)).map((directory) => path.basename(directory)).sort();
}

function projectionManifestMatches(manifest, agent, destination, expectedNames, skills) {
  const projection = manifest?.projections?.[agent];
  if (!projection || projection.path !== destination || !namesEqual(projection.skills ?? [], expectedNames)) return false;
  if (!Array.isArray(manifest.skillNames) || !namesEqual(manifest.skillNames, expectedNames)) return false;
  if (!manifest.skillHashes || !namesEqual(Object.keys(manifest.skillHashes), expectedNames)) return false;
  for (const name of expectedNames) {
    if (manifest.skillHashes[name] !== skills[name]?.installedHash) return false;
  }
  return true;
}

async function current(root, relative) {
  const file = path.join(root, ...relative.split("/"));
  return (await exists(file)) ? readFile(file) : undefined;
}

export async function planSkillUpgrade(snapshot, options = {}) {
  const operations = [];
  const conflicts = [];
  const lockSkills = {};
  const mergedTrees = new Map();
  const removedSkills = new Set();
  const removedFiles = new Map();
  const incomingSkillsRoot = options.incomingSkillsRoot ?? assetsSkills;
  const incomingCatalog = await inspectSkillCatalog(incomingSkillsRoot);
  const baselineCatalog = await inspectSkillCatalog(path.join(snapshot.root, ".agentic", "skill-baselines"));
  const incomingNames = new Set((await listFiles(incomingSkillsRoot)).map((file) => path.relative(incomingSkillsRoot, file).split(path.sep)[0]));

  for (const name of [...incomingNames].sort()) {
    const incomingRoot = path.join(incomingSkillsRoot, name);
    const localRoot = path.join(snapshot.root, ".agentic", "skills", name);
    const lockRecord = snapshot.skillsLock.skills?.[name];
    const baselineRoot = path.join(snapshot.root, lockRecord?.baselinePath ?? `.agentic/skill-baselines/${name}`);
    const incoming = await tree(incomingRoot, { normalizeLineEndings: true });
    const local = await tree(localRoot);
    let baseline = await tree(baselineRoot);
    if (baseline.size === 0 && lockRecord?.baselineHash && local.size > 0 && treeHash(local) === lockRecord.baselineHash) baseline = new Map(local);
    if (baseline.size === 0 && local.size > 0) {
      conflicts.push(`Cannot establish a trustworthy baseline for locally installed skill '${name}'`);
      continue;
    }
    const risk = skillRiskDiff(baselineCatalog.skills[name], incomingCatalog.skills[name]);
    if (risk.risky && !options.allowRiskyToolChanges) {
      conflicts.push(`${name}: incoming skill adds executable, shell, network, or tool-permission behavior; review and pass --allow-risky-tool-changes`);
    }
    const merged = new Map();
    const names = new Set([...baseline.keys(), ...local.keys(), ...incoming.keys()]);
    for (const relative of [...names].sort()) {
      const base = baseline.get(relative);
      const localContent = local.get(relative);
      const incomingContent = incoming.get(relative);
      if (!incomingContent) {
        if (!localContent) continue;
        if (!base || !localContent.equals(base)) {
          conflicts.push(`Incoming removed a locally modified skill file: ${name}/${relative}`);
          merged.set(relative, localContent);
        } else if (!options.allowSkillRemoval) {
          conflicts.push(`${name}/${relative}: incoming catalog removes this file; review and pass --allow-skill-removal`);
          merged.set(relative, localContent);
        } else {
          operations.push(deleteOperation(`.agentic/skills/${name}/${relative}`, localContent));
          operations.push(deleteOperation(`.agentic/skill-baselines/${name}/${relative}`, base));
          if (!removedFiles.has(name)) removedFiles.set(name, new Map());
          removedFiles.get(name).set(relative, localContent);
        }
        continue;
      }
      if (!base) {
        if (localContent && !localContent.equals(incomingContent)) {
          conflicts.push(`New incoming skill file collides with local content: ${name}/${relative}`);
          continue;
        }
        merged.set(relative, incomingContent);
        continue;
      }
      if (!localContent) {
        conflicts.push(`Locally removed skill file requires manual resolution: ${name}/${relative}`);
        continue;
      }
      const result = threeWayMergeText(base, localContent, incomingContent);
      if (result.status === "conflict") {
        conflicts.push(`Skill merge conflict: ${name}/${relative}`);
        continue;
      }
      merged.set(relative, result.content);
    }
    for (const [relative, content] of merged) {
      const target = `.agentic/skills/${name}/${relative}`;
      operations.push(writeOperation(target, content, await current(snapshot.root, target)));
    }
    for (const [relative, content] of incoming) {
      const target = `.agentic/skill-baselines/${name}/${relative}`;
      operations.push(writeOperation(target, content, await current(snapshot.root, target)));
    }
    lockSkills[name] = {
      ...(lockRecord ?? {}),
      path: `.agentic/skills/${name}`,
      baselinePath: `.agentic/skill-baselines/${name}`,
      baselineHash: treeHash(incoming),
      installedHash: treeHash(merged),
      localEditsAllowed: true,
      risk: incomingCatalog.skills[name]?.risk,
      files: Object.fromEntries([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([relative, content]) => [
        relative,
        { baselineHash: incoming.has(relative) ? hashBuffer(incoming.get(relative)) : null, installedHash: hashBuffer(content) },
      ])),
    };
    mergedTrees.set(name, merged);
  }

  for (const [name, value] of Object.entries(snapshot.skillsLock.skills ?? {})) {
    if (lockSkills[name]) continue;
    const local = await tree(path.join(snapshot.root, value.path ?? `.agentic/skills/${name}`));
    const baseline = await tree(path.join(snapshot.root, value.baselinePath ?? `.agentic/skill-baselines/${name}`));
    if (!options.allowSkillRemoval) {
      conflicts.push(`${name}: incoming catalog removes this installed skill; review and pass --allow-skill-removal`);
      lockSkills[name] = value;
    } else if (treeHash(local) !== treeHash(baseline)) {
      conflicts.push(`${name}: locally edited skill cannot be removed`);
      lockSkills[name] = value;
    } else {
      removedSkills.add(name);
      for (const [relative, content] of local) operations.push(deleteOperation(`.agentic/skills/${name}/${relative}`, content));
      for (const [relative, content] of baseline) operations.push(deleteOperation(`.agentic/skill-baselines/${name}/${relative}`, content));
    }
  }
  const catalogChanged = snapshot.skillsLock.source?.version !== PACKAGE_VERSION
    || incomingNames.size !== Object.keys(snapshot.skillsLock.skills ?? {}).length
    || [...incomingNames].some((name) => lockSkills[name]?.baselineHash !== snapshot.skillsLock.skills?.[name]?.baselineHash);
  const localChanged = Object.entries(lockSkills).some(([name, value]) => {
    const previous = snapshot.skillsLock.skills?.[name];
    return previous && value.installedHash !== previous.installedHash;
  });
  const targets = (snapshot.config.agentTargets ?? snapshot.profile.agentTargets ?? [])
    .filter((agent) => !options.preserveHostBundles || !preservesHostBundleProjection(agent));
  const projectionManifest = await readJsonIfExists(path.join(snapshot.root, ".agentic", "managed-projections.json"));
  if (!catalogChanged && !localChanged && conflicts.length === 0) {
    for (const agent of targets) {
      const destination = PROJECTION_ROOTS[agent];
      if (!destination) continue;
      const marker = await readJsonIfExists(path.join(snapshot.root, destination, ".managed-by-workspace-template.json"));
      const expected = projectionManifest?.projections?.[agent]?.hash;
      let safe = false;
      if (marker?.generator === "workspace-template" && marker.skillHashes) {
        const expectedNames = Object.keys(lockSkills).sort();
        safe = namesEqual(marker.skills ?? [], expectedNames)
          && namesEqual(Object.keys(marker.skillHashes), expectedNames)
          && namesEqual(await projectionNames(path.join(snapshot.root, destination)), expectedNames)
          && projectionManifestMatches(projectionManifest, agent, destination, expectedNames, lockSkills);
        for (const [name, hash] of Object.entries(marker.skillHashes)) {
          if (!(await exists(path.join(snapshot.root, destination, name))) || await hashDirectory(path.join(snapshot.root, destination, name)) !== hash) {
            safe = false;
            break;
          }
        }
      } else if (marker?.generator === "workspace-template" && expected) {
        safe = await hashDirectory(path.join(snapshot.root, destination)) === expected;
      }
      if (!safe) {
        conflicts.push(`Projection drift blocks upgrade: ${destination}`);
      }
    }
    operations.push(writeOperation(
      ".agentic/skills.lock.json",
      Buffer.from(`${JSON.stringify(snapshot.skillsLock, null, 2)}\n`),
      await current(snapshot.root, ".agentic/skills.lock.json"),
    ));
    return { operations, conflicts, lock: snapshot.skillsLock };
  }
  const lock = {
    ...structuredClone(snapshot.skillsLock),
    version: 2,
    source: { ...(snapshot.skillsLock.source ?? {}), package: "workspace-template", version: PACKAGE_VERSION, catalogHash: treeHash(await tree(incomingSkillsRoot)) },
    skills: Object.fromEntries(Object.entries(lockSkills).sort(([a], [b]) => a.localeCompare(b))),
  };

  const projectedNames = Object.keys(lockSkills).sort();
  const projections = {};
  for (const agent of targets) {
    const destination = PROJECTION_ROOTS[agent];
    if (!destination) continue;
    const projectionMarker = await readJsonIfExists(path.join(snapshot.root, destination, ".managed-by-workspace-template.json"));
    if ((await exists(path.join(snapshot.root, destination))) && projectionMarker?.generator !== "workspace-template") {
      conflicts.push(`Unmanaged projection root blocks upgrade: ${destination}`);
      continue;
    }
    const legacyProjectionHash = projectionManifest?.projections?.[agent]?.hash;
    const legacyProjectionSafe = legacyProjectionHash
      && await hashDirectory(path.join(snapshot.root, destination)) === legacyProjectionHash;
    const installedNames = Object.keys(snapshot.skillsLock.skills ?? {}).sort();
    if (!projectionMarker?.skillHashes && !legacyProjectionSafe) {
      conflicts.push(`Projection drift blocks upgrade: ${destination}`);
    }
    if (projectionMarker?.skillHashes) {
      const recordedNames = Object.keys(projectionMarker.skillHashes).sort();
      if (!namesEqual(projectionMarker.skills ?? [], installedNames)
        || !namesEqual(recordedNames, installedNames)
        || !namesEqual(await projectionNames(path.join(snapshot.root, destination)), installedNames)
        || !projectionManifestMatches(projectionManifest, agent, destination, installedNames, snapshot.skillsLock.skills ?? {})) {
        conflicts.push(`Projection catalog mismatch blocks upgrade: ${destination}`);
      }
    }
    for (const name of installedNames) {
      if (legacyProjectionSafe) break;
      const projectedRoot = path.join(snapshot.root, destination, name);
      if (await exists(projectedRoot)) {
        const expected = projectionMarker?.skillHashes?.[name];
        if (!expected || await hashDirectory(projectedRoot) !== expected) conflicts.push(`Projection drift blocks upgrade: ${destination}/${name}`);
      }
    }
    for (const name of removedSkills) {
      for (const [relative, content] of await tree(path.join(snapshot.root, destination, name))) {
        operations.push(deleteOperation(`${destination}/${name}/${relative}`, content));
      }
    }
    for (const [name, files] of removedFiles) {
      for (const [relative, content] of files) {
        const projected = await current(snapshot.root, `${destination}/${name}/${relative}`);
        if (projected) operations.push(deleteOperation(`${destination}/${name}/${relative}`, projected));
      }
    }
    projections[agent] = { path: destination, skills: projectedNames };
    for (const name of projectedNames) {
      const merged = mergedTrees.get(name) ?? await tree(path.join(snapshot.root, ".agentic", "skills", name));
      for (const [relative, content] of merged) {
        const target = `${destination}/${name}/${relative}`;
        operations.push(writeOperation(target, content, await current(snapshot.root, target)));
      }
    }
    const marker = Buffer.from(`${JSON.stringify({
      version: 2,
      generator: "workspace-template",
      canonical: ".agentic/skills",
      skills: projectedNames,
      skillHashes: Object.fromEntries(projectedNames.map((name) => [name, lockSkills[name].installedHash])),
    }, null, 2)}\n`);
    operations.push(writeOperation(`${destination}/.managed-by-workspace-template.json`, marker, await current(snapshot.root, `${destination}/.managed-by-workspace-template.json`)));
  }
  if (Object.keys(projections).length > 0) {
    const manifest = Buffer.from(`${JSON.stringify({
      version: 2,
      generator: "workspace-template",
      generatedAt: null,
      canonical: ".agentic/skills",
      skillNames: projectedNames,
      skillHashes: Object.fromEntries(projectedNames.map((name) => [name, lockSkills[name].installedHash])),
      agentTargets: Object.keys(projections),
      projections,
    }, null, 2)}\n`);
    operations.push(writeOperation(".agentic/managed-projections.json", manifest, await current(snapshot.root, ".agentic/managed-projections.json")));
  }
  operations.push(writeOperation(".agentic/skills.lock.json", Buffer.from(`${JSON.stringify(lock, null, 2)}\n`), await current(snapshot.root, ".agentic/skills.lock.json")));
  return { operations, conflicts, lock };
}
