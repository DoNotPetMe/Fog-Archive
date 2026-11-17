// Shared by the sync pipeline (Node) and the site (browser).
// Turns the game's perk description templates into safe, readable HTML/text.
//
// Template tokens (as shipped in the game's data):
//   {Tunable.<PerkId>.<Key>}   numeric value(s), one per perk tier
//   {Keyword.<Name>}           a status effect name
//   {Input.<Name>}             a key binding

const KEYWORD_LABELS = {
  deepwound: 'Deep Wound',
  hemorrhage: 'Haemorrhage',
};

const INPUT_LABELS = {
  'input.activatablebutton1': 'the Active Ability button',
  'input.activatablebutton2': 'the Secondary Ability button',
  'input.useitem': 'the Use Item button',
};

const ALLOWED_TAGS = new Set(['ul', 'li', 'br', 'b', 'i']);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

export function keywordLabel(name) {
  const k = name.toLowerCase();
  return KEYWORD_LABELS[k] || name.charAt(0).toUpperCase() + name.slice(1);
}

/** Values of a tunable for every tier, or null when the data does not carry it. */
export function tunableValues(perk, key) {
  const t = perk.tunables || {};
  const v = t[key.toLowerCase()];
  return Array.isArray(v) && v.length ? v : null;
}

/** Value at a tier (1-3); single-value tunables apply to every tier. */
export function valueAtTier(values, tier = 3) {
  if (!values) return null;
  return values[Math.min(values.length, tier) - 1];
}

export function formatNumber(n) {
  if (typeof n !== 'number') return String(n);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Render a description template.
 * mode 'html'  -> sanitised HTML (only ul/li/br/b/i survive, no attributes)
 * mode 'text'  -> plain text, used for search and summaries
 */
export function renderDescription(perk, { tier = 3, mode = 'html' } = {}) {
  const src = perk.template || '';
  const html = mode === 'html';
  let out = '';
  let unresolved = 0;
  const re = /<\/?([a-zA-Z0-9]+)[^>]*>|\{([^}]+)\}/g;
  let last = 0;
  let m;
  const pushText = (t) => {
    t = decodeEntities(t);
    out += html ? escapeHtml(t) : t;
  };
  while ((m = re.exec(src))) {
    pushText(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const closing = m[0][1] === '/';
      if (html) {
        if (ALLOWED_TAGS.has(tag)) out += closing ? `</${tag}>` : `<${tag}>`;
      } else if (tag === 'br' || tag === 'li' || (tag === 'ul' && !closing)) {
        out += tag === 'li' && !closing ? '\n• ' : closing ? '' : '\n';
      }
      continue;
    }
    const token = m[2];
    const parts = token.split('.');
    const head = parts[0].toLowerCase();
    if (head === 'tunable') {
      const key = parts.slice(2).join('.') || parts[1] || '';
      const values = tunableValues(perk, key);
      if (!values) {
        unresolved++;
        out += html ? '<b class="val val-unknown" title="Value missing from game data">?</b>' : '?';
      } else {
        const v = formatNumber(valueAtTier(values, tier));
        if (html) {
          const tiers = values.length > 1 ? ` title="Tier I / II / III: ${values.map(formatNumber).join(' / ')}"` : '';
          out += `<b class="val${values.length > 1 ? ' val-tiered' : ''}"${tiers}>${escapeHtml(v)}</b>`;
        } else out += v;
      }
    } else if (head === 'keyword') {
      const label = keywordLabel(parts[1] || '');
      out += html ? `<span class="kw kw-${escapeHtml((parts[1] || '').toLowerCase())}">${escapeHtml(label)}</span>` : label;
    } else {
      const label = INPUT_LABELS[token.toLowerCase()] || 'the ability button';
      out += html ? `<span class="input">${escapeHtml(label)}</span>` : label;
    }
  }
  pushText(src.slice(last));
  if (!html) out = out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  else out = out.replace(/(<br>\s*){3,}/g, '<br><br>');
  return { value: out, unresolved };
}

/** Strip a (trusted-source but still external) HTML fragment down to plain text. */
export function htmlToText(s) {
  return decodeEntities(
    String(s || '')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>|<\/p>|<\/ul>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Name normaliser used to match perk/killer names across sources. */
export function normName(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
