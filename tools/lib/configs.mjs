// Which mod owns a config file? Shared by doctor (orphan check) and the server stage (side filter).
import { jarMeta, jarMentions } from './jars.mjs';

// Config names that don't match their owner's mod id (top-level name under config/ → owning mod id).
export const CONFIG_OWNERS = {
  'animatium3.json': 'animatium',
  'hollow-reborn.json': 'hollowreborn',
  'yacl.json5': 'yet_another_config_lib_v3',
  'serilum': 'collective',
  'face_of_horror-default-server.toml': 'face_of_horror',
  'SoundPhysicsPerfected.json5': 'sound_physics_perfected',
  'murk.json5': 'murk',
  'NoChatReports': 'nochatreports',
  'midnightlib.json': 'midnightlib',
  'transition.json': 'transition',
  'trender.json': 'trender',
};

export const normName = (s) => s.toLowerCase().replace(/\.(json5?|jsonc|toml|properties|txt|cfg|ya?ml)$/, '')
  .replace(/[-_.](client|common|server|default-server|mixins?|mixin|options|config|prefs)$/g, '')
  .replace(/[-_.](client|common|server|mixins?)$/g, '').replace(/[^a-z0-9]/g, '');
const normId = (id) => id.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Build an owner resolver over a set of mods.
 * jars: { slug: jarPath }. Returns (topLevelName) → { slug, id, how } | null.
 */
export function ownerResolver(jars) {
  const idToSlug = new Map();
  for (const [slug, jar] of Object.entries(jars)) {
    const m = jarMeta(jar);
    const ids = [m.id, ...m.provides, ...m.nested.flatMap((n) => [n.id, ...(n.provides || [])])].filter(Boolean);
    for (const id of ids) if (!idToSlug.has(id) || id === m.id) idToSlug.set(id, slug);
  }
  const cache = new Map();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    let r = null;
    const explicit = CONFIG_OWNERS[name];
    if (explicit) r = idToSlug.has(explicit) ? { slug: idToSlug.get(explicit), id: explicit, how: 'map' } : { slug: null, id: explicit, how: 'map' };
    if (!r) {
      const key = normName(name);
      // exact normalized match first, then prefix matches (longest id wins)
      const cands = [...idToSlug.keys()].map((id) => [id, normId(id)]).filter(([, n]) => n.length >= 3 && (n === key || key.startsWith(n) || n.startsWith(key)));
      cands.sort((a, b) => (b[1] === key) - (a[1] === key) || b[1].length - a[1].length);
      if (cands.length) r = { slug: idToSlug.get(cands[0][0]), id: cands[0][0], how: 'name' };
    }
    if (!r) {
      const stem = name.replace(/\.[^.]+$/, '');
      const hit = Object.entries(jars).find(([, j]) => jarMentions(j, stem));
      if (hit) r = { slug: hit[0], id: jarMeta(hit[1]).id, how: 'mention' };
    }
    cache.set(name, r);
    return r;
  };
}
