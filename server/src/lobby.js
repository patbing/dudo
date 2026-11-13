// The lobby: table codes, quick match, the public list, creation limits. One instance (a singleton Durable Object).
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const MAX_OPEN = 200, MAX_DAY = 2000, PER_IP = 10, IP_WINDOW = 10 * 60 * 1000;

export class LobbyCore {
  // io: { load(): data|null, save(data), now() }
  constructor(io) { this.io = io; this.d = null; this.ips = new Map(); }
  async init() { this.d = (await this.io.load()) || { tables: {}, day: '', made: 0 }; }

  alloc(ip) {
    const now = this.io.now(), d = this.d, day = new Date(now).toISOString().slice(0, 10);
    if (d.day !== day) { d.day = day; d.made = 0; }
    const hits = (this.ips.get(ip) || []).filter((x) => now - x < IP_WINDOW);
    if (ip && hits.length >= PER_IP) throw new Error('Too many new tables from your address; wait a few minutes or join an open one.');
    const open = Object.values(d.tables).filter((x) => x.status === 'lobby').length;
    if (open >= MAX_OPEN || d.made >= MAX_DAY) throw new Error('The server is busy (too many tables today); join an open table with join_table.');
    for (let i = 0; i < 8; i++) {
      let code = ''; for (let k = 0; k < 4; k++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      if (!d.tables[code]) {
        d.tables[code] = { table: code, status: 'reserved', created: now, updated: now };
        d.made++; hits.push(now); if (ip) this.ips.set(ip, hits);
        return code;
      }
    }
    throw new Error('Could not find a free table code; try again.');
  }
  async update(info) {
    if (info.gone) delete this.d.tables[info.table]; else this.d.tables[info.table] = info;
    this.prune(); await this.io.save(this.d);
  }
  prune() {
    const now = this.io.now();
    for (const [k, x] of Object.entries(this.d.tables)) {
      const age = now - (x.updated || x.created || 0);
      if ((x.status === 'reserved' && age > 60e3) || (x.status === 'lobby' && age > 30 * 60e3) || (x.status === 'over' && age > 7 * 864e5) || (x.status === 'playing' && age > 864e5)) delete this.d.tables[k];
    }
  }
  quick() {
    const open = Object.values(this.d.tables).filter((x) => x.status === 'lobby' && x.public && x.players < x.seats).sort((a, b) => a.created - b.created);
    return open.length ? open[0].table : null;
  }
  list() {
    this.prune();
    const all = Object.values(this.d.tables).filter((x) => x.public);
    return {
      open: all.filter((x) => x.status === 'lobby').map(({ table, players, seats, dice }) => ({ table, players, seats, dice })),
      live: all.filter((x) => x.status === 'playing').map(({ table, players, round }) => ({ table, players, round })),
      finished: all.filter((x) => x.status === 'over').sort((a, b) => b.updated - a.updated).slice(0, 20).map(({ table, winner, updated }) => ({ table, winner, ended: new Date(updated).toISOString() }))
    };
  }
}
