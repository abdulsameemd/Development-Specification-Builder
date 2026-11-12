/* Process flow diagrams (AS-IS / TO-BE) as swimlanes: one lane per role, one box per step, arrows in step order.
   - svg(steps, kind)      → SVG markup (builder preview, Word via PNG); 8 steps per diagram, longer flows continue
                              in the next diagram;
   - markdown(steps, kind) → a ```mermaid block (renders as a flowchart in GitHub / VS Code with Mermaid support and
                              stays readable for Copilot) whose first line carries the steps as JSON
                              ("%% apb-flow {...}"), so the builder and the Word export redraw the same swimlanes;
   - fromBlock(lines)      → { kind, steps } from such a block, or null;
   - pngs(md)              → Promise of [{ png, w, h }] for every flow block of a document (browser only).
   kind: 'asIs' (pain points marked ⚠) | 'toBe' (boxes coloured by change: unchanged / changed / new / automated). */
(function (APB) {
  'use strict';

  const PER_DIAGRAM = 8;
  const LABEL_W = 132, COL_W = 158, BOX_W = 134, BOX_H = 66, LANE_H = 96, TOP = 40, PAD = 10;
  const FONT = "Arial, 'Segoe UI', Helvetica, sans-serif";
  const MARKS = {
    unchanged: { label: 'Unchanged', fill: '#f2f4f5', stroke: '#9aa5ab' },
    changed: { label: 'Changed', fill: '#fff3d6', stroke: '#d79a00' },
    new: { label: 'New', fill: '#e2efff', stroke: '#2f6fd6' },
    automated: { label: 'Automated', fill: '#e3f6e3', stroke: '#2e9a47' }
  };
  const PLAIN = { fill: '#ffffff', stroke: '#7d8c93' };

  function str(v) { return typeof v === 'string' ? v.replace(/`/g, "'").trim() : ''; } // no ` – it would end the Markdown code block
  function x(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* rows of the process grid → [{ step, role, tx, mark, pain }] (empty rows dropped) */
  function steps(list, kind) {
    return (Array.isArray(list) ? list : []).filter(function (r) { return r && str(r.step); }).slice(0, 60).map(function (r) {
      const mark = kind === 'toBe' ? (MARKS[str(r.change)] ? str(r.change) : '') : '';
      return { step: str(r.step).slice(0, 160), role: str(r.role).slice(0, 60), tx: str(r.tx).slice(0, 60), mark: mark, pain: kind === 'asIs' ? str(r.pain).slice(0, 160) : '' };
    });
  }

  /* words → at most `max` lines of about `width` characters (last line ends with … when cut) */
  function wrap(text, width, max) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      while (w.length > width) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, width - 1) + '-'); w = w.slice(width - 1); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= width) cur += ' ' + w; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > max) { lines.length = max; lines[max - 1] = lines[max - 1].slice(0, width - 1).replace(/\s+\S*$/, '') + '…'; }
    return lines;
  }

  function lanesOf(all) {
    const lanes = [];
    all.forEach(function (s) { const r = s.role || 'Role not set'; if (lanes.indexOf(r) < 0) lanes.push(r); });
    return lanes.length ? lanes : ['Role not set'];
  }

  /* one swimlane diagram for steps[from .. from+PER_DIAGRAM) of `all` → { svg, w, h } */
  function part(all, kind, from) {
    const lanes = lanesOf(all);
    const list = all.slice(from, from + PER_DIAGRAM);
    const cont = from + PER_DIAGRAM < all.length;
    const w = LABEL_W + list.length * COL_W + (cont ? 54 : 16);
    const h = TOP + lanes.length * LANE_H + PAD;
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" font-family="' + FONT + '" role="img" aria-label="' +
      x((kind === 'toBe' ? 'Proposed process (TO-BE)' : 'Current process (AS-IS)') + ', steps ' + (from + 1) + ' to ' + (from + list.length)) + '">');
    out.push('<defs><marker id="apbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4b5a61"/></marker></defs>');
    out.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#ffffff"/>');
    // legend
    let lx = 8;
    const legend = kind === 'toBe' ? Object.keys(MARKS).map(function (k) { return [MARKS[k].fill, MARKS[k].stroke, MARKS[k].label]; }) : [[PLAIN.fill, '#c62828', '⚠ Pain point']];
    out.push('<text x="' + lx + '" y="22" font-size="12" font-weight="700" fill="#1d2b30">' + (kind === 'toBe' ? 'TO-BE' : 'AS-IS') + (all.length > PER_DIAGRAM ? ' · steps ' + (from + 1) + '–' + (from + list.length) + ' of ' + all.length : '') + '</text>');
    lx = 150 + (all.length > PER_DIAGRAM ? 110 : 0);
    legend.forEach(function (l) {
      out.push('<rect x="' + lx + '" y="12" width="14" height="12" rx="3" fill="' + l[0] + '" stroke="' + l[1] + '"/><text x="' + (lx + 19) + '" y="22" font-size="11" fill="#33444b">' + x(l[2]) + '</text>');
      lx += 30 + l[2].length * 6.2;
    });
    // lanes
    lanes.forEach(function (r, i) {
      const y = TOP + i * LANE_H;
      out.push('<rect x="0" y="' + y + '" width="' + w + '" height="' + LANE_H + '" fill="' + (i % 2 ? '#f7f9fa' : '#ffffff') + '" stroke="#d3dadd"/>');
      out.push('<rect x="0" y="' + y + '" width="' + (LABEL_W - 8) + '" height="' + LANE_H + '" fill="#eef2f3" stroke="#d3dadd"/>');
      wrap(r, 17, 3).forEach(function (t, k, arr) {
        out.push('<text x="' + ((LABEL_W - 8) / 2) + '" y="' + (y + LANE_H / 2 - (arr.length - 1) * 7 + k * 14 + 4) + '" font-size="11.5" font-weight="700" fill="#24343a" text-anchor="middle">' + x(t) + '</text>');
      });
    });
    // boxes
    const pos = list.map(function (s, i) {
      const lane = lanes.indexOf(s.role || 'Role not set');
      return { x: LABEL_W + i * COL_W + (COL_W - BOX_W) / 2, y: TOP + lane * LANE_H + (LANE_H - BOX_H) / 2 };
    });
    // arrows first (under the boxes)
    for (let i = 0; i < list.length - 1; i++) {
      const a = pos[i], b = pos[i + 1];
      const ax = a.x + BOX_W, ay = a.y + BOX_H / 2, bx = b.x, by = b.y + BOX_H / 2;
      const mx = ax + (bx - ax) / 2;
      const d = ay === by ? 'M' + ax + ',' + ay + ' L' + (bx - 2) + ',' + by : 'M' + ax + ',' + ay + ' L' + mx + ',' + ay + ' L' + mx + ',' + by + ' L' + (bx - 2) + ',' + by;
      out.push('<path d="' + d + '" fill="none" stroke="#4b5a61" stroke-width="1.6" marker-end="url(#apbArrow)"/>');
    }
    if (cont) {
      const a = pos[pos.length - 1];
      out.push('<path d="M' + (a.x + BOX_W) + ',' + (a.y + BOX_H / 2) + ' L' + (w - 10) + ',' + (a.y + BOX_H / 2) + '" fill="none" stroke="#4b5a61" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#apbArrow)"/>');
    }
    list.forEach(function (s, i) {
      const p = pos[i], n = from + i + 1;
      const c = s.mark ? MARKS[s.mark] : PLAIN;
      const pain = !!s.pain;
      out.push('<g><title>' + x(n + '. ' + s.step + (s.tx ? ' · ' + s.tx : '') + (s.mark ? ' · ' + MARKS[s.mark].label : '') + (pain ? ' · Pain point: ' + s.pain : '')) + '</title>');
      out.push('<rect x="' + p.x + '" y="' + p.y + '" width="' + BOX_W + '" height="' + BOX_H + '" rx="8" fill="' + c.fill + '" stroke="' + (pain ? '#c62828' : c.stroke) + '" stroke-width="' + (pain ? 2 : 1.4) + '"/>');
      out.push('<circle cx="' + (p.x + 12) + '" cy="' + (p.y + 12) + '" r="9" fill="#24343a"/><text x="' + (p.x + 12) + '" y="' + (p.y + 16) + '" font-size="10.5" font-weight="700" fill="#ffffff" text-anchor="middle">' + n + '</text>');
      if (pain) out.push('<text x="' + (p.x + BOX_W - 12) + '" y="' + (p.y + 16) + '" font-size="13" fill="#c62828" text-anchor="middle">⚠</text>');
      const lines = wrap(s.step, pain ? 16 : 18, s.tx ? 2 : 3); // leaves room for the ⚠ marker and the box edge
      lines.forEach(function (t, k) { out.push('<text x="' + (p.x + 26) + '" y="' + (p.y + 16 + k * 13) + '" font-size="11" fill="#1d2b30">' + x(t) + '</text>'); });
      if (s.tx) out.push('<text x="' + (p.x + BOX_W / 2) + '" y="' + (p.y + BOX_H - 8) + '" font-size="10" font-family="Consolas, \'Courier New\', monospace" fill="#3d5560" text-anchor="middle">' + x(wrap(s.tx, 20, 1)[0]) + '</text>');
      out.push('</g>');
    });
    out.push('</svg>');
    return { svg: out.join(''), w: w, h: h };
  }

  /* all diagrams of one flow (8 steps each) → [{ svg, w, h }] */
  function diagrams(all, kind) {
    const outs = [];
    for (let i = 0; i < all.length; i += PER_DIAGRAM) outs.push(part(all, kind, i));
    return outs;
  }
  function svg(all, kind) { return diagrams(all, kind).map(function (d) { return d.svg; }).join(''); }

  /* ------------------------------------------------------------- Markdown (Mermaid) */
  const MARK = '%% apb-flow ';
  function label(t) { return String(t).replace(/"/g, "'").replace(/[\[\]{}<>|]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function markdown(all, kind) {
    if (all.length < 2) return '';
    const lanes = lanesOf(all);
    const lines = ['```mermaid', MARK + JSON.stringify({ kind: kind, steps: all }), 'flowchart LR'];
    lanes.forEach(function (r, li) {
      lines.push('  subgraph L' + (li + 1) + '["' + label(r) + '"]', '    direction LR');
      all.forEach(function (s, i) { if ((s.role || 'Role not set') === r) lines.push('    s' + (i + 1) + '["' + (i + 1) + '. ' + label(s.step) + (s.tx ? '<br/>' + label(s.tx) : '') + (s.pain ? ' ⚠' : '') + '"]'); });
      lines.push('  end');
    });
    lines.push('  ' + all.map(function (s, i) { return 's' + (i + 1); }).join(' --> '));
    if (kind === 'toBe') {
      Object.keys(MARKS).forEach(function (k) {
        const ids = all.map(function (s, i) { return s.mark === k ? 's' + (i + 1) : ''; }).filter(Boolean);
        if (ids.length) lines.push('  classDef ' + k + ' fill:' + MARKS[k].fill + ',stroke:' + MARKS[k].stroke, '  class ' + ids.join(',') + ' ' + k);
      });
    } else {
      const ids = all.map(function (s, i) { return s.pain ? 's' + (i + 1) : ''; }).filter(Boolean);
      if (ids.length) lines.push('  classDef pain stroke:#c62828,stroke-width:2px', '  class ' + ids.join(',') + ' pain');
    }
    lines.push('```');
    return lines.join('\n');
  }
  /* the code lines of a ```mermaid block → { kind, steps } when the builder wrote it, else null */
  function fromBlock(lines) {
    const first = (lines || [])[0] || '';
    if (first.indexOf(MARK) !== 0) return null;
    try {
      const d = JSON.parse(first.slice(MARK.length));
      const kind = d.kind === 'toBe' ? 'toBe' : 'asIs';
      const list = (Array.isArray(d.steps) ? d.steps : []).map(function (s) {
        return { step: str(s && s.step).slice(0, 160), role: str(s && s.role).slice(0, 60), tx: str(s && s.tx).slice(0, 60), mark: MARKS[str(s && s.mark)] ? str(s.mark) : '', pain: str(s && s.pain).slice(0, 160) };
      }).filter(function (s) { return s.step; }).slice(0, 60);
      return list.length ? { kind: kind, steps: list } : null;
    } catch (e) { return null; }
  }
  /* readable text version (Word without images, plain text) */
  function textLines(all) {
    return all.map(function (s, i) { return (i + 1) + '. ' + s.step + (s.role ? ' [' + s.role + ']' : '') + (s.tx ? ' · ' + s.tx : '') + (s.mark ? ' · ' + MARKS[s.mark].label : '') + (s.pain ? ' · ⚠ ' + s.pain : ''); });
  }

  /* ------------------------------------------------------------- PNG for Word (browser) */
  function png(d, scale) {
    scale = scale || 2;
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        try {
          const c = document.createElement('canvas');
          c.width = Math.round(d.w * scale); c.height = Math.round(d.h * scale);
          const g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) {
            if (!b) { reject(new Error('no image')); return; }
            b.arrayBuffer().then(function (buf) { resolve({ png: new Uint8Array(buf), w: d.w, h: d.h }); }, reject);
          }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('The flow diagram could not be drawn.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg);
    });
  }
  /* every flow block of a Markdown document → images in document order (one per 8-step part) */
  function pngs(md) {
    const jobs = [];
    const re = /```mermaid\n([^\n]*)\n/g;
    let m;
    while ((m = re.exec(String(md || '')))) {
      const f = fromBlock([m[1]]);
      if (f) diagrams(f.steps, f.kind).forEach(function (d) { jobs.push(png(d)); });
    }
    return Promise.all(jobs);
  }

  APB.flow = { steps: steps, svg: svg, diagrams: diagrams, markdown: markdown, fromBlock: fromBlock, textLines: textLines, pngs: pngs, MARKS: MARKS, PER_DIAGRAM: PER_DIAGRAM };
})(window.APB = window.APB || {});
