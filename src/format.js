// Telegram offsets are UTF-16 offsets, exactly what JavaScript string indexes use.
const URL = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const USERNAME = /(?<![\w@])@[a-zA-Z0-9_]{5,32}\b/g;

function replaceRanges(text, entities, pattern, value) {
  const matches = [...text.matchAll(pattern)].reverse();
  for (const match of matches) {
    const start = match.index;
    const oldLength = match[0].length;
    const next = typeof value === 'function' ? value(match[0]) : value;
    text = `${text.slice(0, start)}${next}${text.slice(start + oldLength)}`;
    const delta = next.length - oldLength;
    entities = entities.flatMap((entity) => {
      const end = entity.offset + entity.length;
      if (entity.offset >= start + oldLength) return [{ ...entity, offset: entity.offset + delta }];
      if (end <= start) return [entity];
      // The replacement overlaps a formatted range. Keep its style on replacement text.
      if (entity.offset <= start && end >= start + oldLength) return [{ ...entity, length: entity.length + delta }];
      return [];
    });
  }
  // Do not trim/collapse whitespace here: doing so would invalidate Telegram entity offsets.
  return { text, entities };
}

function removeRange(text, entities, start, length) {
  const end = start + length;
  return {
    text: `${text.slice(0, start)}${text.slice(end)}`,
    entities: entities.flatMap((entity) => {
      const entityEnd = entity.offset + entity.length;
      if (entityEnd <= start) return [entity];
      if (entity.offset >= end) return [{ ...entity, offset: entity.offset - length }];
      if (entity.offset < start && entityEnd > end) return [{ ...entity, length: entity.length - length }];
      if (entity.offset < start) return [{ ...entity, length: start - entity.offset }];
      if (entityEnd > end) return [{ ...entity, offset: start, length: entityEnd - end }];
      return [];
    })
  };
}

export function cleanPost(text = '', originalEntities = [], username, replacements = []) {
  let entities = originalEntities.map(({ type, offset, length, url, user, language }) => ({ type, offset, length, url, user, language }));
  // Remove visible URLs and their rich-text link entities (including hidden-link labels).
  for (const entity of [...entities].reverse()) {
    if (entity.type === 'text_link' || entity.type === 'url') {
      const start = entity.offset;
      const length = entity.length;
      ({ text, entities } = removeRange(text, entities, start, length));
    }
  }
  ({ text, entities } = replaceRanges(text, entities, URL, ''));
  if (username) ({ text, entities } = replaceRanges(text, entities, USERNAME, username.startsWith('@') ? username : `@${username}`));
  for (const item of replacements) {
    if (!item.from) continue;
    ({ text, entities } = replaceRanges(text, entities, new RegExp(item.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), item.to ?? ''));
  }
  return { text, entities: entities.filter((e) => e.length > 0) };
}
